import assert from 'node:assert/strict';
import test from 'node:test';
import { IdempotencyInFlightError } from '../../application/ports.js';
import { PostgresIdempotencyAdapter } from './postgres-road-event-support.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

class ScriptedClient implements PostgresClient {
  readonly queries: string[] = [];
  released = false;
  constructor(private readonly results: PostgresQueryResult[]) {}

  async query<Row = unknown>(text: string): Promise<PostgresQueryResult<Row>> {
    this.queries.push(text);
    return (this.results.shift() ?? { rows: [], rowCount: null }) as PostgresQueryResult<Row>;
  }

  release(): void { this.released = true; }
}

class SingleClientPool implements PostgresPool {
  constructor(readonly client: ScriptedClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

test('Postgres idempotency fencing holds a transaction-scoped advisory lock around the operation', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: null },
    { rows: [{ acquired: true }], rowCount: 1 },
    { rows: [], rowCount: null }
  ]);
  const adapter = new PostgresIdempotencyAdapter(new SingleClientPool(client));
  let executions = 0;

  const result = await adapter.executeExclusively('road_event:create', 'request-0003', async () => {
    executions += 1;
    return 'completed';
  });

  assert.equal(result, 'completed');
  assert.equal(executions, 1);
  assert.match(client.queries[0]!, /BEGIN/);
  assert.match(client.queries[1]!, /pg_try_advisory_xact_lock/);
  assert.match(client.queries[2]!, /COMMIT/);
  assert.equal(client.released, true);
});

test('Postgres idempotency fencing rejects an already in-flight key without executing work', async () => {
  const client = new ScriptedClient([
    { rows: [], rowCount: null },
    { rows: [{ acquired: false }], rowCount: 1 },
    { rows: [], rowCount: null }
  ]);
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
  assert.match(client.queries[2]!, /ROLLBACK/);
  assert.equal(client.released, true);
});
