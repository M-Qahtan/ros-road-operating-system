import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReadiness, ReadinessProbes, validateRuntimeEnvironment } from './operational-readiness.js';

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

const probes = (availability: { database?: boolean; redis?: boolean; objectStorage?: boolean } = {}): ReadinessProbes => ({
  database: async () => availability.database ?? true,
  redis: async () => availability.redis ?? true,
  objectStorage: async () => availability.objectStorage ?? true
});

test('non-development runtime fails closed for missing or unsafe secrets', () => {
  assert.throws(() => validateRuntimeEnvironment({ NODE_ENV: 'staging' }), /Missing required/);
  assert.throws(() => validateRuntimeEnvironment({ ...secureEnvironment, JWT_SECRET: 'change-me' }), /strong externally supplied/);
  assert.doesNotThrow(() => validateRuntimeEnvironment(secureEnvironment));
});

test('readiness reports missing dependencies without probing them', async () => {
  assert.deepEqual(await evaluateReadiness({}, probes()), {
    status: 'not_ready',
    checks: { database: 'missing', redis: 'missing', objectStorage: 'missing' }
  });
});

test('readiness succeeds only when every configured dependency is reachable', async () => {
  assert.deepEqual(await evaluateReadiness(secureEnvironment, probes()), {
    status: 'ready',
    checks: { database: 'reachable', redis: 'reachable', objectStorage: 'reachable' }
  });
});

test('Redis outage fails readiness closed while preserving dependency-specific evidence', async () => {
  assert.deepEqual(await evaluateReadiness(secureEnvironment, probes({ redis: false })), {
    status: 'not_ready',
    checks: { database: 'reachable', redis: 'unreachable', objectStorage: 'reachable' }
  });
});

test('object-storage outage fails readiness closed', async () => {
  assert.deepEqual(await evaluateReadiness(secureEnvironment, probes({ objectStorage: false })), {
    status: 'not_ready',
    checks: { database: 'reachable', redis: 'reachable', objectStorage: 'unreachable' }
  });
});

test('database outage fails readiness closed', async () => {
  assert.deepEqual(await evaluateReadiness(secureEnvironment, probes({ database: false })), {
    status: 'not_ready',
    checks: { database: 'unreachable', redis: 'reachable', objectStorage: 'reachable' }
  });
});
