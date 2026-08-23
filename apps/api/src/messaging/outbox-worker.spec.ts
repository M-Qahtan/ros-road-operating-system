import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxWorker, calculateRetryDelayMs } from './outbox-worker.js';
import {
  ConsumerIdempotencyStore,
  EventBroker,
  OutboxMessage,
  OutboxRepository
} from './outbox-types.js';
import { SimulatedAgencyConsumer, SimulatedAgencyNotification } from './simulated-agency-consumer.js';

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_SCOPE = { tenantId: 'riyadh-pilot', purpose: 'road-safety-response' } as const;

function message(retryCount = 0): OutboxMessage {
  return {
    id: MESSAGE_ID,
    aggregateType: 'RoadEvent',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    eventType: 'SafetyEscalated',
    payload: { severity: 'S4' },
    correlationId: '33333333-3333-4333-8333-333333333333',
    traceId: '44444444-4444-4444-8444-444444444444',
    ...MESSAGE_SCOPE,
    occurredAt: new Date('2026-07-25T03:00:00.000Z'),
    retryCount
  };
}

class MemoryRepository implements OutboxRepository {
  readonly published: string[] = [];
  readonly failures: Array<{ id: string; deadLettered: boolean; nextAttemptAt: Date }> = [];
  constructor(private readonly batch: readonly OutboxMessage[]) {}
  async claimBatch(): Promise<readonly OutboxMessage[]> { return this.batch; }
  async markPublished(id: string): Promise<void> { this.published.push(id); }
  async markFailed(id: string, _worker: string, _error: string, nextAttemptAt: Date, deadLetteredAt?: Date): Promise<void> {
    this.failures.push({ id, deadLettered: deadLetteredAt !== undefined, nextAttemptAt });
  }
}

class MemoryIdempotency implements ConsumerIdempotencyStore {
  private readonly completed = new Set<string>();
  private readonly active = new Set<string>();
  async tryBegin(consumer: string, id: string): Promise<boolean> {
    const key = `${consumer}:${id}`;
    if (this.completed.has(key) || this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }
  async complete(consumer: string, id: string): Promise<void> {
    const key = `${consumer}:${id}`;
    this.active.delete(key);
    this.completed.add(key);
  }
  async release(consumer: string, id: string): Promise<void> { this.active.delete(`${consumer}:${id}`); }
}

test('worker publishes and acknowledges a claimed message', async () => {
  const repository = new MemoryRepository([message()]);
  const broker: EventBroker = { publish: async () => undefined };
  const worker = new OutboxWorker(repository, broker, {
    workerId: 'worker-a', batchSize: 10, lockDurationMs: 30_000, maximumAttempts: 3,
    baseRetryDelayMs: 1_000, maximumRetryDelayMs: 10_000,
    now: () => new Date('2026-07-25T03:05:00.000Z'), random: () => 1
  });
  assert.deepEqual(await worker.runOnce(), { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
  assert.deepEqual(repository.published, [MESSAGE_ID]);
});

test('failed delivery retries predictably and poison messages dead-letter', async () => {
  const broker: EventBroker = { publish: async () => { throw new Error('provider unavailable'); } };
  const retryRepository = new MemoryRepository([message(0)]);
  const retryWorker = new OutboxWorker(retryRepository, broker, {
    workerId: 'worker-a', batchSize: 10, lockDurationMs: 30_000, maximumAttempts: 3,
    baseRetryDelayMs: 1_000, maximumRetryDelayMs: 10_000,
    now: () => new Date('2026-07-25T03:05:00.000Z'), random: () => 1
  });
  assert.equal((await retryWorker.runOnce()).retried, 1);
  assert.equal(retryRepository.failures[0]?.nextAttemptAt.toISOString(), '2026-07-25T03:05:01.000Z');
  assert.equal(retryRepository.failures[0]?.deadLettered, false);

  const poisonRepository = new MemoryRepository([message(2)]);
  const poisonWorker = new OutboxWorker(poisonRepository, broker, {
    workerId: 'worker-b', batchSize: 10, lockDurationMs: 30_000, maximumAttempts: 3,
    baseRetryDelayMs: 1_000, maximumRetryDelayMs: 10_000,
    now: () => new Date('2026-07-25T03:05:00.000Z'), random: () => 1
  });
  assert.equal((await poisonWorker.runOnce()).deadLettered, 1);
  assert.equal(poisonRepository.failures[0]?.deadLettered, true);
});

test('retry delay is capped and jitter remains bounded', () => {
  assert.equal(calculateRetryDelayMs(1, 1_000, 10_000, () => 0), 500);
  assert.equal(calculateRetryDelayMs(20, 1_000, 10_000, () => 1), 10_000);
});

test('simulated agency consumer tolerates duplicate delivery and preserves trusted scope', async () => {
  const notifications: SimulatedAgencyNotification[] = [];
  const consumer = new SimulatedAgencyConsumer('AMBULANCE', new MemoryIdempotency(), {
    record: async (notification) => { notifications.push(notification); }
  });
  assert.equal(await consumer.consume(message()), 'processed');
  assert.equal(await consumer.consume(message()), 'duplicate');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.simulation, true);
  assert.equal(notifications[0]?.tenantId, MESSAGE_SCOPE.tenantId);
  assert.equal(notifications[0]?.purpose, MESSAGE_SCOPE.purpose);
});

test('simulated agency consumer fails closed for routed RoadEvent without scope', async () => {
  const consumer = new SimulatedAgencyConsumer('AMBULANCE', new MemoryIdempotency(), {
    record: async () => undefined
  });
  const { tenantId: _tenantId, purpose: _purpose, ...unscoped } = message();

  await assert.rejects(
    () => consumer.consume(unscoped),
    /missing trusted tenant\/purpose scope/
  );
});
