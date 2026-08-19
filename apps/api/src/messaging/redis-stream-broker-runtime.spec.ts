import assert from 'node:assert/strict';
import test from 'node:test';
import { RedisStreamClient, RedisStreamEventBroker } from './redis-stream-broker.js';
import { OutboxMessage } from './outbox-types.js';

class CaptureRedisStreamClient implements RedisStreamClient {
  readonly calls: Array<{ readonly stream: string; readonly fields: Readonly<Record<string, string>> }> = [];

  async xadd(stream: string, _id: '*', fields: Readonly<Record<string, string>>): Promise<string> {
    this.calls.push({ stream, fields: { ...fields } });
    return '1-0';
  }
}

const MESSAGE: OutboxMessage = {
  id: '11111111-1111-4111-8111-111111111111',
  aggregateType: 'RoadEvent',
  aggregateId: '22222222-2222-4222-8222-222222222222',
  eventType: 'RoadEventCreated',
  payload: { severity: 'S2' },
  correlationId: '33333333-3333-4333-8333-333333333333',
  occurredAt: new Date('2026-08-19T20:00:00.000Z'),
  retryCount: 0
};

test('runtime broker publishes explicit non-simulation delivery metadata', async () => {
  const client = new CaptureRedisStreamClient();
  const broker = new RedisStreamEventBroker(client, 'ros:integration-events', false);
  await broker.publish(MESSAGE);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0]!.stream, 'ros:integration-events');
  assert.equal(client.calls[0]!.fields.simulationMode, 'false');
  assert.equal(client.calls[0]!.fields.deliveryMode, 'runtime');
});

test('default broker remains simulation-only for deterministic existing harnesses', async () => {
  const client = new CaptureRedisStreamClient();
  const broker = new RedisStreamEventBroker(client);
  await broker.publish(MESSAGE);

  assert.equal(client.calls[0]!.fields.simulationMode, 'true');
  assert.equal(client.calls[0]!.fields.deliveryMode, 'simulation');
});
