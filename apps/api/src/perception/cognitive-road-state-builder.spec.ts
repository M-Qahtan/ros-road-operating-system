import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SENSOR_OBSERVATION_SCHEMA,
  type EvidenceAssuranceResult,
  type SensorObservationEnvelope,
} from '@ros/contracts';
import { buildCognitiveRoadState } from './cognitive-road-state-builder.js';

const NOW = Date.parse('2026-09-11T07:00:00+03:00');
const digest = 'a'.repeat(64);

function trackObservation(input: {
  readonly observationId: string;
  readonly sourceId: string;
  readonly capturedAt?: string;
  readonly trackId?: string;
  readonly x?: number;
}): SensorObservationEnvelope {
  return {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: input.observationId,
    sourceId: input.sourceId,
    sourceClass: 'EXTERNAL_PERCEPTION_PLATFORM',
    capturedAt: input.capturedAt ?? '2026-09-11T06:59:59.500+03:00',
    receivedAt: '2026-09-11T06:59:59.700+03:00',
    sourceSequence: 1,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 200,
      freshnessTtlMs: 2_000,
      timeSource: 'PTP',
    },
    frame: {
      frameId: input.sourceId,
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
      assessedAt: '2026-09-11T06:59:59.700+03:00',
    },
    provenance: {
      adapterName: 'test-track-adapter',
      adapterVersion: '1.0.0',
      rawPayloadSha256: digest,
      normalizedPayloadSha256: digest,
      jurisdiction: 'SA-RIYADH',
      purpose: 'road-safety-response',
      parentObservationIds: [],
    },
    payload: {
      kind: 'TRACK_SET',
      tracks: [{
        trackId: input.trackId ?? 'vehicle-001',
        objectClass: 'VEHICLE',
        state: {
          positionM: [input.x ?? 10, 2, 0],
          estimatedVelocityMps: [20, 0, 0],
          covariance: [0.1, 0, 0, 0.1],
          estimator: 'test-kalman-v1',
        },
        laneId: 'L2',
        roadSegmentId: 'RUH-Z41-R1',
        confidence: 0.92,
        supportingObservationIds: [input.observationId],
      }],
    },
  };
}

function assurance(decision: EvidenceAssuranceResult['decision']): EvidenceAssuranceResult {
  return {
    objectBinding: 'vehicle-001',
    claimType: 'OBJECT_STATE',
    decision,
    effectiveIndependentEvidence: decision === 'CORROBORATED' ? 2 : 1,
    rawClaimCount: 2,
    supportingIndependenceClasses: decision === 'CORROBORATED' ? ['a'.repeat(64), 'b'.repeat(64)] : ['a'.repeat(64)],
    contradictingIndependenceClasses: decision === 'CONTRADICTED' ? ['b'.repeat(64)] : [],
    reasonCodes: decision === 'CONTRADICTED' ? ['MATERIAL_CONTRADICTION'] : [],
    authority: 'NONE',
  };
}

function build(observations: readonly SensorObservationEnvelope[], assuranceResults: readonly EvidenceAssuranceResult[]) {
  return buildCognitiveRoadState({
    crsId: 'CRS-RUH-Z41-001',
    zoneId: 'RUH-Z41',
    stateTime: '2026-09-11T07:00:00+03:00',
    validUntil: '2026-09-11T07:00:01.500+03:00',
    trustedNowEpochMs: NOW,
    observations,
    assuranceResults,
  });
}

test('corroborated admitted track becomes known CRS entity without authority import', () => {
  const result = build([trackObservation({ observationId: 'obs-1', sourceId: 'fusion-1' })], [assurance('CORROBORATED')]);

  assert.equal(result.authority, 'NONE');
  assert.equal(result.abstentionRequired, false);
  assert.equal(result.state.entities.length, 1);
  assert.equal(result.state.entities[0]?.epistemicState, 'CORROBORATED');
  assert.match(result.state.stateDigest, /^[a-f0-9]{64}$/);
  assert.match(result.state.sensorHealthDigest, /^[a-f0-9]{64}$/);
});

test('stale observations are excluded from current cognitive state', () => {
  const result = build([
    trackObservation({
      observationId: 'obs-stale',
      sourceId: 'fusion-1',
      capturedAt: '2026-09-11T06:59:50+03:00',
    }),
  ], [assurance('CORROBORATED')]);

  assert.deepEqual(result.admittedObservationIds, []);
  assert.deepEqual(result.excludedObservationIds, ['obs-stale']);
  assert.equal(result.state.entities.length, 0);
});

test('CPAL material contradiction propagates into CRS and forces abstention', () => {
  const result = build([trackObservation({ observationId: 'obs-1', sourceId: 'fusion-1' })], [assurance('CONTRADICTED')]);

  assert.equal(result.abstentionRequired, true);
  assert.equal(result.state.entities[0]?.epistemicState, 'CONTRADICTED');
  assert.equal(result.state.contradictions[0]?.reason, 'CPAL_MATERIAL_CONTRADICTION');
});

test('normal movement across time is not misclassified as contradiction', () => {
  const result = build([
    trackObservation({ observationId: 'obs-old', sourceId: 'fusion-1', capturedAt: '2026-09-11T06:59:59.100+03:00', x: 8 }),
    trackObservation({ observationId: 'obs-new', sourceId: 'fusion-1', capturedAt: '2026-09-11T06:59:59.500+03:00', x: 10 }),
  ], [assurance('CORROBORATED')]);

  assert.equal(result.abstentionRequired, false);
  assert.equal(result.state.entities[0]?.state.positionM[0], 10);
  assert.equal(result.state.contradictions.length, 0);
});

test('same source and capture time cannot publish two divergent states for one track', () => {
  const result = build([
    trackObservation({ observationId: 'obs-a', sourceId: 'fusion-1', x: 10 }),
    trackObservation({ observationId: 'obs-b', sourceId: 'fusion-1', x: 30 }),
  ], [assurance('CORROBORATED')]);

  assert.equal(result.abstentionRequired, true);
  assert.equal(result.state.entities[0]?.epistemicState, 'CONTRADICTED');
  assert.equal(result.state.contradictions[0]?.reason, 'DIVERGENT_SAME_SOURCE_TRACK_STATE');
});
