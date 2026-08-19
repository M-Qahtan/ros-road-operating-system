import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';
import {
  IdempotencyPersistenceConflictError,
  PostgresAuditTimelineAdapter,
  PostgresIdempotencyAdapter,
  PostgresSignalAttachmentAdapter
} from './postgres-road-event-support.js';

class ScriptedClient implements PostgresClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  released = false;
  constructor(private readonly results: PostgresQueryResult[]) {}

  async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    const result = this.results.shift() ?? { rows: [], rowCount: null };
    return result as PostgresQueryResult<Row>;
  }

  release(): void { this.released = true; }
}

class SingleClientPool implements PostgresPool {
  constructor(readonly client: ScriptedClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

const UUIDS = {
  event: '11111111-1111-4111-8111-111111111111',
  signal: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333',
  trace: '44444444-4444-4444-8444-444444444444'
};
const TENANT_ID = 'riyadh-ops';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';
const FINGERPRINT = 'a'.repeat(64);

test('durable idempotency adapter replays a completed result', async () => {
  const client = new ScriptedClient([{
    rows: [{ fingerprint: FINGERPRINT, response: { id: UUIDS.event, version: 2 } }],
    rowCount: 1
  }]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));

  assert.deepEqual(await adapter.get('road_event:transition', 'request-0001'), {
    fingerprint: FINGERPRINT,
    value: { id: UUIDS.event, version: 2 }
  });
  assert.equal(client.released, true);
});

test('durable idempotency adapter rejects a conflicting completed fingerprint', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: 0 },
    { rows: [{ fingerprint: 'b'.repeat(64), response: { ok: true } }], rowCount: 1 }
  ]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));

  await assert.rejects(
    adapter.put('road_event:create', 'request-0002', { fingerprint: FINGERPRINT, value: { ok: true } }),
    IdempotencyPersistenceConflictError
  );
  assert.equal(client.released, true);
});

test('signal attachment is transactional and audits only a new logical attachment', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: null },
    { rows: [{ road_event_id: UUIDS.event }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: null }
  ]);
  const adapter = new PostgresSignalAttachmentAdapter(new SingleClientPool(client));

  await adapter.attach({
    roadEventId: UUIDS.event,
    signalId: UUIDS.signal,
    matchScore: 0.95,
    mergeReasons: ['spatial_temporal_match'],
    actor: { actorId: UUIDS.actor, roles: ['OPERATOR'], tenantId: TENANT_ID, purpose: PURPOSE },
    traceId: UUIDS.trace
  });

  assert.match(client.queries[0]!.text, /BEGIN/);
  assert.match(client.queries[1]!.text, /INSERT INTO road_event_signals/);
  assert.match(client.queries[2]!.text, /INSERT INTO audit_logs/);
  assert.match(client.queries[3]!.text, /INSERT INTO road_event_timeline/);
  assert.match(client.queries[4]!.text, /COMMIT/);
  assert.equal(client.released, true);
});

test('duplicate signal attachment does not duplicate audit/timeline entries', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: null },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: null }
  ]);
  const adapter = new PostgresSignalAttachmentAdapter(new SingleClientPool(client));

  await adapter.attach({
    roadEventId: UUIDS.event,
    signalId: UUIDS.signal,
    matchScore: 0.9,
    mergeReasons: ['duplicate_replay'],
    actor: { actorId: UUIDS.actor, roles: ['INTEGRATION_SERVICE'], tenantId: TENANT_ID, purpose: PURPOSE },
    traceId: UUIDS.trace
  });

  assert.equal(client.queries.length, 3);
  assert.match(client.queries[2]!.text, /COMMIT/);
});

test('audit timeline adapter returns ordered immutable audit projections', async () => {
  const client = new ScriptedClient([{
    rows: [{
      action: 'road_event.transitioned',
      actor_type: 'SUPERVISOR',
      actor_id: UUIDS.actor,
      before_state: { version: 1 },
      after_state: { version: 2 },
      reason: 'validated',
      trace_id: UUIDS.trace,
      occurred_at: '2026-08-19T10:00:00.000Z'
    }],
    rowCount: 1
  }]);
  const adapter = new PostgresAuditTimelineAdapter(new SingleClientPool(client));

  assert.deepEqual(await adapter.listForRoadEvent(UUIDS.event), [{
    action: 'road_event.transitioned',
    actorType: 'SUPERVISOR',
    actorId: UUIDS.actor,
    beforeState: { version: 1 },
    afterState: { version: 2 },
    reason: 'validated',
    traceId: UUIDS.trace,
    occurredAt: '2026-08-19T10:00:00.000Z'
  }]);
  assert.match(client.queries[0]!.text, /ORDER BY occurred_at ASC, id ASC/);
});
