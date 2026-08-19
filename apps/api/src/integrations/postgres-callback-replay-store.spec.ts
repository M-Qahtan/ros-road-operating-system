import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';
import { PostgresCallbackReplayStore } from './postgres-callback-replay-store.js';

class ScriptedClient implements PostgresClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  released = false;
  constructor(private readonly result: PostgresQueryResult) {}

  async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.result as PostgresQueryResult<Row>;
  }

  release(): void { this.released = true; }
}

class SingleClientPool implements PostgresPool {
  constructor(readonly client: ScriptedClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

test('claims a previously unseen callback nonce exactly once', async () => {
  const client = new ScriptedClient({ rows: [{ nonce: 'nonce-1' }], rowCount: 1 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  assert.equal(await store.claim('nonce-1', 1_800_000_300), true);
  assert.match(client.queries[0]!.text, /ON CONFLICT \(nonce\) DO NOTHING/);
  assert.deepEqual(client.queries[0]!.values, ['nonce-1', 1_800_000_300]);
  assert.equal(client.released, true);
});

test('returns false when the nonce was already claimed', async () => {
  const client = new ScriptedClient({ rows: [], rowCount: 0 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  assert.equal(await store.claim('nonce-replayed', 1_800_000_300), false);
  assert.equal(client.released, true);
});

test('rejects invalid nonce and expiry before touching Postgres', async () => {
  const client = new ScriptedClient({ rows: [], rowCount: 0 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  await assert.rejects(store.claim('', 1_800_000_300), /nonce must contain/);
  await assert.rejects(store.claim('nonce-valid', 0), /expiry must be a positive/);
  assert.equal(client.queries.length, 0);
});
