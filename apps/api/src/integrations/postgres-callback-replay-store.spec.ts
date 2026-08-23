import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';
import { PostgresCallbackReplayStore } from './postgres-callback-replay-store.js';

class ScriptedClient implements PostgresClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  released = false;

  constructor(private readonly results: PostgresQueryResult[]) {}

  async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    const result = this.results.shift();
    if (result === undefined) throw new Error('No scripted result remains');
    return result as PostgresQueryResult<Row>;
  }

  release(): void { this.released = true; }
}

class SingleClientPool implements PostgresPool {
  constructor(readonly client: ScriptedClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

const PROFILE = 'traffic-sandbox.riyadh';
const NONCE = 'nonce-0000000000000001';

test('claims a previously unseen callback nonce within its profile', async () => {
  const client = new ScriptedClient([{ rows: [{ nonce: NONCE }], rowCount: 1 }]);
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  assert.equal(await store.claim(PROFILE, NONCE, 1_800_000_300), true);
  assert.match(client.queries[0]!.text, /ON CONFLICT \(profile_id, nonce\) DO NOTHING/);
  assert.deepEqual(client.queries[0]!.values, [PROFILE, NONCE, 1_800_000_300]);
  assert.equal(client.released, true);
});

test('returns false when the same profile and nonce were already claimed', async () => {
  const client = new ScriptedClient([{ rows: [], rowCount: 0 }]);
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  assert.equal(await store.claim(PROFILE, NONCE, 1_800_000_300), false);
  assert.equal(client.released, true);
});

test('rejects malformed profile nonce and expiry before touching Postgres', async () => {
  const client = new ScriptedClient([{ rows: [], rowCount: 0 }]);
  const store = new PostgresCallbackReplayStore(new SingleClientPool(client));

  await assert.rejects(store.claim(' bad profile ', NONCE, 1_800_000_300), /profileId must be a canonical token/);
  await assert.rejects(store.claim(PROFILE, 'short', 1_800_000_300), /nonce must be a canonical token/);
  await assert.rejects(store.claim(PROFILE, NONCE, 0), /expiry must be a positive/);
  assert.equal(client.queries.length, 0);
  assert.equal(client.released, false);
});
