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

const binding = { clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION' as const };

test('claims exact principal nonce with key id and immutable replay scope', async () => {
  const client = new ScriptedClient({ rows: [{ nonce: 'nonce-abcdefghijklmnop' }], rowCount: 1 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));
  assert.equal(await store.claim(binding, 'key-2026-08', 'nonce-abcdefghijklmnop', 1_800_000_300), true);
  assert.match(client.queries[0]!.text, /ON CONFLICT \(client_id, tenant_id, purpose, nonce\) DO NOTHING/);
  assert.deepEqual(client.queries[0]!.values, [
    'traffic-sandbox', 'riyadh-pilot', 'TRAFFIC_COORDINATION',
    'nonce-abcdefghijklmnop', 'key-2026-08', 1_800_000_300
  ]);
  assert.equal(client.released, true);
});

test('returns false when the same principal nonce was already claimed', async () => {
  const client = new ScriptedClient({ rows: [], rowCount: 0 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));
  assert.equal(await store.claim(binding, 'key-rotated', 'nonce-abcdefghijklmnop', 1_800_000_300), false);
});

test('rejects malformed binding key nonce and expiry before touching Postgres', async () => {
  const client = new ScriptedClient({ rows: [], rowCount: 0 });
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));
  await assert.rejects(store.claim({ ...binding, clientId: '' }, 'key', 'nonce-abcdefghijklmnop', 1_800_000_300), /clientId is invalid/);
  await assert.rejects(store.claim(binding, '', 'nonce-abcdefghijklmnop', 1_800_000_300), /keyId is invalid/);
  await assert.rejects(store.claim(binding, 'key', 'short', 1_800_000_300), /between 16 and 256/);
  await assert.rejects(store.claim(binding, 'key', 'nonce-abcdefghijklmnop', 0), /expiry must be a positive/);
  assert.equal(client.queries.length, 0);
});
