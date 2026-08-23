import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRedisRuntimeOptions, RedisRuntimeConfigurationError } from './node-redis-stream-client.js';

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
