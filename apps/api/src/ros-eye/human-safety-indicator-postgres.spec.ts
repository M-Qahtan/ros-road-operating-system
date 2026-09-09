import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';
import type { ContactSqlConnectionPort } from './contact-orchestration-postgres.js';
import { PostgresHumanSafetyIndicatorLedger, type RecordSafetyIndicatorInput } from './human-safety-indicator-postgres.js';
import { PostgresHumanSafetyIndicatorSource } from './human-safety-indicator-source-postgres.js';
import { indicatorRevisionDigest, parseRecordedIndicators, type RecordedSafetyIndicator } from './human-safety-indicator-revision.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';
const INDICATOR_ID = '44444444-4444-4444-8444-444444444444';
const CORRECTION_ID = '55555555-5555-4555-8555-555555555555';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
type Handler = (text: string, values: readonly unknown[]) => PostgresQueryResult;

class FakeClient implements PostgresClient {
  readonly queries: CapturedQuery[] = [];
  released = false;
  constructor(private readonly handler: Handler) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text, values) as PostgresQueryResult<Row>;
  }
  release(): void { this.released = true; }
}

class FakePool implements PostgresPool {
  constructor(readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

function indicator(overrides: Partial<RecordedSafetyIndicator> = {}): RecordedSafetyIndicator {
  return {
    indicatorId: INDICATOR_ID,
    supersedesIndicatorId: null,
    code: 'HELP_REQUESTED',
    observedAt: '2026-09-08T12:00:00.000Z',
    source: 'OPERATOR',
    confidence: 0.9,
    requiresHumanReview: true,
    ...overrides
  };
}

function input(overrides: Partial<RecordSafetyIndicatorInput> = {}): RecordSafetyIndicatorInput {
  return {
    ...SCOPE,
    expectedRevision: 0,
    indicator: indicator(),
    recordedBy: ACTOR_ID,
    recordedByRole: 'OPERATOR',
    traceId: TRACE_ID,
    recordedAt: '2026-09-08T12:01:00.000Z',
    ...overrides
  };
}

test('authorized human records first structured indicator under exact scope and SERIALIZABLE transaction', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 };
    if (text.includes('FROM human_safety_indicator_revision_ledger')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const result = await new PostgresHumanSafetyIndicatorLedger(new FakePool(client)).record(input());
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.revision, 1);
  assert.match(client.queries[1]!.text, /SERIALIZABLE/);
  assert.deepEqual(client.queries.find((query) => query.text.includes('FROM road_events'))!.values, [SCOPE.tenantId, SCOPE.purpose, CASE_ID]);
  const insert = client.queries.find((query) => query.text.includes('INSERT INTO human_safety_indicator_revision_ledger'))!;
  assert.equal(insert.values[3], 1);
  assert.equal(insert.values[7], 'OPERATOR');
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
});

test('correction preserves history, verifies prior digest, and appends the next revision', async () => {
  const before = [indicator()];
  const priorDigest = indicatorRevisionDigest(SCOPE, before);
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 };
    if (text.includes('FROM human_safety_indicator_revision_ledger')) return {
      rows: [{ revision: 1, indicator_set: before, digest: priorDigest }], rowCount: 1
    };
    return { rows: [], rowCount: 1 };
  });
  const correction = indicator({
    indicatorId: CORRECTION_ID,
    supersedesIndicatorId: INDICATOR_ID,
    code: 'PERSON_RESPONDED',
    observedAt: '2026-09-08T12:02:00.000Z'
  });
  const result = await new PostgresHumanSafetyIndicatorLedger(new FakePool(client)).record(input({
    expectedRevision: 1, indicator: correction, recordedAt: '2026-09-08T12:03:00.000Z'
  }));
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.revision, 2);
  const stored = JSON.parse(String(client.queries.find((query) => query.text.includes('INSERT INTO human_safety_indicator_revision_ledger'))!.values[4]));
  assert.deepEqual(stored.map((item: RecordedSafetyIndicator) => item.indicatorId), [INDICATOR_ID, CORRECTION_ID]);
});

test('stale expected revision returns conflict without appending', async () => {
  const before = [indicator()];
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 };
    if (text.includes('FROM human_safety_indicator_revision_ledger')) return {
      rows: [{ revision: 1, indicator_set: before, digest: indicatorRevisionDigest(SCOPE, before) }], rowCount: 1
    };
    return { rows: [], rowCount: 1 };
  });
  assert.deepEqual(await new PostgresHumanSafetyIndicatorLedger(new FakePool(client)).record(input()), { status: 'CONFLICT' });
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO human_safety_indicator_revision_ledger')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('non-human authority and invalid correction chronology fail before persistence', async () => {
  const unauthorized = new FakeClient(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(
    () => new PostgresHumanSafetyIndicatorLedger(new FakePool(unauthorized)).record(input({ recordedByRole: 'SYSTEM' })),
    /human authority/
  );
  assert.equal(unauthorized.queries.length, 0);

  const invalid = new FakeClient(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(
    () => new PostgresHumanSafetyIndicatorLedger(new FakePool(invalid)).record(input({
      indicator: indicator({ observedAt: '2026-09-08T12:02:00.000Z' }), recordedAt: '2026-09-08T12:01:00.000Z'
    })),
    /after its recording time/
  );
  assert.equal(invalid.queries.length, 0);
});

test('closed incident rejects a later structured indicator while retaining the row lock boundary', async () => {
  const client = new FakeClient((text) => text.includes('FROM road_events')
    ? { rows: [{ case_id: CASE_ID, status: 'CLOSED' }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  await assert.rejects(
    () => new PostgresHumanSafetyIndicatorLedger(new FakePool(client)).record(input()),
    /cannot be appended after incident closure/
  );
  assert.match(client.queries.find((query) => query.text.includes('FROM road_events'))!.text, /FOR UPDATE/);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO human_safety_indicator_revision_ledger')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('stored indicator parser rejects correction cycles and duplicate supersession', () => {
  const first = indicator({ supersedesIndicatorId: CORRECTION_ID });
  const second = indicator({ indicatorId: CORRECTION_ID, supersedesIndicatorId: INDICATOR_ID });
  assert.throws(() => parseRecordedIndicators([first, second]), /correction chain/);
  const third = indicator({ indicatorId: '66666666-6666-4666-8666-666666666666', supersedesIndicatorId: INDICATOR_ID });
  assert.throws(() => parseRecordedIndicators([indicator(), second, third]), /correction chain/);
});

test('read-only source returns receipt only when exact scope, state, and digest match', async () => {
  const state = [indicator()];
  const digest = indicatorRevisionDigest(SCOPE, state);
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 };
    return { rows: [{ revision: 1, indicator_set: state, digest }], rowCount: 1 };
  });
  assert.deepEqual(await new PostgresHumanSafetyIndicatorSource().load(client as ContactSqlConnectionPort, SCOPE), {
    authority: 'SOURCE_LEDGER', revision: 1, digest
  });
});

test('missing, drifted, and cross-purpose Indicator state fail closed', async () => {
  const missing = new FakeClient((text) => text.includes('FROM road_events')
    ? { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  assert.equal(await new PostgresHumanSafetyIndicatorSource().load(missing as ContactSqlConnectionPort, SCOPE), null);

  const state = [indicator()];
  const drift = new FakeClient((text) => text.includes('FROM road_events')
    ? { rows: [{ case_id: CASE_ID, status: 'RECOVERY' }], rowCount: 1 }
    : { rows: [{ revision: 1, indicator_set: state, digest: 'f'.repeat(64) }], rowCount: 1 });
  await assert.rejects(() => new PostgresHumanSafetyIndicatorSource().load(drift as ContactSqlConnectionPort, SCOPE), /does not match/);

  const foreign = new FakeClient(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await new PostgresHumanSafetyIndicatorSource().load(
    foreign as ContactSqlConnectionPort, { ...SCOPE, purpose: 'other-purpose' }
  ), null);
  assert.equal(foreign.queries.length, 1);
});
