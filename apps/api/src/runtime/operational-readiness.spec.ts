import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReadiness, RuntimeReadinessProbes, validateRuntimeEnvironment } from './operational-readiness.js';

const persistentEnvironment = {
  NODE_ENV: 'staging',
  ROS_RUNTIME_PROFILE: 'persistent',
  DATABASE_URL: 'postgresql://ros:strong@postgres:5432/ros',
  REDIS_URL: 'redis://:strong@redis:6379'
} as NodeJS.ProcessEnv;

function probes(availability: { database?: boolean; redis?: boolean } = {}): RuntimeReadinessProbes {
  return {
    database: async () => {
      if (availability.database === false) throw new Error('database unavailable');
    },
    redis: async () => {
      if (availability.redis === false) throw new Error('redis unavailable');
    }
  };
}

test('persistent runtime validates only active core dependencies', () => {
  assert.throws(
    () => validateRuntimeEnvironment({ NODE_ENV: 'production', REDIS_URL: 'rediss://redis:6379' }),
    /DATABASE_URL/
  );
  assert.throws(
    () => validateRuntimeEnvironment({ NODE_ENV: 'staging', ROS_RUNTIME_PROFILE: 'persistent', DATABASE_URL: persistentEnvironment.DATABASE_URL }),
    /REDIS_URL/
  );
  assert.doesNotThrow(() => validateRuntimeEnvironment(persistentEnvironment));
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: 'staging', ROS_RUNTIME_PROFILE: 'simulation' }));
});

test('simulation readiness has no live core dependency probes and keeps storage as an external gate', async () => {
  assert.deepEqual(await evaluateReadiness({}), {
    status: 'ready',
    checks: {
      database: 'not_required',
      redis: 'not_required',
      objectStorage: 'external_gate'
    }
  });
});

test('persistent readiness succeeds only when both live runtime probes succeed', async () => {
  assert.deepEqual(await evaluateReadiness(probes()), {
    status: 'ready',
    checks: {
      database: 'reachable',
      redis: 'reachable',
      objectStorage: 'external_gate'
    }
  });
});

test('Redis protocol failure fails readiness closed', async () => {
  assert.deepEqual(await evaluateReadiness(probes({ redis: false })), {
    status: 'not_ready',
    checks: {
      database: 'reachable',
      redis: 'unreachable',
      objectStorage: 'external_gate'
    }
  });
});

test('PostgreSQL protocol/schema failure fails readiness closed', async () => {
  assert.deepEqual(await evaluateReadiness(probes({ database: false })), {
    status: 'not_ready',
    checks: {
      database: 'unreachable',
      redis: 'reachable',
      objectStorage: 'external_gate'
    }
  });
});
