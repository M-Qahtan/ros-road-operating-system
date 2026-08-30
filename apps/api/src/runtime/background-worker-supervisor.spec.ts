import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundWorkerSupervisor } from './background-worker-supervisor.js';

test('shutdown waits for every worker to finish abort cleanup before returning', async () => {
  const supervisor = new BackgroundWorkerSupervisor();
  const order: string[] = [];

  supervisor.start([
    async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            order.push('worker-clean');
            resolve();
          }, 5);
        }, { once: true });
      });
    }
  ], () => { throw new Error('worker must not fail'); });

  const stopping = supervisor.stop('SIGTERM').then(() => { order.push('stop-complete'); });
  assert.deepEqual(order, []);
  await stopping;
  assert.deepEqual(order, ['worker-clean', 'stop-complete']);
  assert.equal(supervisor.failed, false);
});

test('worker failure is reported once and remains safe to await during shutdown', async () => {
  const supervisor = new BackgroundWorkerSupervisor();
  const failure = new Error('worker failed');
  const reported: unknown[] = [];

  supervisor.start([async () => { throw failure; }], (error) => { reported.push(error); });
  await new Promise<void>((resolve) => { setImmediate(resolve); });

  assert.equal(supervisor.failed, true);
  assert.deepEqual(reported, [failure]);
  await supervisor.stop('WORKER_FAILURE');
});
