import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxRuntimeConfigurationError, readOutboxRuntimeOptions } from './outbox-worker-runtime.js';

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
});

test('development may use the deterministic local worker id', () => {
  assert.equal(
    readOutboxRuntimeOptions({ NODE_ENV: 'development' }).workerId,
    'local-outbox-worker'
  );
});
