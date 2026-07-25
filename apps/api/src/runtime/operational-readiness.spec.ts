import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReadiness, validateRuntimeEnvironment } from './operational-readiness.js';

const secureEnvironment = {
  NODE_ENV: 'staging',
  DATABASE_URL: 'postgresql://ros:strong@postgres:5432/ros',
  REDIS_URL: 'redis://:strong@redis:6379',
  OBJECT_STORAGE_ENDPOINT: 'http://minio:9000',
  OBJECT_STORAGE_ACCESS_KEY: 'ros-staging',
  OBJECT_STORAGE_SECRET_KEY: 'a'.repeat(40),
  OBJECT_STORAGE_BUCKET: 'ros-evidence',
  JWT_SECRET: 'b'.repeat(40)
} as NodeJS.ProcessEnv;

test('non-development runtime fails closed for missing or unsafe secrets', () => {
  assert.throws(() => validateRuntimeEnvironment({ NODE_ENV: 'staging' }), /Missing required/);
  assert.throws(() => validateRuntimeEnvironment({ ...secureEnvironment, JWT_SECRET: 'change-me' }), /strong externally supplied/);
  assert.doesNotThrow(() => validateRuntimeEnvironment(secureEnvironment));
});

test('liveness is independent while readiness reports missing dependencies', () => {
  assert.deepEqual(evaluateReadiness({}), {
    status: 'not_ready',
    checks: { database: 'missing', redis: 'missing', objectStorage: 'missing' }
  });
  assert.equal(evaluateReadiness(secureEnvironment).status, 'ready');
});
