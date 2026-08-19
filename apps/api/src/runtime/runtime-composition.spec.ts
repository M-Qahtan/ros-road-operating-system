import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoadEventApplicationForRuntime } from './runtime-composition.js';

test('allows the in-memory composition in development', () => {
  assert.doesNotThrow(() => createRoadEventApplicationForRuntime({ NODE_ENV: 'development' }));
});

test('allows the in-memory composition in test', () => {
  assert.doesNotThrow(() => createRoadEventApplicationForRuntime({ NODE_ENV: 'test' }));
});

test('fails closed in production instead of silently using memory adapters', () => {
  assert.throws(
    () => createRoadEventApplicationForRuntime({ NODE_ENV: 'production' }),
    /Persistent runtime adapters are required/
  );
});

test('fails closed for any non-development environment', () => {
  assert.throws(
    () => createRoadEventApplicationForRuntime({ NODE_ENV: 'staging' }),
    /refusing in-memory fallback/
  );
});
