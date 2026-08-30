import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkerRuntimeIdentityConfigurationError,
  resolveWorkerRuntimeEnvironment
} from './worker-runtime-identity.js';

const METADATA_URI = 'http://169.254.170.2/v4/1234567890abcdef';
const TASK_A = 'arn:aws:ecs:eu-central-1:123456789012:task/ros-staging/11111111111111111111111111111111';
const TASK_B = 'arn:aws:ecs:eu-central-1:123456789012:task/ros-staging/22222222222222222222222222222222';

function ecsEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ROS_WORKER_ID_SOURCE: 'ecs-task-metadata-v4',
    ROS_WORKER_ID_PREFIX: 'ros-staging',
    ECS_CONTAINER_METADATA_URI_V4: METADATA_URI,
    ...overrides
  };
}

function metadata(taskArn = TASK_A): typeof fetch {
  return async (input, init) => {
    assert.equal(String(input), `${METADATA_URI}/task`);
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ TaskARN: taskArn }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
}

test('explicit worker identities bypass ECS metadata resolution', async () => {
  let called = false;
  const environment = await resolveWorkerRuntimeEnvironment({
    NODE_ENV: 'production',
    ROS_OUTBOX_WORKER_ID: 'explicit-outbox-worker',
    ROS_CONTACT_WORKER_ID: 'explicit-contact-worker'
  }, ['outbox', 'contact'], async () => {
    called = true;
    throw new Error('metadata must not be called');
  });
  assert.equal(called, false);
  assert.equal(environment.ROS_OUTBOX_WORKER_ID, 'explicit-outbox-worker');
  assert.equal(environment.ROS_CONTACT_WORKER_ID, 'explicit-contact-worker');
});

test('ECS task metadata yields stable, role-specific worker identities', async () => {
  const first = await resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox', 'contact'], metadata());
  const repeated = await resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox', 'contact'], metadata());
  const differentTask = await resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox', 'contact'], metadata(TASK_B));

  assert.match(first.ROS_OUTBOX_WORKER_ID ?? '', /^ros-staging:outbox:[a-f0-9]{32}$/);
  assert.match(first.ROS_CONTACT_WORKER_ID ?? '', /^ros-staging:contact:[a-f0-9]{32}$/);
  assert.equal(first.ROS_OUTBOX_WORKER_ID, repeated.ROS_OUTBOX_WORKER_ID);
  assert.equal(first.ROS_CONTACT_WORKER_ID, repeated.ROS_CONTACT_WORKER_ID);
  assert.notEqual(first.ROS_OUTBOX_WORKER_ID, first.ROS_CONTACT_WORKER_ID);
  assert.notEqual(first.ROS_OUTBOX_WORKER_ID, differentTask.ROS_OUTBOX_WORKER_ID);
});

test('ECS worker identity rejects untrusted metadata endpoints', async () => {
  for (const uri of [
    'http://127.0.0.1/v4/task',
    'https://169.254.170.2/v4/task',
    'http://user:password@169.254.170.2/v4/task',
    'http://169.254.170.2/not-v4/task',
    'http://169.254.170.2/v4/task?redirect=http://example.test'
  ]) {
    await assert.rejects(
      resolveWorkerRuntimeEnvironment(ecsEnvironment({ ECS_CONTAINER_METADATA_URI_V4: uri }), ['outbox'], metadata()),
      WorkerRuntimeIdentityConfigurationError
    );
  }
});

test('ECS worker identity fails closed on unsupported source and invalid responses', async () => {
  await assert.rejects(
    resolveWorkerRuntimeEnvironment(ecsEnvironment({ ROS_WORKER_ID_SOURCE: 'hostname' }), ['outbox'], metadata()),
    /ROS_WORKER_ID_SOURCE is unsupported/
  );
  await assert.rejects(
    resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox'], async () => new Response('unavailable', { status: 503 })),
    /status 503/
  );
  await assert.rejects(
    resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox'], async () => new Response('{', { status: 200 })),
    /malformed JSON/
  );
  await assert.rejects(
    resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox'], async () => new Response(JSON.stringify({ TaskARN: 'not-an-arn' }), { status: 200 })),
    /TaskARN is invalid/
  );
  await assert.rejects(
    resolveWorkerRuntimeEnvironment(ecsEnvironment(), ['outbox'], async (_input, init) => {
      assert.equal(init?.redirect, 'error');
      return new Response(null, { status: 302, headers: { location: 'http://example.test/metadata' } });
    }),
    /status 302/
  );
});

test('missing source is left for the existing role-specific fail-closed validation', async () => {
  const environment = await resolveWorkerRuntimeEnvironment({ NODE_ENV: 'production' }, ['outbox'], metadata());
  assert.equal(environment.ROS_OUTBOX_WORKER_ID, undefined);
});
