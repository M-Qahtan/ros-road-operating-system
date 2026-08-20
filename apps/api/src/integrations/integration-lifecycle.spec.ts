import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
import {
  IntegrationSourceSnapshot,
  PostgresIntegrationSandbox,
  TrustedIntegrationProfile,
  projectMinimumNecessary
} from './integration-lifecycle.js';

const SOURCE: IntegrationSourceSnapshot = {
  roadEventId: 'road-event-projection-1',
  tenantId: 'riyadh-pilot',
  occurredAt: '2026-08-20T02:00:00.000Z',
  location: { latitude: 24.7136, longitude: 46.6753 },
  severity: { level: 'S3', score: 82, reasonCodes: ['collision', 'lane_blocked'] },
  humanSafety: { status: 'NEEDS_HELP', responseRequired: true },
  road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' },
  vehicle: { vehicleClass: 'PASSENGER_CAR', mobility: 'DISABLED' },
  insurance: { policyReference: 'policy-reference-private' },
  personal: { contactReference: 'contact-private-reference', identityReference: 'identity-private-reference' },
  evidenceRefs: ['evidence-private-reference-1', 'evidence-private-reference-2']
};

const TRAFFIC_PROFILE: TrustedIntegrationProfile = {
  profileId: 'traffic-sandbox.riyadh',
  partner: 'TRAFFIC',
  purpose: 'TRAFFIC_COORDINATION',
  tenantId: 'riyadh-pilot',
  mode: 'SIMULATION_ONLY'
};

class NoDatabasePool implements PostgresPool {
  async connect(): Promise<PostgresClient> {
    throw new Error('Database should not be touched by this validation path');
  }
}

function serialized(value: unknown): string { return JSON.stringify(value); }

test('partner projections expose only minimum necessary data', () => {
  assert.deepEqual(projectMinimumNecessary('EMERGENCY', SOURCE), {
    roadEventId: 'road-event-projection-1',
    occurredAt: '2026-08-20T02:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    severityLevel: 'S3',
    humanSafety: { status: 'NEEDS_HELP', responseRequired: true }
  });

  assert.deepEqual(projectMinimumNecessary('TRAFFIC', SOURCE), {
    roadEventId: 'road-event-projection-1',
    occurredAt: '2026-08-20T02:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    severityLevel: 'S3',
    road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' }
  });

  assert.deepEqual(projectMinimumNecessary('ROAD_OPERATOR', SOURCE), {
    roadEventId: 'road-event-projection-1',
    occurredAt: '2026-08-20T02:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' }
  });

  assert.deepEqual(projectMinimumNecessary('INSURANCE', SOURCE), {
    roadEventId: 'road-event-projection-1',
    occurredAt: '2026-08-20T02:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    policyReference: 'policy-reference-private'
  });

  assert.deepEqual(projectMinimumNecessary('TOWING', SOURCE), {
    roadEventId: 'road-event-projection-1',
    location: { latitude: 24.7136, longitude: 46.6753 },
    vehicle: { vehicleClass: 'PASSENGER_CAR', mobility: 'DISABLED' }
  });

  assert.deepEqual(projectMinimumNecessary('ROUTING', SOURCE), {
    roadEventId: 'road-event-projection-1',
    road: { segmentId: 'riyadh-segment-17', lanesBlocked: 2, closureState: 'RESTRICTED' }
  });

  for (const partner of ['EMERGENCY', 'TRAFFIC', 'ROAD_OPERATOR', 'INSURANCE', 'TOWING', 'ROUTING'] as const) {
    const output = serialized(projectMinimumNecessary(partner, SOURCE));
    assert.equal(output.includes('contact-private-reference'), false);
    assert.equal(output.includes('identity-private-reference'), false);
    assert.equal(output.includes('evidence-private-reference'), false);
    assert.equal(output.includes('reasonCodes'), false);
    assert.equal(output.includes('score'), false);
  }
});

test('trusted profile enforces partner-purpose binding before database access', async () => {
  const sandbox = new PostgresIntegrationSandbox(new NoDatabasePool());
  await assert.rejects(
    sandbox.prepare(
      { ...TRAFFIC_PROFILE, purpose: 'INSURANCE_COORDINATION' },
      {
        logicalOperationId: 'operation-purpose-guard',
        requestId: 'request-purpose-guard',
        idempotencyKey: 'idempotency-purpose-guard-0001',
        correlationId: 'correlation-purpose-guard',
        causationId: 'causation-purpose-guard',
        source: SOURCE,
        preparedAt: '2026-08-20T02:01:00.000Z'
      }
    ),
    /requires purpose TRAFFIC_COORDINATION/
  );
});

test('trusted profile tenant must match source tenant before database access', async () => {
  const sandbox = new PostgresIntegrationSandbox(new NoDatabasePool());
  await assert.rejects(
    sandbox.prepare(
      { ...TRAFFIC_PROFILE, tenantId: 'other-tenant' },
      {
        logicalOperationId: 'operation-tenant-guard',
        requestId: 'request-tenant-guard',
        idempotencyKey: 'idempotency-tenant-guard-0001',
        correlationId: 'correlation-tenant-guard',
        causationId: 'causation-tenant-guard',
        source: SOURCE,
        preparedAt: '2026-08-20T02:01:00.000Z'
      }
    ),
    /Source tenant does not match trusted integration profile/
  );
});

test('only explicit SIMULATION_ONLY profiles are accepted', async () => {
  const sandbox = new PostgresIntegrationSandbox(new NoDatabasePool());
  const unsafeProfile = {
    ...TRAFFIC_PROFILE,
    mode: 'LIVE'
  } as unknown as TrustedIntegrationProfile;

  await assert.rejects(
    sandbox.prepare(unsafeProfile, {
      logicalOperationId: 'operation-mode-guard',
      requestId: 'request-mode-guard',
      idempotencyKey: 'idempotency-mode-guard-0001',
      correlationId: 'correlation-mode-guard',
      causationId: 'causation-mode-guard',
      source: SOURCE,
      preparedAt: '2026-08-20T02:01:00.000Z'
    }),
    /Only SIMULATION_ONLY integration profiles are enabled/
  );
});
