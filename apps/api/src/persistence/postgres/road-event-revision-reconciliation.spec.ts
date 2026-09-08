import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventStatus, SeverityLevel } from '@ros/domain';
import {
  RoadEventRevisionReconciler,
  RoadEventRevisionReconciliationError
} from './road-event-revision-reconciliation.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const RECONCILIATION_ID = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = '33333333-3333-4333-8333-333333333333';
const SCOPE = { tenantId: 'riyadh-pilot', purpose: 'road-safety-response' } as const;

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
  connectCount = 0;
  constructor(readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { this.connectCount += 1; return this.client; }
}

const command = {
  ...SCOPE,
  caseId: CASE_ID,
  expectedEventVersion: 4,
  reconciliationId: RECONCILIATION_ID,
  operatorActorId: OPERATOR_ID,
  recordedAt: new Date('2026-09-08T09:00:00.000Z')
} as const;

function legacyRow(version: number | string = 4) {
  return {
    id: CASE_ID,
    tenant_id: SCOPE.tenantId,
    purpose: SCOPE.purpose,
    reporter_actor_id: null,
    status: RoadEventStatus.Validating,
    severity: SeverityLevel.High,
    severity_score: '82',
    confidence: '0.91',
    reason_codes: ['verified_impact'],
    severity_requires_human_review: true,
    longitude: '46.6753',
    latitude: '24.7136',
    occurred_at: '2026-07-25T02:55:00.000Z',
    version,
    closure_authorized_by: null,
    closure_authorized_at: null,
    closure_authorization_reason: null
  };
}

test('reconciles an empty legacy ledger under a locked exact-scope row with explicit provenance', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [legacyRow()], rowCount: 1 };
    if (text.includes('SELECT component')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const result = await new RoadEventRevisionReconciler(new FakePool(client)).reconcile(command);

  assert.equal(result, 'RECONCILED');
  assert.equal(client.queries[0]?.text, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.match(client.queries[1]!.text, /tenant_id = \$2 AND purpose = \$3[\s\S]*FOR UPDATE/);
  assert.deepEqual(client.queries[1]!.values, [CASE_ID, SCOPE.tenantId, SCOPE.purpose]);
  const inserts = client.queries.filter((query) => query.text.includes('INSERT INTO road_event_revision_ledger'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((query) => query.values[3]), ['CASE', 'SEVERITY']);
  for (const insert of inserts) {
    assert.match(String(insert.values[4]), /^[a-f0-9]{64}$/);
    assert.deepEqual(insert.values.slice(5), [command.recordedAt, RECONCILIATION_ID, OPERATOR_ID, 4]);
    assert.match(insert.text, /'LEGACY_RECONCILIATION'/);
  }
  assert.notEqual(inserts[0]?.values[4], inserts[1]?.values[4]);
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
  assert.equal(client.released, true);
});

test('an exact retry with identical provenance is idempotent and does not append', async () => {
  const first = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [legacyRow()], rowCount: 1 };
    if (text.includes('SELECT component')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  await new RoadEventRevisionReconciler(new FakePool(first)).reconcile(command);
  const digests = Object.fromEntries(first.queries
    .filter((query) => query.text.includes('INSERT INTO road_event_revision_ledger'))
    .map((query) => [query.values[3], query.values[4]]));
  const existing = ['CASE', 'SEVERITY'].map((component) => ({
    component, revision: 1, digest: digests[component], origin: 'LEGACY_RECONCILIATION',
    reconciliation_id: RECONCILIATION_ID, reconciled_by: OPERATOR_ID, source_event_version: 4
  }));
  const retry = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [legacyRow()], rowCount: 1 };
    if (text.includes('SELECT component')) return { rows: existing, rowCount: 2 };
    return { rows: [], rowCount: 1 };
  });

  assert.equal(await new RoadEventRevisionReconciler(new FakePool(retry)).reconcile(command), 'IDEMPOTENT');
  assert.equal(retry.queries.some((query) => query.text.includes('INSERT INTO road_event_revision_ledger')), false);
  assert.equal(retry.queries.at(-1)?.text, 'COMMIT');
});

test('stale observed version rolls back before reading or writing the ledger', async () => {
  const client = new FakeClient((text) => text.includes('FROM road_events')
    ? { rows: [legacyRow(5)], rowCount: 1 }
    : { rows: [], rowCount: 1 });

  await assert.rejects(
    () => new RoadEventRevisionReconciler(new FakePool(client)).reconcile(command),
    /changed: expected version 4, found 5/
  );
  assert.equal(client.queries.some((query) => query.text.includes('road_event_revision_ledger')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('partial or differently-provenanced receipts are ambiguous and fail closed', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return { rows: [legacyRow()], rowCount: 1 };
    if (text.includes('SELECT component')) return {
      rows: [{
        component: 'CASE', revision: 1, digest: 'a'.repeat(64), origin: 'TRANSACTIONAL_WRITE',
        reconciliation_id: null, reconciled_by: null, source_event_version: null
      }],
      rowCount: 1
    };
    return { rows: [], rowCount: 1 };
  });

  await assert.rejects(
    () => new RoadEventRevisionReconciler(new FakePool(client)).reconcile(command),
    RoadEventRevisionReconciliationError
  );
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO road_event_revision_ledger')), false);
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});

test('invalid identity or access scope is rejected before a database connection', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 0 }));
  const pool = new FakePool(client);
  await assert.rejects(
    () => new RoadEventRevisionReconciler(pool).reconcile({ ...command, tenantId: ' other-tenant' }),
    /tenantId/
  );
  await assert.rejects(
    () => new RoadEventRevisionReconciler(pool).reconcile({ ...command, operatorActorId: 'operator' }),
    /operatorActorId/
  );
  assert.equal(pool.connectCount, 0);
});
