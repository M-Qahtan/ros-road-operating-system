import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContactRuntimeRepositoryPort,
  ContactRuntimeTransaction
} from '../ros-eye/contact-orchestration.js';
import {
  ContactMvpRuntimeConfigurationError,
  createContactMvpRuntime,
  readContactMvpRuntimeOptions
} from './contact-mvp-runtime.js';

const emptyRepository: ContactRuntimeRepositoryPort = {
  async transaction<T>(_work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> {
    throw new Error('transaction is not expected');
  },
  async claimDueSessions() { return []; },
  async releaseLease() {},
  async claimDueOutbox() { return []; },
  async processClaimedOutbox() { return 'CONFLICT'; },
  async releaseOutboxLease() {}
};

test('staging contact worker requires stable identity and uses bounded options', () => {
  assert.throws(
    () => readContactMvpRuntimeOptions({ NODE_ENV: 'staging' }),
    /ROS_CONTACT_WORKER_ID is required/
  );
  assert.deepEqual(readContactMvpRuntimeOptions({
    NODE_ENV: 'staging', ROS_CONTACT_WORKER_ID: 'contact-worker-01'
  }), { workerId: 'contact-worker-01', idlePollMs: 250, batchSize: 25 });
  assert.throws(
    () => readContactMvpRuntimeOptions({
      NODE_ENV: 'staging', ROS_CONTACT_WORKER_ID: 'contact-worker-01', ROS_CONTACT_BATCH_SIZE: '501'
    }),
    ContactMvpRuntimeConfigurationError
  );
});

test('production refuses the staging-only in-app contact channel', () => {
  assert.throws(
    () => createContactMvpRuntime(emptyRepository, {
      NODE_ENV: 'production', ROS_CONTACT_WORKER_ID: 'contact-worker-01'
    }),
    /approved channel provider/
  );
});

test('staging runtime executes an empty durable worker cycle', async () => {
  const runtime = createContactMvpRuntime(emptyRepository, {
    NODE_ENV: 'staging', ROS_CONTACT_WORKER_ID: 'contact-worker-01'
  }, { now: () => new Date('2026-08-21T00:00:00.000Z') });
  assert.deepEqual(await runtime.runOnce(), { sessionsProcessed: 0, messagesProcessed: 0 });
});
