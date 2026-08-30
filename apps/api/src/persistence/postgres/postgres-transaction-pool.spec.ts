import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresClient, PostgresPool } from './postgres-types.js';
import { PostgresTransactionPool } from './postgres-transaction-pool.js';

class FakeClient implements PostgresClient {
  readonly queries: string[] = [];
  released = false;
  fail = false;
  async query<Row = unknown>(text: string): Promise<{ rows: readonly Row[]; rowCount: number }> {
    this.queries.push(text);
    if (this.fail && text === 'SELECT protected') throw new Error('failed');
    return { rows: [] as Row[], rowCount: 0 };
  }
  release(): void { this.released = true; }
}

class FakePool implements PostgresPool {
  constructor(readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

test('transaction commits and releases the acquired connection', async () => {
  const client = new FakeClient();
  const pool = new PostgresTransactionPool(new FakePool(client));
  await pool.transaction(async (connection) => { await connection.query('SELECT protected'); });
  assert.deepEqual(client.queries, ['BEGIN', 'SELECT protected', 'COMMIT']);
  assert.equal(client.released, true);
});

test('transaction rolls back while preserving the operation failure', async () => {
  const client = new FakeClient();
  client.fail = true;
  const pool = new PostgresTransactionPool(new FakePool(client));
  await assert.rejects(pool.transaction(async (connection) => { await connection.query('SELECT protected'); }), /failed/);
  assert.deepEqual(client.queries, ['BEGIN', 'SELECT protected', 'ROLLBACK']);
  assert.equal(client.released, true);
});
