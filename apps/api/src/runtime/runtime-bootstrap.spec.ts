import assert from 'node:assert/strict';
import test from 'node:test';
import { RedisRuntimeClient } from '../messaging/node-redis-stream-client.js';
import { PgRuntimePool } from '../persistence/postgres/pg-postgres-pool.js';
import { PostgresClient } from '../persistence/postgres/postgres-types.js';
import { bootstrapRoadEventRuntime, RuntimeBootstrapError } from './runtime-bootstrap.js';

class FakePostgresPool implements PgRuntimePool {
  verified = false;
  closed = false;
  failVerification = false;

  async connect(): Promise<PostgresClient> {
    return {
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {}
    };
  }

  async verifyConnection(): Promise<void> {
    if (this.failVerification) throw new Error('postgres unavailable');
    this.verified = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeRedisClient implements RedisRuntimeClient {
  connected = false;
  closed = false;
  failConnection = false;
  get isReady(): boolean { return this.connected && !this.closed; }

  async connect(): Promise<void> {
    if (this.failConnection) throw new Error('redis unavailable');
    this.connected = true;
  }

  async xadd(): Promise<string> {
    if (!this.isReady) throw new Error('not ready');
    return '1-0';
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

test('development uses deterministic simulation without constructing network clients', async () => {
  let factoriesCalled = false;
  const runtime = await bootstrapRoadEventRuntime(
    { NODE_ENV: 'development' },
    {
      createPostgresPool: () => { factoriesCalled = true; return new FakePostgresPool(); },
      createRedisClient: () => { factoriesCalled = true; return new FakeRedisClient(); }
    }
  );

  assert.equal(runtime.mode, 'simulation');
  assert.equal(runtime.redis, null);
  assert.equal(factoriesCalled, false);
  await runtime.close();
});

test('production initializes PostgreSQL and Redis before exposing persistent application runtime', async () => {
  const postgres = new FakePostgresPool();
  const redis = new FakeRedisClient();
  const runtime = await bootstrapRoadEventRuntime(
    { NODE_ENV: 'production', ROS_RUNTIME_PROFILE: 'persistent' },
    {
      createPostgresPool: () => postgres,
      createRedisClient: () => redis
    }
  );

  assert.equal(runtime.mode, 'persistent');
  assert.equal(postgres.verified, true);
  assert.equal(redis.connected, true);
  assert.equal(runtime.redis, redis);

  await runtime.close();
  assert.equal(postgres.closed, true);
  assert.equal(redis.closed, true);
});

test('persistent bootstrap fails closed and cleans resources when PostgreSQL is unavailable', async () => {
  const postgres = new FakePostgresPool();
  const redis = new FakeRedisClient();
  postgres.failVerification = true;

  await assert.rejects(
    bootstrapRoadEventRuntime(
      { NODE_ENV: 'production', ROS_RUNTIME_PROFILE: 'persistent' },
      { createPostgresPool: () => postgres, createRedisClient: () => redis }
    ),
    RuntimeBootstrapError
  );
  assert.equal(postgres.closed, true);
  assert.equal(redis.closed, true);
  assert.equal(redis.connected, false);
});

test('persistent bootstrap fails closed and cleans resources when Redis is unavailable', async () => {
  const postgres = new FakePostgresPool();
  const redis = new FakeRedisClient();
  redis.failConnection = true;

  await assert.rejects(
    bootstrapRoadEventRuntime(
      { NODE_ENV: 'production', ROS_RUNTIME_PROFILE: 'persistent' },
      { createPostgresPool: () => postgres, createRedisClient: () => redis }
    ),
    RuntimeBootstrapError
  );
  assert.equal(postgres.verified, true);
  assert.equal(postgres.closed, true);
  assert.equal(redis.closed, true);
});

test('non-simulation staging must opt into persistent mode explicitly', async () => {
  await assert.rejects(
    bootstrapRoadEventRuntime({ NODE_ENV: 'staging' }),
    /ROS_RUNTIME_PROFILE=persistent/
  );
});
