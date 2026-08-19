import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeterministicIntegrationSimulator,
  IntegrationPartner,
  IntegrationPurpose,
  IntegrationSourceSnapshot,
  projectMinimumNecessary
} from './integration-lifecycle.js';

const SOURCE: IntegrationSourceSnapshot = {
  roadEventId: 'road-event-1',
  tenantId: 'riyadh-pilot',
  occurredAt: '2026-08-19T20:00:00.000Z',
  location: { latitude: 24.7136, longitude: 46.6753 },
  severity: { level: 'S3', score: 82, reasonCodes: ['collision', 'lane_blocked'] },
  humanSafety: { status: 'NEEDS_HELP', responseRequired: true },
  road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' },
  vehicle: { vehicleClass: 'PASSENGER_CAR', mobility: 'DISABLED' },
  insurance: { policyReference: 'policy-ref-123' },
  personal: { phone: '+966500000000', nationalId: 'sensitive-national-id' },
  evidenceRefs: ['evidence-private-1', 'evidence-private-2']
};

const PURPOSE: Readonly<Record<IntegrationPartner, IntegrationPurpose>> = {
  EMERGENCY: 'EMERGENCY_COORDINATION',
  TRAFFIC: 'TRAFFIC_COORDINATION',
  ROAD_OPERATOR: 'TRAFFIC_COORDINATION',
  INSURANCE: 'INSURANCE_COORDINATION',
  TOWING: 'TOWING_COORDINATION',
  ROUTING: 'ROUTE_COORDINATION'
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

test('partner projections expose only the minimum necessary fields', () => {
  const emergency = projectMinimumNecessary('EMERGENCY', SOURCE);
  assert.deepEqual(emergency, {
    roadEventId: 'road-event-1',
    occurredAt: '2026-08-19T20:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    severityLevel: 'S3',
    humanSafety: { status: 'NEEDS_HELP', responseRequired: true }
  });

  const traffic = projectMinimumNecessary('TRAFFIC', SOURCE);
  assert.deepEqual(traffic, {
    roadEventId: 'road-event-1',
    occurredAt: '2026-08-19T20:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    severityLevel: 'S3',
    road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' }
  });

  const insurance = projectMinimumNecessary('INSURANCE', SOURCE);
  assert.deepEqual(insurance, {
    roadEventId: 'road-event-1',
    occurredAt: '2026-08-19T20:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    policyReference: 'policy-ref-123'
  });

  const towing = projectMinimumNecessary('TOWING', SOURCE);
  assert.deepEqual(towing, {
    roadEventId: 'road-event-1',
    location: { latitude: 24.7136, longitude: 46.6753 },
    vehicle: { vehicleClass: 'PASSENGER_CAR', mobility: 'DISABLED' }
  });

  const routing = projectMinimumNecessary('ROUTING', SOURCE);
  assert.deepEqual(routing, {
    roadEventId: 'road-event-1',
    road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' }
  });

  for (const projection of [emergency, traffic, insurance, towing, routing]) {
    const serialized = json(projection);
    assert.equal(serialized.includes('sensitive-national-id'), false);
    assert.equal(serialized.includes('+966500000000'), false);
    assert.equal(serialized.includes('evidence-private'), false);
    assert.equal(serialized.includes('reasonCodes'), false);
    assert.equal(serialized.includes('score'), false);
  }
});

test('prepare enforces partner-purpose binding and required partner data', async () => {
  const adapter = new DeterministicIntegrationSimulator();
  await assert.rejects(
    adapter.prepare({
      requestId: 'req-1',
      partner: 'TRAFFIC',
      purpose: 'INSURANCE_COORDINATION',
      idempotencyKey: 'integration-key-0001',
      source: SOURCE,
      preparedAt: '2026-08-19T20:01:00.000Z'
    }),
    /requires purpose TRAFFIC_COORDINATION/
  );

  await assert.rejects(
    adapter.prepare({
      requestId: 'req-2',
      partner: 'INSURANCE',
      purpose: 'INSURANCE_COORDINATION',
      idempotencyKey: 'integration-key-0002',
      source: { ...SOURCE, insurance: null },
      preparedAt: '2026-08-19T20:01:00.000Z'
    }),
    /policy reference is required/
  );
});

test('simulator implements prepare send status callback and cancel without network I/O', async () => {
  const adapter = new DeterministicIntegrationSimulator();
  const prepared = await adapter.prepare({
    requestId: 'req-emergency-1',
    partner: 'EMERGENCY',
    purpose: PURPOSE.EMERGENCY,
    idempotencyKey: 'integration-key-1001',
    source: SOURCE,
    preparedAt: '2026-08-19T20:01:00.000Z'
  });
  assert.equal(prepared.partner, 'EMERGENCY');

  const receipt = await adapter.send(prepared);
  assert.equal(receipt.state, 'ACCEPTED');
  assert.equal((await adapter.status(receipt.providerRequestId)).state, 'ACCEPTED');

  const acknowledged = await adapter.handleCallback({
    callbackId: 'callback-1',
    providerRequestId: receipt.providerRequestId,
    state: 'ACKNOWLEDGED',
    occurredAt: '2026-08-19T20:02:00.000Z'
  });
  assert.equal(acknowledged.state, 'ACKNOWLEDGED');

  const cancelled = await adapter.cancel(
    receipt.providerRequestId,
    'simulation operator cancellation',
    '2026-08-19T20:03:00.000Z'
  );
  assert.equal(cancelled.state, 'CANCELLED');
});

test('send is logically idempotent and rejects semantic key reuse', async () => {
  const adapter = new DeterministicIntegrationSimulator();
  const prepared = await adapter.prepare({
    requestId: 'req-traffic-1',
    partner: 'TRAFFIC',
    purpose: PURPOSE.TRAFFIC,
    idempotencyKey: 'integration-key-2001',
    source: SOURCE,
    preparedAt: '2026-08-19T20:01:00.000Z'
  });

  const first = await adapter.send(prepared);
  const replay = await adapter.send(prepared);
  assert.deepEqual(replay, first);

  const changed = await adapter.prepare({
    requestId: 'req-traffic-2',
    partner: 'TRAFFIC',
    purpose: PURPOSE.TRAFFIC,
    idempotencyKey: 'integration-key-2001',
    source: { ...SOURCE, roadEventId: 'road-event-2' },
    preparedAt: '2026-08-19T20:01:00.000Z'
  });
  await assert.rejects(adapter.send(changed), /reused with a different request/);
});

test('callback handling is replay-safe and cannot resurrect terminal deliveries', async () => {
  const adapter = new DeterministicIntegrationSimulator();
  const prepared = await adapter.prepare({
    requestId: 'req-routing-1',
    partner: 'ROUTING',
    purpose: PURPOSE.ROUTING,
    idempotencyKey: 'integration-key-3001',
    source: SOURCE,
    preparedAt: '2026-08-19T20:01:00.000Z'
  });
  const receipt = await adapter.send(prepared);

  const callback = {
    callbackId: 'callback-routing-1',
    providerRequestId: receipt.providerRequestId,
    state: 'COMPLETED' as const,
    occurredAt: '2026-08-19T20:02:00.000Z'
  };
  const completed = await adapter.handleCallback(callback);
  assert.equal(completed.state, 'COMPLETED');
  assert.deepEqual(await adapter.handleCallback(callback), completed);

  await assert.rejects(
    adapter.handleCallback({ ...callback, callbackId: 'callback-routing-2', state: 'FAILED', reason: 'late failure' }),
    /cannot transition delivery from COMPLETED/
  );
  await assert.rejects(
    adapter.cancel(receipt.providerRequestId, 'too late', '2026-08-19T20:03:00.000Z'),
    /cannot be cancelled/
  );
});
