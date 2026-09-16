import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA,
  SENSOR_OBSERVATION_SCHEMA,
  type EpistemicIndependenceLease,
  type EvidenceClaim,
  type SensorObservationEnvelope,
} from '@ros/contracts';
import { assessEvidenceClaims, assuranceRequiresAbstention } from './evidence-assurance.js';

const NOW = Date.parse('2026-09-11T06:30:00+03:00');
const digest = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function observation(id: string, sourceId: string, capturedAt = '2026-09-11T06:29:59.500+03:00'): SensorObservationEnvelope {
  return {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: id,
    sourceId,
    sourceClass: 'RADAR',
    capturedAt,
    receivedAt: '2026-09-11T06:29:59.700+03:00',
    sourceSequence: 1,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 200,
      freshnessTtlMs: 2_000,
      timeSource: 'PTP',
    },
    frame: {
      frameId: sourceId,
      coordinateSystem: 'EPSG:4978',
      transformDigest: digest,
    },
    calibration: {
      state: 'VALID',
      calibrationDigest: digest,
    },
    health: {
      state: 'HEALTHY',
      score: 0.99,
      metrics: [],
      degradationCauses: [],
      assessedAt: '2026-09-11T06:29:59.700+03:00',
    },
    provenance: {
      adapterName: 'test-radar-adapter',
      adapterVersion: '1.0.0',
      rawPayloadSha256: digest,
      normalizedPayloadSha256: digest,
      jurisdiction: 'SA-RIYADH',
      purpose: 'road-safety-response',
      parentObservationIds: [],
    },
    payload: {
      kind: 'RADAR_FRAME',
      detections: [{
        detectionId: `${id}-d1`,
        rangeM: 30,
        azimuthRad: 0.1,
        measuredRadialVelocityMps: -10,
      }],
    },
  };
}

function lease(
  leaseId: string,
  independenceClassDigest: string,
  observationIds: readonly string[],
  overrides: Partial<EpistemicIndependenceLease> = {},
): EpistemicIndependenceLease {
  return {
    schema: EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA,
    leaseId,
    independenceClassDigest,
    observationIds,
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-001',
    objectBinding: 'object-001',
    roadStateDigest: digest,
    sourceLineageDigest: independenceClassDigest,
    issuedAt: '2026-09-11T06:29:58+03:00',
    expiresAt: '2026-09-11T06:30:05+03:00',
    authority: 'NONE',
    ...overrides,
  };
}

function claim(id: string, observationId: string, value: EvidenceClaim['value']): EvidenceClaim {
  return {
    claimId: id,
    observationId,
    objectBinding: 'object-001',
    claimType: 'HAZARD_PRESENCE',
    value,
    confidence: 0.9,
  };
}

function assess(
  observations: readonly SensorObservationEnvelope[],
  leases: readonly EpistemicIndependenceLease[],
  claims: readonly EvidenceClaim[],
) {
  return assessEvidenceClaims({
    trustedNowEpochMs: NOW,
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-001',
    roadStateDigest: digest,
    objectBinding: 'object-001',
    claimType: 'HAZARD_PRESENCE',
    minimumIndependentEvidence: 2,
    observations,
    leases,
    claims,
  });
}

test('two independent corroborating classes satisfy quorum without importing authority', () => {
  const result = assess(
    [observation('obs-1', 'radar-1'), observation('obs-2', 'lidar-1')],
    [lease('lease-1', digest, ['obs-1']), lease('lease-2', digestB, ['obs-2'])],
    [claim('c1', 'obs-1', 'PRESENT'), claim('c2', 'obs-2', 'PRESENT')],
  );

  assert.equal(result.decision, 'CORROBORATED');
  assert.equal(result.effectiveIndependentEvidence, 2);
  assert.equal(result.authority, 'NONE');
});

test('many messages from one epistemic class count as one evidence unit', () => {
  const observations = Array.from({ length: 20 }, (_, index) => observation(`obs-${index}`, `pseudo-${index}`));
  const claims = observations.map((item, index) => claim(`c-${index}`, item.observationId, 'PRESENT'));
  const result = assess(observations, [lease('lease-one-class', digest, observations.map((item) => item.observationId))], claims);

  assert.equal(result.rawClaimCount, 20);
  assert.equal(result.effectiveIndependentEvidence, 1);
  assert.equal(result.decision, 'INSUFFICIENT_INDEPENDENCE');
});

test('independent contradictory evidence forces contradiction and abstention', () => {
  const result = assess(
    [observation('obs-1', 'radar-1'), observation('obs-2', 'camera-1')],
    [lease('lease-1', digest, ['obs-1']), lease('lease-2', digestB, ['obs-2'])],
    [claim('c1', 'obs-1', 'PRESENT'), claim('c2', 'obs-2', 'ABSENT')],
  );

  assert.equal(result.decision, 'CONTRADICTED');
  assert.equal(assuranceRequiresAbstention(result), true);
  assert(result.reasonCodes.includes('MATERIAL_CONTRADICTION'));
});

test('stale observations do not contribute to current-state quorum', () => {
  const result = assess(
    [
      observation('obs-fresh', 'radar-1'),
      observation('obs-stale', 'camera-1', '2026-09-11T06:29:50+03:00'),
    ],
    [lease('lease-1', digest, ['obs-fresh']), lease('lease-2', digestB, ['obs-stale'])],
    [claim('c1', 'obs-fresh', 'PRESENT'), claim('c2', 'obs-stale', 'PRESENT')],
  );

  assert.equal(result.effectiveIndependentEvidence, 1);
  assert.equal(result.decision, 'INSUFFICIENT_INDEPENDENCE');
  assert(result.reasonCodes.includes('OBSERVATION_CONTEXT_ONLY'));
});

test('expired or context-mismatched leases cannot create quorum', () => {
  const result = assess(
    [observation('obs-1', 'radar-1'), observation('obs-2', 'camera-1')],
    [
      lease('lease-expired', digest, ['obs-1'], { expiresAt: '2026-09-11T06:29:59+03:00' }),
      lease('lease-wrong-purpose', digestB, ['obs-2'], { purpose: 'traffic-efficiency' }),
    ],
    [claim('c1', 'obs-1', 'PRESENT'), claim('c2', 'obs-2', 'PRESENT')],
  );

  assert.equal(result.effectiveIndependentEvidence, 0);
  assert.equal(result.decision, 'INSUFFICIENT_INDEPENDENCE');
  assert(result.reasonCodes.includes('INVALID_OR_EXPIRED_LEASE'));
  assert(result.reasonCodes.includes('LEASE_CONTEXT_MISMATCH'));
});
