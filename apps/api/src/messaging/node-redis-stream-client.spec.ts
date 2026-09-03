import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRedisRuntimeOptions,
  NodeRedisStreamClient,
  RedisRuntimeConfigurationError
} from './node-redis-stream-client.js';

function production(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://ros_user:short-lived-token@redis.internal:6379/0',
    ...overrides
  };
}

test('production Redis config requires TLS and disables the offline command queue', () => {
  const options = buildRedisRuntimeOptions(production({
    REDIS_CONNECT_TIMEOUT_MS: '2500',
    REDIS_MAX_RECONNECT_ATTEMPTS: '4'
  }));

  assert.equal(options.url.startsWith('rediss://'), true);
  assert.equal(options.disableOfflineQueue, true);
  assert.equal(options.socket.connectTimeout, 2500);
  assert.equal(options.socket.reconnectStrategy(0), 100);
  assert.equal(options.socket.reconnectStrategy(3), 800);
  assert.ok(options.socket.reconnectStrategy(4) instanceof Error);
});

test('production Redis config fails closed on plaintext redis://', () => {
  assert.throws(
    () => buildRedisRuntimeOptions(production({ REDIS_URL: 'redis://redis.internal:6379/0' })),
    /must use rediss:\/\/ TLS/
  );
});

test('rejects invalid URLs and unbounded reconnect settings', () => {
  assert.throws(
    () => buildRedisRuntimeOptions(production({ REDIS_URL: 'https://redis.internal' })),
    /must use redis:\/\/ or rediss:\/\//
  );
  assert.throws(
    () => buildRedisRuntimeOptions(production({ REDIS_MAX_RECONNECT_ATTEMPTS: '101' })),
    /between 0 and 100/
  );
  assert.throws(
    () => buildRedisRuntimeOptions(production({ REDIS_CONNECT_TIMEOUT_MS: 'invalid' })),
    RedisRuntimeConfigurationError
  );
});

test('non-production local Redis may use plaintext while retaining offline-queue protection', () => {
  const options = buildRedisRuntimeOptions({
    NODE_ENV: 'test',
    REDIS_URL: 'redis://127.0.0.1:6379/0'
  });
  assert.equal(options.url, 'redis://127.0.0.1:6379/0');
  assert.equal(options.disableOfflineQueue, true);
});

test('readiness reconnects a closed client once and coalesces concurrent probes', async () => {
  let connectStarted!: () => void;
  let releaseConnect!: () => void;
  const started = new Promise<void>((resolve) => { connectStarted = resolve; });
  const released = new Promise<void>((resolve) => { releaseConnect = resolve; });
  const fake = {
    isOpen: false,
    isReady: false,
    connectCalls: 0,
    on: () => undefined,
    async connect() {
      fake.connectCalls += 1;
      fake.isOpen = true;
      connectStarted();
      await released;
      fake.isReady = true;
    },
    async ping() { return 'PONG'; },
    async xAdd() { return '1-0'; },
    destroy() {
      fake.isOpen = false;
      fake.isReady = false;
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );

  const firstProbe = client.verifyConnection();
  await started;
  const secondProbe = client.verifyConnection();
  releaseConnect();
  await Promise.all([firstProbe, secondProbe]);
  assert.equal(fake.connectCalls, 1);

  fake.isOpen = false;
  fake.isReady = false;
  await client.verifyConnection();
  assert.equal(fake.connectCalls, 2);
});

test('failed reconnect clears the single-flight guard so a later probe can recover', async () => {
  let rejectNext = true;
  const fake = {
    isOpen: false,
    isReady: false,
    connectCalls: 0,
    on: () => undefined,
    async connect() {
      fake.connectCalls += 1;
      if (rejectNext) {
        rejectNext = false;
        throw new Error('simulated Redis outage');
      }
      fake.isOpen = true;
      fake.isReady = true;
    },
    async ping() { return 'PONG'; },
    async xAdd() { return '1-0'; },
    destroy() {
      fake.isOpen = false;
      fake.isReady = false;
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );

  await assert.rejects(client.verifyConnection(), /simulated Redis outage/);
  await client.verifyConnection();
  assert.equal(fake.connectCalls, 2);
});

test('xadd is fail-fast after claim and never starts a reconnect cycle', async () => {
  const fake = {
    isOpen: false,
    isReady: false,
    connectCalls: 0,
    xaddCalls: 0,
    on: () => undefined,
    async connect() {
      fake.connectCalls += 1;
      fake.isOpen = true;
      fake.isReady = true;
    },
    async ping() { return 'PONG'; },
    async xAdd() {
      fake.xaddCalls += 1;
      return '1-0';
    },
    destroy() {
      fake.isOpen = false;
      fake.isReady = false;
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );

  await assert.rejects(client.xadd('ros:test', '*', { eventId: 'event-1' }), /not ready/);
  assert.equal(fake.connectCalls, 0);
  assert.equal(fake.xaddCalls, 0);

  fake.isOpen = true;
  fake.isReady = true;
  assert.equal(await client.xadd('ros:test', '*', { eventId: 'event-1' }), '1-0');
  assert.equal(fake.connectCalls, 0);
  assert.equal(fake.xaddCalls, 1);

  await client.close();
  await assert.rejects(client.verifyConnection(), /is closing/);
  assert.equal(fake.connectCalls, 0);
});

test('xadd abort destroys the transport and rejects a command stalled after write', async () => {
  let commandStarted!: () => void;
  let rejectCommand!: (error: Error) => void;
  const started = new Promise<void>((resolve) => { commandStarted = resolve; });
  const fake = {
    isOpen: true,
    isReady: true,
    destroyCalls: 0,
    on: () => undefined,
    async connect() {},
    async ping() { return 'PONG'; },
    xAdd() {
      commandStarted();
      return new Promise<string>((_resolve, reject) => { rejectCommand = reject; });
    },
    withAbortSignal() { return { xAdd: fake.xAdd }; },
    destroy() {
      fake.destroyCalls += 1;
      fake.isOpen = false;
      fake.isReady = false;
      rejectCommand(new Error('socket destroyed after publish deadline'));
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );
  const deadline = new AbortController();

  const publish = client.xadd('ros:test', '*', { eventId: 'event-1' }, deadline.signal);
  await started;
  deadline.abort(new Error('publish deadline exceeded'));
  await assert.rejects(publish, /socket destroyed/);
  assert.equal(fake.destroyCalls, 1);
  assert.equal(fake.isOpen, false);
});

test('close interrupts an in-flight connect before awaiting it and is idempotent', async () => {
  let connectStarted!: () => void;
  let rejectConnect!: (error: Error) => void;
  const started = new Promise<void>((resolve) => { connectStarted = resolve; });
  const fake = {
    isOpen: false,
    isReady: false,
    on: () => undefined,
    connect() {
      fake.isOpen = true;
      connectStarted();
      return new Promise<void>((_resolve, reject) => { rejectConnect = reject; });
    },
    async ping() { return 'PONG'; },
    async xAdd() { return '1-0'; },
    destroy() {
      fake.isOpen = false;
      fake.isReady = false;
      rejectConnect(new Error('connection destroyed'));
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );

  const verification = client.verifyConnection();
  await started;
  await Promise.race([
    client.close(),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Redis close exceeded 100ms')), 100);
    })
  ]);
  await assert.rejects(verification, /connection destroyed/);
  await client.close();
  await assert.rejects(client.verifyConnection(), /is closing/);
});

test('an aborted caller stops waiting without cancelling the shared connection attempt', async () => {
  let connectStarted!: () => void;
  let releaseConnect!: () => void;
  const started = new Promise<void>((resolve) => { connectStarted = resolve; });
  const released = new Promise<void>((resolve) => { releaseConnect = resolve; });
  const fake = {
    isOpen: false,
    isReady: false,
    connectCalls: 0,
    on: () => undefined,
    async connect() {
      fake.connectCalls += 1;
      fake.isOpen = true;
      connectStarted();
      await released;
      fake.isReady = true;
    },
    async ping() { return 'PONG'; },
    async xAdd() { return '1-0'; },
    destroy() {
      fake.isOpen = false;
      fake.isReady = false;
    }
  };
  const client = new NodeRedisStreamClient(
    { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379/0' },
    { createClient: () => fake }
  );
  const cancelled = new AbortController();

  const firstProbe = client.verifyConnection(cancelled.signal);
  await started;
  const survivingProbe = client.verifyConnection();
  cancelled.abort(new Error('worker stopping'));
  await assert.rejects(firstProbe, /worker stopping/);
  assert.equal(fake.connectCalls, 1);
  releaseConnect();
  await survivingProbe;
  assert.equal(fake.connectCalls, 1);
});
