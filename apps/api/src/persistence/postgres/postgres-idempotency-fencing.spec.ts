import assert from 'node:assert/strict';
import test from 'node:test';
import { IdempotencyInFlightError } from '../../application/ports.js';
import {
  IdempotencyReservationReleaseError,
  PostgresIdempotencyAdapter
} from './postgres-road-event-support.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

class ScriptedClient implements PostgresClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  releaseCount = 0;
  constructor(private readonly results: PostgresQueryResult[]) {}

  async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return (this.results.shift() ?? { rows: [], rowCount: null }) as PostgresQueryResult<Row>;
  }

  release(): void { this.releaseCount += 1; }
}

class SingleClientPool implements PostgresPool {
  constructor(readonly client: ScriptedClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

test('Postgres fencing creates a durable reservation before work and releases it only after success', async () => {
  const client = new ScriptedClient([
    { rows: [{ fence_token: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 },
    { rows: [{ fence_token: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 }
  ]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));
  let executions = 0;

  const result = await adapter.executeExclusively('road_event:create', 'request-0003', async () => {
    executions += 1;
    return 'completed';
  });

  assert.equal(result, 'completed');
  assert.equal(executions, 1);
  assert.match(client.queries[0]!.text, /INSERT INTO idempotency_reservations/);
  assert.match(client.queries[0]!.text, /ON CONFLICT \(scope, idempotency_key\) DO NOTHING/);
  assert.match(client.queries[1]!.text, /DELETE FROM idempotency_reservations/);
  assert.equal(client.releaseCount, 2);
});

test('Postgres fencing rejects an existing durable reservation without executing work', async () => {
  const client = new ScriptedClient([{ rows: [], rowCount: 0 }]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));
  let executions = 0;

  await assert.rejects(
    adapter.executeExclusively('road_event:create', 'request-0004', async () => {
      executions += 1;
      return 'should-not-run';
    }),
    IdempotencyInFlightError
  );

  assert.equal(executions, 0);
  assert.equal(client.queries.length, 1);
  assert.equal(client.releaseCount, 1);
});

test('operation failure intentionally leaves the durable reservation for reconciliation', async () => {
  const client = new ScriptedClient([
    { rows: [{ fence_token: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 }
  ]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));

  await assert.rejects(
    adapter.executeExclusively('road_event:create', 'request-0005', async () => {
      throw new Error('domain commit outcome unknown');
    }),
    /domain commit outcome unknown/
  );

  assert.equal(client.queries.length, 1);
  assert.doesNotMatch(client.queries[0]!.text, /DELETE FROM idempotency_reservations/);
  assert.equal(client.releaseCount, 1);
});

test('failed reservation cleanup is surfaced and remains fail closed', async () => {
  const client = new ScriptedClient([
    { rows: [{ fence_token: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 },
    { rows: [], rowCount: 0 }
  ]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));

  await assert.rejects(
    adapter.executeExclusively('road_event:create', 'request-0006', async () => 'completed'),
    IdempotencyReservationReleaseError
  );
  assert.equal(client.releaseCount, 2);
});
