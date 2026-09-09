import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  RoadEvent,
  RoadEventClosureSourceSnapshotChangedError,
  RoadEventConcurrencyError,
  RoadEventNotFoundError,
  RoadEventStatus,
  SeverityLevel
} from '@ros/domain';
import { PostgresRoadEventRepository, roadEventRevisionDigest } from './postgres-road-event-repository.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';
const CORRELATION_ID = '44444444-4444-4444-8444-444444444444';
const SCOPE = { tenantId: 'riyadh-pilot', purpose: 'road-safety-response' } as const;
const SNAPSHOT_DIGEST = 'd'.repeat(64);

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
type QueryHandler = (text: string, values: readonly unknown[]) => PostgresQueryResult<unknown>;

class FakeClient implements PostgresClient {
  readonly queries: CapturedQuery[] = [];
  released = false;
  constructor(private readonly handler: QueryHandler) {}
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

const context = {
  ...SCOPE,
  actorType: 'OPERATOR',
  actorId: ACTOR_ID,
  action: 'road_event.created',
  traceId: TRACE_ID,
  eventType: 'RoadEventCreated',
  correlationId: CORRELATION_ID,
  occurredAt: new Date('2026-07-25T03:00:00.000Z')
} as const;

function event(version = 1): RoadEvent {
  return new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T02:55:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    version,
    severity: {
      level: SeverityLevel.Moderate,
      score: 45,
      confidence: 0.8,
      reasonCodes: ['multi_signal_confirmation'],
      requiresHumanReview: true
    }
  });
}

function row(version = 1) {
  return {
    id: EVENT_ID,
    tenant_id: SCOPE.tenantId,
    purpose: SCOPE.purpose,
    status: RoadEventStatus.Detected,
    severity: SeverityLevel.Moderate,
    severity_score: 45,
    confidence: '0.800',
    reason_codes: ['multi_signal_confirmation'],
    severity_requires_human_review: true,
    longitude: 46.6753,
    latitude: 24.7136,
    occurred_at: '2026-07-25T02:55:00.000Z',
    version,
    closure_authorized_by: null,
    closure_authorized_at: null,
    closure_authorization_reason: null,
    closure_source_input_version: null,
    closure_source_snapshot_digest: null
  };
}

function authorizedRecovery(): RoadEvent {
  return new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T02:55:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery,
    version: 2,
    severity: {
      level: SeverityLevel.High, score: 82, confidence: 0.91,
      reasonCodes: ['verified_impact'], requiresHumanReview: true
    },
    closureAuthorization: {
      actorId: ACTOR_ID,
      reason: 'verified current source snapshot',
      authorizedAt: new Date('2026-07-25T03:00:00.000Z'),
      sourceSnapshot: { inputVersion: 37, sourceSnapshotDigest: SNAPSHOT_DIGEST }
    }
  });
}

function authorizedRow() {
  return {
    ...row(2),
    status: RoadEventStatus.Recovery,
    severity: SeverityLevel.High,
    severity_score: 82,
    confidence: '0.910',
    reason_codes: ['verified_impact'],
    closure_authorized_by: ACTOR_ID,
    closure_authorized_at: '2026-07-25T03:00:00.000Z',
    closure_authorization_reason: 'verified current source snapshot',
    closure_source_input_version: 37,
    closure_source_snapshot_digest: SNAPSHOT_DIGEST
  };
}

test('create persists the governed source snapshot bound to closure authorization', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const bound = new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T02:55:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery,
    version: 2,
    closureAuthorization: {
      actorId: ACTOR_ID,
      reason: 'verified source snapshot',
      authorizedAt: new Date('2026-07-25T03:00:00.000Z'),
      sourceSnapshot: { inputVersion: 37, sourceSnapshotDigest: 'd'.repeat(64) }
    }
  });

  await new PostgresRoadEventRepository(new FakePool(client)).create(bound, context);

  assert.match(client.queries[1]!.text, /closure_source_input_version, closure_source_snapshot_digest/);
  assert.deepEqual(client.queries[1]!.values.slice(16, 18), [37, 'd'.repeat(64)]);

  const legacy = new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T02:55:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery,
    version: 2,
    closureAuthorization: {
      actorId: ACTOR_ID,
      reason: 'verified source snapshot',
      authorizedAt: new Date('2026-07-25T03:00:00.000Z')
    }
  });
  assert.equal(roadEventRevisionDigest(legacy, SCOPE, 'CASE'), '0401457fb37181e19851379d2b2eacef7670b2e39754d3257e67c588ef35d9ee');
  assert.notEqual(roadEventRevisionDigest(bound, SCOPE, 'CASE'), roadEventRevisionDigest(legacy, SCOPE, 'CASE'));
});

test('create writes scoped RoadEvent, independent revision receipts, audit and outbox in one transaction', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  await repository.create(event(), context);

  assert.deepEqual(client.queries.map((query) => query.text.trim().split(/\s+/)[0]), ['BEGIN', 'INSERT', 'INSERT', 'INSERT', 'INSERT', 'INSERT', 'COMMIT']);
  assert.match(client.queries[1]!.text, /tenant_id, purpose/);
  assert.match(client.queries[1]!.text, /ST_SetSRID\(ST_MakePoint\(\$10, \$11\)/);
  assert.equal(client.queries[1]!.values[0], EVENT_ID);
  assert.equal(client.queries[1]!.values[1], SCOPE.tenantId);
  assert.equal(client.queries[1]!.values[2], SCOPE.purpose);
  assert.deepEqual(client.queries[2]!.values.slice(0, 5), [SCOPE.tenantId, SCOPE.purpose, EVENT_ID, 'CASE', 1]);
  assert.deepEqual(client.queries[3]!.values.slice(0, 5), [SCOPE.tenantId, SCOPE.purpose, EVENT_ID, 'SEVERITY', 1]);
  assert.match(String(client.queries[2]!.values[5]), /^[a-f0-9]{64}$/);
  assert.match(String(client.queries[3]!.values[5]), /^[a-f0-9]{64}$/);
  assert.notEqual(client.queries[2]!.values[5], client.queries[3]!.values[5]);
  assert.equal(client.queries[4]!.values[7], TRACE_ID);
  assert.equal(client.queries[5]!.values[3], CORRELATION_ID);
  assert.equal(client.released, true);
});

async function initialLedgerDigests(): Promise<Readonly<Record<string, string>>> {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  await new PostgresRoadEventRepository(new FakePool(client)).create(event(), context);
  return Object.fromEntries(
    client.queries
      .filter((query) => query.text.includes('INSERT INTO road_event_revision_ledger'))
      .map((query) => [String(query.values[3]), String(query.values[5])])
  );
}

test('severity reassessment verifies both ledgers and appends only a new severity receipt', async () => {
  const digests = await initialLedgerDigests();
  const client = new FakeClient((text, values) => {
    if (text.includes('FROM road_events') && text.includes('FOR UPDATE')) return { rows: [row(1)], rowCount: 1 };
    if (text.includes('UPDATE road_events')) return { rows: [{ version: 2 }], rowCount: 1 };
    if (text.includes('SELECT revision, digest FROM road_event_revision_ledger')) {
      return { rows: [{ revision: 1, digest: digests[String(values[3])] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const updated = event();
  updated.assessSeverity({
    level: SeverityLevel.High, score: 82, confidence: 0.91,
    reasonCodes: ['verified_impact'], requiresHumanReview: true
  });
  await new PostgresRoadEventRepository(new FakePool(client)).update(updated, 1, {
    ...context, action: 'road_event.severity_reassessed', eventType: 'RoadEventSeverityReassessed'
  });

  const appended = client.queries.filter((query) => query.text.includes('INSERT INTO road_event_revision_ledger'));
  assert.equal(appended.length, 1);
  assert.deepEqual(appended[0]?.values.slice(3, 5), ['SEVERITY', 2]);
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
});

test('ledger drift rolls back the RoadEvent update before audit or outbox', async () => {
  const digests = await initialLedgerDigests();
  const client = new FakeClient((text, values) => {
    if (text.includes('FROM road_events') && text.includes('FOR UPDATE')) return { rows: [row(1)], rowCount: 1 };
    if (text.includes('UPDATE road_events')) return { rows: [{ version: 2 }], rowCount: 1 };
    if (text.includes('SELECT revision, digest FROM road_event_revision_ledger')) {
      const component = String(values[3]);
      return { rows: [{ revision: 1, digest: component === 'CASE' ? 'f'.repeat(64) : digests[component] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const updated = event();
  updated.assessSeverity({
    level: SeverityLevel.High, score: 82, confidence: 0.91,
    reasonCodes: ['verified_impact'], requiresHumanReview: true
  });

  await assert.rejects(
    () => new PostgresRoadEventRepository(new FakePool(client)).update(updated, 1, context),
    /receipt does not match/
  );
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO audit_logs')), false);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO outbox_events')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('update rejects a stale expected version before writing audit or outbox', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [row(2)], rowCount: 1 };
    return { rows: [], rowCount: null };
  });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const updated = event(2);
  updated.transitionTo(RoadEventStatus.Validating);

  await assert.rejects(() => repository.update(updated, 1, context), RoadEventConcurrencyError);
  assert.equal(client.queries.some((query) => query.text.includes('UPDATE road_events')), false);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO audit_logs')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('high-risk closure validates the persisted snapshot inside a serializable update transaction', async () => {
  const before = authorizedRecovery();
  const caseDigest = roadEventRevisionDigest(before, SCOPE, 'CASE');
  const severityDigest = roadEventRevisionDigest(before, SCOPE, 'SEVERITY');
  const client = new FakeClient((text, values) => {
    if (text.includes('FROM road_events') && text.includes('FOR UPDATE')) return { rows: [authorizedRow()], rowCount: 1 };
    if (text.includes('closure_snapshot_current')) return { rows: [{ closure_snapshot_current: true }], rowCount: 1 };
    if (text.includes('UPDATE road_events')) return { rows: [{ version: 3 }], rowCount: 1 };
    if (text.includes('SELECT revision, digest FROM road_event_revision_ledger')) {
      return values[3] === 'CASE'
        ? { rows: [{ revision: 2, digest: caseDigest }], rowCount: 1 }
        : { rows: [{ revision: 1, digest: severityDigest }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const closed = authorizedRecovery();
  closed.transitionTo(RoadEventStatus.Closed);

  await new PostgresRoadEventRepository(new FakePool(client)).update(closed, 2, {
    ...context, action: 'road_event.closed', eventType: 'RoadEventClosed'
  });

  assert.equal(client.queries[1]?.text, 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  const verificationIndex = client.queries.findIndex((query) => query.text.includes('closure_snapshot_current'));
  const updateIndex = client.queries.findIndex((query) => query.text.includes('UPDATE road_events'));
  assert.ok(verificationIndex > 0 && updateIndex > verificationIndex);
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
});

test('source drift rejects high-risk closure before event audit or outbox writes', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events') && text.includes('FOR UPDATE')) return { rows: [authorizedRow()], rowCount: 1 };
    if (text.includes('closure_snapshot_current')) return { rows: [{ closure_snapshot_current: false }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const closed = authorizedRecovery();
  closed.transitionTo(RoadEventStatus.Closed);

  await assert.rejects(
    () => new PostgresRoadEventRepository(new FakePool(client)).update(closed, 2, context),
    RoadEventClosureSourceSnapshotChangedError
  );
  assert.equal(client.queries.some((query) => query.text.includes('UPDATE road_events')), false);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO audit_logs')), false);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO outbox_events')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('update treats wrong tenant or purpose as not-found', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: null };
  });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const updated = event(2);
  updated.transitionTo(RoadEventStatus.Validating);

  await assert.rejects(
    () => repository.update(updated, 1, { ...context, tenantId: 'another-tenant' }),
    RoadEventNotFoundError
  );
  const select = client.queries.find((query) => query.text.includes('FOR UPDATE'))!;
  assert.match(select.text, /tenant_id = \$2 AND purpose = \$3/);
  assert.deepEqual(select.values, [EVENT_ID, 'another-tenant', SCOPE.purpose]);
});

test('findById restores geography, severity and version only inside the requested scope', async () => {
  const client = new FakeClient((text, values) => text.includes('SELECT') && values[1] === SCOPE.tenantId
    ? { rows: [row(3)], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const restored = await repository.findById(EVENT_ID, SCOPE);
  const hidden = await repository.findById(EVENT_ID, { tenantId: 'another-tenant', purpose: SCOPE.purpose });

  assert.equal(restored?.id, EVENT_ID);
  assert.equal(restored?.latitude, 24.7136);
  assert.equal(restored?.longitude, 46.6753);
  assert.equal(restored?.severity.level, SeverityLevel.Moderate);
  assert.equal(restored?.version, 3);
  assert.equal(hidden, undefined);
  assert.match(client.queries[0]!.text, /tenant_id = \$2 AND purpose = \$3/);
});

test('findById restores the governed source snapshot bound to closure authorization', async () => {
  const client = new FakeClient(() => ({
    rows: [{
      ...row(2),
      status: RoadEventStatus.Recovery,
      closure_authorized_by: ACTOR_ID,
      closure_authorized_at: '2026-07-25T03:00:00.000Z',
      closure_authorization_reason: 'verified source snapshot',
      closure_source_input_version: '37',
      closure_source_snapshot_digest: 'd'.repeat(64)
    }],
    rowCount: 1
  }));

  const restored = await new PostgresRoadEventRepository(new FakePool(client)).findById(EVENT_ID, SCOPE);

  assert.deepEqual(restored?.closureAuthorization?.sourceSnapshot, {
    inputVersion: 37,
    sourceSnapshotDigest: 'd'.repeat(64)
  });
});

test('closure snapshot migration enforces complete scoped binding without rewriting legacy rows', () => {
  const migration = readFileSync('database/migrations/0022_road_event_closure_snapshot_binding.sql', 'utf8');
  assert.match(migration, /closure_source_input_version integer/);
  assert.match(migration, /closure_source_snapshot_digest text/);
  assert.match(migration, /FOREIGN KEY \(\s*tenant_id, purpose, id, closure_source_input_version, closure_source_snapshot_digest\s*\)/);
  assert.match(migration, /REFERENCES ros_eye_safety_fusion_input_snapshots\(\s*tenant_id, purpose, case_id, input_version, snapshot_digest\s*\)/);
  assert.match(migration, /closure_source_input_version IS NULL AND closure_source_snapshot_digest IS NULL/);
  assert.match(migration, /closure_authorized_by IS NOT NULL\s+AND closure_source_input_version IS NOT NULL/);
});

test('list scopes in SQL before filters, pagination and total count', async () => {
  const client = new FakeClient(() => ({ rows: [{ ...row(), total_count: '7' }], rowCount: 1 }));
  const repository = new PostgresRoadEventRepository(new FakePool(client));
  const page = await repository.list({
    statuses: [RoadEventStatus.Detected],
    severities: [SeverityLevel.Moderate],
    occurredFrom: new Date('2026-07-25T00:00:00.000Z'),
    occurredTo: new Date('2026-07-26T00:00:00.000Z'),
    limit: 20,
    offset: 40
  }, SCOPE);

  assert.equal(page.total, 7);
  assert.equal(page.items.length, 1);
  assert.deepEqual(client.queries[0]!.values.slice(0, 2), [SCOPE.tenantId, SCOPE.purpose]);
  assert.deepEqual(client.queries[0]!.values.slice(-2), [20, 40]);
  assert.match(client.queries[0]!.text, /tenant_id = \$1/);
  assert.match(client.queries[0]!.text, /purpose = \$2/);
  assert.match(client.queries[0]!.text, /status = ANY\(\$3::road_event_status\[\]\)/);
  assert.match(client.queries[0]!.text, /severity = ANY\(\$4::severity_level\[\]\)/);
  assert.match(client.queries[0]!.text, /COUNT\(\*\) OVER\(\) AS total_count/);
});
