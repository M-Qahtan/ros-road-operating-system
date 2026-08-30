import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContactChannel,
  ContactOutboxMessage,
  ContactRuntimeRepositoryPort,
  ContactRuntimeTransaction
} from '../ros-eye/contact-orchestration.js';
import {
  ContactMvpRuntimeConfigurationError,
  createContactMvpRuntime,
  readContactMvpRuntimeOptions
} from './contact-mvp-runtime.js';

function syntheticStaging(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ROS_DEPLOYMENT_PROFILE: 'synthetic-staging',
    ROS_CLOUD_REGION: 'eu-central-1',
    ROS_CLOUD_JURISDICTION: 'Germany / European Union',
    ROS_PILOT_GEOGRAPHY: 'Riyadh, Saudi Arabia',
    ROS_STAGING_DATA_CLASSIFICATION: 'SYNTHETIC_NON_SENSITIVE_ONLY',
    ROS_REAL_INCIDENT_DATA_ALLOWED: 'false',
    ...overrides
  };
}

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

function contactMessage(channel: ContactChannel): ContactOutboxMessage {
  return {
    tenantId: 'tenant-1',
    caseId: 'case-1',
    sessionId: 'session-1',
    messageId: `message-${channel.toLowerCase()}`,
    channel,
    promptId: 'contact.response',
    idempotencyKey: `delivery-${channel.toLowerCase()}`,
    availableAt: '2026-08-21T00:00:00.000Z',
    attempt: 0,
    leaseOwner: 'contact-worker-01',
    leaseExpiresAt: '2026-08-21T00:00:30.000Z',
    deliveredAt: null,
    cancelledAt: null,
    lastErrorCode: null
  };
}

function deliveryRepository(
  channel: ContactChannel,
  observe: (result: 'SENT' | 'UNAVAILABLE') => void
): ContactRuntimeRepositoryPort {
  const message = contactMessage(channel);
  return {
    ...emptyRepository,
    async claimDueOutbox() { return [message]; },
    async processClaimedOutbox(_input, deliver) {
      const result = await deliver(message);
      observe(result);
      return result === 'SENT' ? 'DELIVERED' : 'RETRY';
    }
  };
}

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

test('bounded synthetic staging may use only the explicit in-app contact channel', async () => {
  const runtime = createContactMvpRuntime(emptyRepository, syntheticStaging({
    ROS_CONTACT_WORKER_ID: 'contact-worker-01',
    ROS_CONTACT_CHANNEL_PROFILE: 'in-app-only'
  }), { now: () => new Date('2026-08-21T00:00:00.000Z') });
  assert.deepEqual(await runtime.runOnce(), { sessionsProcessed: 0, messagesProcessed: 0 });

  assert.throws(
    () => createContactMvpRuntime(emptyRepository, syntheticStaging({
      ROS_CONTACT_WORKER_ID: 'contact-worker-01',
      ROS_CONTACT_CHANNEL_PROFILE: 'external-unapproved'
    })),
    /approved channel provider/
  );
  assert.throws(
    () => createContactMvpRuntime(emptyRepository, syntheticStaging({
      ROS_CONTACT_WORKER_ID: 'contact-worker-01',
      ROS_CONTACT_CHANNEL_PROFILE: 'in-app-only',
      ROS_REAL_INCIDENT_DATA_ALLOWED: 'true'
    })),
    /synthetic staging boundary/
  );
});

test('synthetic in-app channel never acknowledges external transports as delivered', async () => {
  for (const [channel, expected] of [
    ['IN_APP', 'SENT'],
    ['PUSH', 'UNAVAILABLE'],
    ['SMS_SIM', 'UNAVAILABLE'],
    ['TELEPHONY_SIM', 'UNAVAILABLE']
  ] as const) {
    let observed: 'SENT' | 'UNAVAILABLE' | undefined;
    const runtime = createContactMvpRuntime(
      deliveryRepository(channel, (result) => { observed = result; }),
      syntheticStaging({
        ROS_CONTACT_WORKER_ID: 'contact-worker-01',
        ROS_CONTACT_CHANNEL_PROFILE: 'in-app-only'
      }),
      { now: () => new Date('2026-08-21T00:00:00.000Z') }
    );

    assert.deepEqual(await runtime.runOnce(), { sessionsProcessed: 0, messagesProcessed: 1 });
    assert.equal(observed, expected);
  }
});

test('staging runtime executes an empty durable worker cycle', async () => {
  const runtime = createContactMvpRuntime(emptyRepository, {
    NODE_ENV: 'staging', ROS_CONTACT_WORKER_ID: 'contact-worker-01'
  }, { now: () => new Date('2026-08-21T00:00:00.000Z') });
  assert.deepEqual(await runtime.runOnce(), { sessionsProcessed: 0, messagesProcessed: 0 });
});
