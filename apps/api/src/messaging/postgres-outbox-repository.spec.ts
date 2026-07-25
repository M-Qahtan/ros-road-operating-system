import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresOutboxRepository } from './postgres-outbox-repository.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';

interface QueryCapture { readonly text: string; readonly values: readonly unknown[]; }

class FakeClient implements PostgresClient {
  readonly queries: QueryCapture[] = [];
  constructor(private readonly handler: (text: string) => PostgresQueryResult<unknown>) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text) as PostgresQueryResult<Row>;
  }
  release(): void {}
}

class FakePool implements PostgresPool {
  constructor(private readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  aggregate_type: 'RoadEvent',
  aggregate_id: '22222222-2222-4222-8222-222222222222',
  event_type: 'RoadEventConfirmed',
  payload: { status: 'CONFIRMED' },
  correlation_id: '33333333-3333-4333-8333-333333333333',
  causation_id: null,
  trace_id: '44444444-4444-4444-8444-444444444444',
  occurred_at: '2026-07-25T03:00:00.000Z',
  retry_count: 0
};

test('claimBatch uses SKIP LOCKED and an expiring worker lease', async () => {
  const client = new FakeClient(() => ({ rows: [row], rowCount: 1 }));
  const repository = new PostgresOutboxRepository(new FakePool(client));
  const messages = await repository.claimBatch('worker-a', 25, 30_000);
  assert.equal(messages.length, 1);
  assert.match(client.queries[0]!.text, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.queries[0]!.text, /locked_until < now\(\)/);
  assert.deepEqual(client.queries[0]!.values, [25, 'worker-a', 30_000]);
  assert.equal(messages[0]?.traceId, row.trace_id);
});

test('acknowledgement fails when the worker no longer owns the lease', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 0 }));
  const repository = new PostgresOutboxRepository(new FakePool(client));
  await assert.rejects(
    () => repository.markPublished(row.id, 'worker-a', new Date('2026-07-25T03:05:00.000Z')),
    /no longer owned/
  );
});

test('failure update increments retry and can mark a dead letter', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const repository = new PostgresOutboxRepository(new FakePool(client));
  await repository.markFailed(
    row.id,
    'worker-a',
    'poison message',
    new Date('2026-07-25T03:06:00.000Z'),
    new Date('2026-07-25T03:05:00.000Z')
  );
  assert.match(client.queries[0]!.text, /retry_count = retry_count \+ 1/);
  assert.match(client.queries[0]!.text, /dead_lettered_at = \$4/);
  assert.equal(client.queries[0]!.values[4], 'poison message');
});
