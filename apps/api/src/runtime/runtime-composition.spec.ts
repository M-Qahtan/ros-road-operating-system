import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import {
  createPersistentRoadEventApplication,
  createRoadEventApplicationForRuntime
} from './runtime-composition.js';

test('allows the in-memory composition in development', () => {
  assert.doesNotThrow(() => createRoadEventApplicationForRuntime({ NODE_ENV: 'development' }));
});

test('allows the in-memory composition in test', () => {
  assert.doesNotThrow(() => createRoadEventApplicationForRuntime({ NODE_ENV: 'test' }));
});

test('allows explicit simulation profile in non-production staging', () => {
  assert.doesNotThrow(() =>
    createRoadEventApplicationForRuntime({ NODE_ENV: 'staging', ROS_RUNTIME_PROFILE: 'simulation' })
  );
});

test('fails closed for staging without explicit simulation profile', () => {
  assert.throws(
    () => createRoadEventApplicationForRuntime({ NODE_ENV: 'staging' }),
    /refusing implicit in-memory fallback/
  );
});

test('fails closed in production even if simulation profile is requested', () => {
  assert.throws(
    () =>
      createRoadEventApplicationForRuntime({
        NODE_ENV: 'production',
        ROS_RUNTIME_PROFILE: 'simulation'
      }),
    /Persistent runtime adapters are required/
  );
});

test('persistent RoadEvent composition requires only an injected PostgresPool and no memory adapter', () => {
  const pool: PostgresPool = {
    connect: async () => {
      throw new Error('construction must not open a database connection');
    }
  };
  assert.doesNotThrow(() => createPersistentRoadEventApplication(pool));
});
