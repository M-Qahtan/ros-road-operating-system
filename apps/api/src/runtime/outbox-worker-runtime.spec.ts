import assert from 'node:assert/strict';
import test from 'node:test';
import { RedisRuntimeClient } from '../messaging/node-redis-stream-client.js';
import { PostgresClient, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';
import { PgRuntimePool } from '../persistence/postgres/pg-postgres-pool.js';
import {
  OutboxRuntimeConfigurationError,
  OutboxRuntimeOptions,
  OutboxWorkerRuntime,
  readOutboxRuntimeOptions
} from './outbox-worker-runtime.js';

const OPTIONS: OutboxRuntimeOptions = {
  workerId: 'runtime-test-worker',
  stream: 'ros:test-events',
  batchSize: 1,
  lockDurationMs: 2_000,
  publishTimeoutMs: 500,
  maximumAttempts: 3,
  baseRetryDelayMs: 10,
  maximumRetryDelayMs: 100,
  idlePollMs: 25
};

class FakeRuntimePool implements PgRuntimePool {
  verifyCalls = 0;
  connectCalls = 0;
  claimQueries = 0;
  ownedUpdates = 0;
  failVerification = false;
  failConnect = false;
  onClaim: (() => void) | undefined;
  outboxRows: readonly Record<string, unknown>[] = [];

  async connect(): Promise<PostgresClient> {
    this.connectCalls += 1;
    if (this.failConnect) throw new Error('postgres claim unavailable');
    return {
      query: async <Row>(text: string): Promise<PostgresQueryResult<Row>> => {
        if (text.includes('WITH candidates AS')) {
          this.claimQueries += 1;
          this.onClaim?.();
          return { rows: this.outboxRows as readonly Row[], rowCount: this.outboxRows.length };
        }
        if (text.includes('UPDATE outbox_events')) {
          this.ownedUpdates += 1;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined
    };
  }

  async verifyConnection(): Promise<void> {
    this.verifyCalls += 1;
    if (this.failVerification) throw new Error('postgres unavailable');
  }

  async verifyReadiness(): Promise<void> { await this.verifyConnection(); }
  async close(): Promise<void> {}
}

class FakeRuntimeRedis implements RedisRuntimeClient {
  available = true;
  verifyCalls = 0;
  xaddCalls = 0;
  failNextXadd = false;
  get isReady(): boolean { return this.available; }

  async connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) throw signal.reason;
    if (!this.available) throw new Error('redis unavailable');
  }

  async verifyConnection(signal?: AbortSignal): Promise<void> {
    this.verifyCalls += 1;
    if (signal?.aborted === true) throw signal.reason;
    if (!this.available) throw new Error('redis unavailable');
  }

  async xadd(): Promise<string> {
    this.xaddCalls += 1;
    if (this.failNextXadd) {
      this.failNextXadd = false;
      this.available = false;
      throw new Error('redis disconnected after preflight');
    }
    if (!this.available) throw new Error('redis unavailable');
    return '1-0';
  }

  async close(): Promise<void> { this.available = false; }
}

test('production requires a stable explicit outbox worker id', () => {
  assert.throws(
    () => readOutboxRuntimeOptions({ NODE_ENV: 'production' }),
    /ROS_OUTBOX_WORKER_ID is required/
  );
});

test('production outbox defaults use a small bounded batch and finite retry policy', () => {
  const options = readOutboxRuntimeOptions({
    NODE_ENV: 'production',
    ROS_OUTBOX_WORKER_ID: 'riyadh-worker-01'
  });
  assert.deepEqual(options, {
    workerId: 'riyadh-worker-01',
    stream: 'ros:integration-events',
    batchSize: 5,
    lockDurationMs: 30000,
    publishTimeoutMs: 5000,
    maximumAttempts: 8,
    baseRetryDelayMs: 500,
    maximumRetryDelayMs: 30000,
    idlePollMs: 250
  });
});

test('outbox runtime rejects unsafe retry and batch configuration', () => {
  assert.throws(
    () => readOutboxRuntimeOptions({
      NODE_ENV: 'production',
      ROS_OUTBOX_WORKER_ID: 'worker-1',
      ROS_OUTBOX_BATCH_SIZE: '101'
    }),
    /between 1 and 100/
  );
  assert.throws(
    () => readOutboxRuntimeOptions({
      NODE_ENV: 'production',
      ROS_OUTBOX_WORKER_ID: 'worker-1',
      ROS_OUTBOX_BASE_RETRY_DELAY_MS: '5000',
      ROS_OUTBOX_MAXIMUM_RETRY_DELAY_MS: '1000'
    }),
    /cannot exceed/
  );
  assert.throws(
    () => readOutboxRuntimeOptions({
      NODE_ENV: 'production',
      ROS_OUTBOX_WORKER_ID: 'worker-1',
      ROS_OUTBOX_IDLE_POLL_MS: 'invalid'
    }),
    OutboxRuntimeConfigurationError
  );
  assert.throws(
    () => readOutboxRuntimeOptions({
      NODE_ENV: 'production',
      ROS_OUTBOX_WORKER_ID: 'worker-1',
      ROS_OUTBOX_LOCK_DURATION_MS: '2000',
      ROS_OUTBOX_PUBLISH_TIMEOUT_MS: '1500'
    }),
    /leave at least 1000ms/
  );
});

test('development may use the deterministic local worker id', () => {
  assert.equal(
    readOutboxRuntimeOptions({ NODE_ENV: 'development' }).workerId,
    'local-outbox-worker'
  );
});

test('runOnce reconnects Redis before acquiring any PostgreSQL outbox lease', async () => {
  const postgres = new FakeRuntimePool();
  const redis = new FakeRuntimeRedis();
  redis.available = false;
  const runtime = new OutboxWorkerRuntime(postgres, redis, OPTIONS);

  await assert.rejects(runtime.runOnce(), /redis unavailable/);
  assert.equal(redis.verifyCalls, 1);
  assert.equal(postgres.connectCalls, 0);
  assert.equal(postgres.claimQueries, 0);
});

test('continuous worker retries Redis before claim and resumes after recovery', async () => {
  const postgres = new FakeRuntimePool();
  const redis = new FakeRuntimeRedis();
  const stop = new AbortController();
  let firstProbe = true;
  redis.verifyConnection = async (signal?: AbortSignal) => {
    redis.verifyCalls += 1;
    if (signal?.aborted === true) throw signal.reason;
    if (firstProbe) {
      firstProbe = false;
      throw new Error('redis unavailable');
    }
    redis.available = true;
  };
  postgres.onClaim = () => stop.abort('test complete');
  const runtime = new OutboxWorkerRuntime(postgres, redis, OPTIONS);

  await runtime.run(stop.signal);
  assert.equal(redis.verifyCalls, 2);
  assert.equal(postgres.verifyCalls, 1);
  assert.equal(postgres.claimQueries, 1);
});

test('simultaneous Redis and PostgreSQL loss retains required-worker fail-stop', async () => {
  const postgres = new FakeRuntimePool();
  postgres.failVerification = true;
  const redis = new FakeRuntimeRedis();
  redis.available = false;
  const runtime = new OutboxWorkerRuntime(postgres, redis, OPTIONS);

  await assert.rejects(runtime.run(new AbortController().signal), /postgres unavailable/);
  assert.equal(postgres.verifyCalls, 1);
  assert.equal(postgres.claimQueries, 0);
});

test('healthy Redis does not mask a PostgreSQL claim failure', async () => {
  const postgres = new FakeRuntimePool();
  postgres.failConnect = true;
  const redis = new FakeRuntimeRedis();
  const runtime = new OutboxWorkerRuntime(postgres, redis, OPTIONS);

  await assert.rejects(runtime.run(new AbortController().signal), /postgres claim unavailable/);
  assert.equal(redis.verifyCalls, 1);
});

test('a disconnect after preflight retries one claimed row and blocks further claims', async () => {
  const postgres = new FakeRuntimePool();
  postgres.outboxRows = [{
    id: '11111111-1111-4111-8111-111111111111',
    aggregate_type: 'RoadEvent',
    aggregate_id: '22222222-2222-4222-8222-222222222222',
    event_type: 'SafetyEscalated',
    payload: { severity: 'S4' },
    correlation_id: '33333333-3333-4333-8333-333333333333',
    causation_id: null,
    trace_id: null,
    tenant_id: 'riyadh-pilot',
    purpose: 'road-safety-response',
    occurred_at: new Date('2026-09-01T00:00:00.000Z'),
    retry_count: 0
  }];
  const redis = new FakeRuntimeRedis();
  redis.failNextXadd = true;
  const runtime = new OutboxWorkerRuntime(postgres, redis, OPTIONS);

  assert.deepEqual(await runtime.runOnce(), { claimed: 1, published: 0, retried: 1, deadLettered: 0 });
  assert.equal(redis.xaddCalls, 1);
  assert.equal(postgres.claimQueries, 1);
  assert.equal(postgres.ownedUpdates, 1);
  await assert.rejects(runtime.runOnce(), /redis unavailable/);
  assert.equal(postgres.claimQueries, 1);
});
