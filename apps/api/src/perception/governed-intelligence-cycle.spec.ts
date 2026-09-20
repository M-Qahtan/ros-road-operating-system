import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COGNITIVE_ROAD_STATE_SCHEMA,
  EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
  EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA,
  SENSOR_OBSERVATION_SCHEMA,
  type CognitiveRoadState,
  type CounterfactualCandidate,
  type EpistemicCoverageAssertion,
  type EpistemicCoverageRegion,
  type EpistemicIndependenceLease,
  type ProtectedOutcomeVector,
  type SensorObservationEnvelope,
} from '@ros/contracts';
import { buildEpistemicCoverageMap } from './epistemic-coverage.js';
import { evaluateGovernedRoadIntelligenceCycle } from './governed-intelligence-cycle.js';

const NOW = Date.parse('2026-09-20T05:00:00+03:00');
const stateDigest = 'd'.repeat(64);
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const geometryDigest = 'e'.repeat(64);

const region: EpistemicCoverageRegion = {
  regionId: 'intersection-ros-001',
  zoneId: 'RUH-Z01',
  regionType: 'INTERSECTION_CONFLICT_ZONE',
  spatialFrameId: 'map-ruh-z01',
  geometryDigest,
  roadSegmentId: 'segment-001',
};

function state(): CognitiveRoadState {
  return {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: 'crs-governed-cycle-001',
    zoneId: 'RUH-Z01',
    stateTime: '2026-09-20T04:59:59+03:00',
    validUntil: '2026-09-20T05:00:10+03:00',
    stateDigest,
    sensorHealthDigest: 'c'.repeat(64),
    entities: [],
    hazards: [],
    trafficState: {},
    environment: {},
    signalState: {},
    infrastructureState: {},
    evidenceObservationIds: [],
    contradictions: [],
    epistemicSummary: { known: [], uncertain: [], unknown: [] },
  };
}

function observation(id: string, sourceId: string): SensorObservationEnvelope {
  return {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: id,
    sourceId,
    sourceClass: 'RADAR',
    capturedAt: '2026-09-20T04:59:59.500+03:00',
    receivedAt: '2026-09-20T04:59:59.700+03:00',
    sourceSequence: 1,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 200,
      freshnessTtlMs: 5_000,
      timeSource: 'PTP',
    },
    frame: {
      frameId: 'map-ruh-z01',
      coordinateSystem: 'EPSG:4978',
      transformDigest: digestA,
    },
    calibration: {
      state: 'VALID',
      calibrationDigest: digestA,
    },
    health: {
      state: 'HEALTHY',
      score: 0.99,
      metrics: [],
      degradationCauses: [],
      assessedAt: '2026-09-20T04:59:59.700+03:00',
    },
    provenance: {
      adapterName: 'governed-cycle-test-adapter',
      adapterVersion: '1.0.0',
      rawPayloadSha256: digestA,
      normalizedPayloadSha256: digestA,
      jurisdiction: 'SA-RIYADH',
      purpose: 'road-safety-response',
      parentObservationIds: [],
    },
    payload: {
      kind: 'RADAR_FRAME',
      detections: [],
    },
  };
}

function lease(
  leaseId: string,
  observationId: string,
  independenceClassDigest: string,
): EpistemicIndependenceLease {
  return {
    schema: EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA,
    leaseId,
    independenceClassDigest,
    observationIds: [observationId],
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-governed-cycle-001',
    objectBinding: `coverage:${region.regionId}:VULNERABLE_ROAD_USERS`,
    roadStateDigest: stateDigest,
    sourceLineageDigest: independenceClassDigest,
    issuedAt: '2026-09-20T04:59:58+03:00',
    expiresAt: '2026-09-20T05:00:08+03:00',
    authority: 'NONE',
  };
}

function assertion(id: string, observationId: string): EpistemicCoverageAssertion {
  return {
    schema: EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
    assertionId: id,
    regionId: region.regionId,
    dimension: 'VULNERABLE_ROAD_USERS',
    observationId,
    state: 'COVERED',
    confidence: 0.95,
    occlusionFraction: 0.05,
    degradationCauses: [],
    reasonCodes: [],
    validUntil: '2026-09-20T05:00:06+03:00',
    authority: 'NONE',
  };
}

function observedMap() {
  return buildEpistemicCoverageMap({
    mapId: 'coverage-map-governed-cycle-001',
    state: state(),
    trustedNowEpochMs: NOW,
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-governed-cycle-001',
    regions: [region],
    dimensions: ['VULNERABLE_ROAD_USERS'],
    observations: [observation('obs-a', 'radar-a'), observation('obs-b', 'radar-b')],
    leases: [lease('lease-a', 'obs-a', digestA), lease('lease-b', 'obs-b', digestB)],
    assertions: [assertion('assert-a', 'obs-a'), assertion('assert-b', 'obs-b')],
  });
}

function unknownMap() {
  return buildEpistemicCoverageMap({
    mapId: 'coverage-map-governed-cycle-unknown',
    state: state(),
    trustedNowEpochMs: NOW,
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-governed-cycle-001',
    regions: [region],
    dimensions: ['VULNERABLE_ROAD_USERS'],
    observations: [],
    leases: [],
    assertions: [],
  });
}

function outcomes(humanSafetyRisk: number): ProtectedOutcomeVector {
  return {
    humanSafetyRisk,
    emergencyAccessRisk: 1,
    secondaryIncidentRisk: 1,
    evidenceIntegrityRisk: 1,
    authorityPrivacyRisk: 1,
    criticalNetworkResilienceRisk: 1,
    mobilityCost: 1,
    delayCost: 1,
    efficiencyCost: 1,
  };
}

function candidate(
  id: string,
  action: CounterfactualCandidate['action'],
  humanSafetyRisk: number,
  directVehicleControl = false,
): CounterfactualCandidate {
  return {
    candidateId: id,
    action,
    stateDigest,
    validUntil: '2026-09-20T05:00:05+03:00',
    assumptions: action === 'NO_ACTION' ? [] : ['bounded-advisory-model-v1'],
    predictedOutcomes: outcomes(humanSafetyRisk),
    uncertainty: 0.1,
    authority: 'ADVISORY_ONLY',
    directVehicleControl,
    requiresVehicleLocalVeto: true,
  };
}

test('composes observed coverage and counterfactual ranking without granting execution authority', () => {
  const result = evaluateGovernedRoadIntelligenceCycle({
    map: observedMap(),
    state: state(),
    evaluatedAt: '2026-09-20T05:00:01+03:00',
    criticalRegionIds: [region.regionId],
    requiredDimensions: ['VULNERABLE_ROAD_USERS'],
    candidates: [
      candidate('no-action', 'NO_ACTION', 10),
      candidate('warn-road-user', 'WARN_ROAD_USER', 1),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.coverageDecision, 'ALLOW_ADVISORY_EVALUATION');
  assert.equal(result.decision, 'RECOMMEND');
  assert.equal(result.selectedCandidateId, 'warn-road-user');
  assert.equal(result.selectedAction, 'WARN_ROAD_USER');
  assert.equal(result.authority, 'NONE');
  assert.equal(result.candidateAuthorityCeiling, 'ADVISORY_ONLY');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.publicRoadAuthorized, false);
  assert.equal(result.externalIntegrationAuthorized, false);
  assert.equal(result.directVehicleControl, false);
  assert.equal(result.negativeSceneInferenceAuthorized, false);
});

test('unknown decision-critical coverage blocks recommendation and requests evidence', () => {
  const result = evaluateGovernedRoadIntelligenceCycle({
    map: unknownMap(),
    state: state(),
    evaluatedAt: '2026-09-20T05:00:01+03:00',
    criticalRegionIds: [region.regionId],
    requiredDimensions: ['VULNERABLE_ROAD_USERS'],
    candidates: [
      candidate('no-action', 'NO_ACTION', 10),
      candidate('warn-road-user', 'WARN_ROAD_USER', 1),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.coverageDecision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(result.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.selectedAction, null);
  assert(result.reasonCodes.includes('EPISTEMIC_COVERAGE_GATE_BLOCK'));
  assert.equal(result.executionAuthorized, false);
});

test('direct vehicle-control candidate fails closed even with otherwise sufficient coverage', () => {
  const result = evaluateGovernedRoadIntelligenceCycle({
    map: observedMap(),
    state: state(),
    evaluatedAt: '2026-09-20T05:00:01+03:00',
    criticalRegionIds: [region.regionId],
    requiredDimensions: ['VULNERABLE_ROAD_USERS'],
    candidates: [
      candidate('no-action', 'NO_ACTION', 10),
      candidate('unsafe-direct-control', 'WARN_ROAD_USER', 1, true),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'ABSTAIN');
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.selectedAction, null);
  assert(result.reasonCodes.includes('DIRECT_VEHICLE_CONTROL_FORBIDDEN'));
  assert(result.reasonCodes.includes('COUNTERFACTUAL_POLICY_VIOLATION'));
  assert.equal(result.directVehicleControl, false);
  assert.equal(result.executionAuthorized, false);
});
