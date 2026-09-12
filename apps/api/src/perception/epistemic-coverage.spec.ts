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
  type EpistemicCoverageDimension,
  type EpistemicCoverageRegion,
  type EpistemicIndependenceLease,
  type ProtectedOutcomeVector,
  type SensorObservationEnvelope,
} from '@ros/contracts';
import {
  buildEpistemicCoverageMap,
  evaluateCoverageGovernedCounterfactualCandidates,
  evaluateDecisionCriticalCoverage,
} from './epistemic-coverage.js';

const NOW = Date.parse('2026-09-12T06:00:00+03:00');
const stateDigest = 'd'.repeat(64);
const geometryDigest = 'e'.repeat(64);
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const region: EpistemicCoverageRegion = {
  regionId: 'crosswalk-41',
  zoneId: 'RUH-Z41',
  regionType: 'CROSSWALK',
  spatialFrameId: 'map-ruh-z41',
  geometryDigest,
  roadSegmentId: 'segment-41',
};

function state(): CognitiveRoadState {
  return {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: 'crs-coverage-001',
    zoneId: 'RUH-Z41',
    stateTime: '2026-09-12T05:59:59+03:00',
    validUntil: '2026-09-12T06:00:10+03:00',
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

function observation(
  id: string,
  sourceId: string,
  capturedAt = '2026-09-12T05:59:59.500+03:00',
  degraded = false,
): SensorObservationEnvelope {
  return {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: id,
    sourceId,
    sourceClass: 'RADAR',
    capturedAt,
    receivedAt: '2026-09-12T05:59:59.700+03:00',
    sourceSequence: 1,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 200,
      freshnessTtlMs: 5_000,
      timeSource: 'PTP',
    },
    frame: {
      frameId: 'map-ruh-z41',
      coordinateSystem: 'EPSG:4978',
      transformDigest: digestA,
    },
    calibration: {
      state: 'VALID',
      calibrationDigest: digestA,
    },
    health: {
      state: degraded ? 'DEGRADED' : 'HEALTHY',
      score: degraded ? 0.65 : 0.99,
      metrics: [],
      degradationCauses: degraded ? ['GLARE'] : [],
      assessedAt: '2026-09-12T05:59:59.700+03:00',
    },
    provenance: {
      adapterName: 'test-radar-adapter',
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
  dimension: EpistemicCoverageDimension = 'VULNERABLE_ROAD_USERS',
): EpistemicIndependenceLease {
  return {
    schema: EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA,
    leaseId,
    independenceClassDigest,
    observationIds: [observationId],
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-coverage-001',
    objectBinding: `coverage:${region.regionId}:${dimension}`,
    roadStateDigest: stateDigest,
    sourceLineageDigest: independenceClassDigest,
    issuedAt: '2026-09-12T05:59:58+03:00',
    expiresAt: '2026-09-12T06:00:08+03:00',
    authority: 'NONE',
  };
}

function assertion(
  id: string,
  observationId: string,
  assertionState: EpistemicCoverageAssertion['state'] = 'COVERED',
  occlusionFraction = 0.05,
): EpistemicCoverageAssertion {
  return {
    schema: EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
    assertionId: id,
    regionId: region.regionId,
    dimension: 'VULNERABLE_ROAD_USERS',
    observationId,
    state: assertionState,
    confidence: 0.95,
    occlusionFraction,
    degradationCauses: assertionState === 'DEGRADED' ? ['GLARE'] : [],
    reasonCodes: [],
    validUntil: '2026-09-12T06:00:06+03:00',
    authority: 'NONE',
  };
}

function build(
  observations: readonly SensorObservationEnvelope[],
  leases: readonly EpistemicIndependenceLease[],
  assertions: readonly EpistemicCoverageAssertion[],
) {
  return buildEpistemicCoverageMap({
    mapId: 'coverage-map-001',
    state: state(),
    trustedNowEpochMs: NOW,
    purpose: 'road-safety-response',
    jurisdiction: 'SA-RIYADH',
    eventEpoch: 'epoch-coverage-001',
    regions: [region],
    dimensions: ['VULNERABLE_ROAD_USERS'],
    observations,
    leases,
    assertions,
  });
}

test('two independent current coverage classes produce OBSERVED without importing authority', () => {
  const map = build(
    [observation('obs-a', 'radar-a'), observation('obs-b', 'radar-b')],
    [lease('lease-a', 'obs-a', digestA), lease('lease-b', 'obs-b', digestB)],
    [assertion('assert-a', 'obs-a'), assertion('assert-b', 'obs-b')],
  );
  const cell = map.cells[0]!;

  assert.equal(cell.state, 'OBSERVED');
  assert.equal(cell.effectiveIndependentEvidence, 2);
  assert.equal(cell.authority, 'NONE');
  assert.equal(map.authority, 'NONE');
  assert.equal(map.negativeSceneInferenceAuthorized, false);
});

test('twenty pseudo-sources from one epistemic lineage count as one coverage unit', () => {
  const observations = Array.from({ length: 20 }, (_, index) => observation(`obs-${index}`, `pseudo-${index}`));
  const assertions = observations.map((item, index) => assertion(`assert-${index}`, item.observationId));
  const sharedLease: EpistemicIndependenceLease = {
    ...lease('shared-lineage', observations[0]!.observationId, digestA),
    observationIds: observations.map((item) => item.observationId),
  };
  const map = build(observations, [sharedLease], assertions);

  assert.equal(map.cells[0]!.effectiveIndependentEvidence, 1);
  assert.equal(map.cells[0]!.state, 'DEGRADED');
  assert(map.cells[0]!.reasonCodes.includes('INSUFFICIENT_INDEPENDENT_COVERAGE'));
});

test('stale observations cannot manufacture current coverage', () => {
  const stale = observation('obs-stale', 'radar-stale', '2026-09-12T05:59:40+03:00');
  const map = build(
    [stale],
    [lease('lease-stale', 'obs-stale', digestA)],
    [assertion('assert-stale', 'obs-stale')],
  );

  assert.equal(map.cells[0]!.state, 'UNKNOWN');
  assert.equal(map.cells[0]!.effectiveIndependentEvidence, 0);
});

test('independent covered versus blind assertions become CONTRADICTED and force abstention', () => {
  const map = build(
    [observation('obs-a', 'radar-a'), observation('obs-b', 'radar-b')],
    [lease('lease-a', 'obs-a', digestA), lease('lease-b', 'obs-b', digestB)],
    [assertion('assert-a', 'obs-a', 'COVERED'), assertion('assert-b', 'obs-b', 'BLIND', 1)],
  );
  const gate = evaluateDecisionCriticalCoverage({
    map,
    state: state(),
    evaluatedAt: '2026-09-12T06:00:01+03:00',
    regionIds: [region.regionId],
    dimensions: ['VULNERABLE_ROAD_USERS'],
  });

  assert.equal(map.cells[0]!.state, 'CONTRADICTED');
  assert.equal(gate.decision, 'ABSTAIN');
  assert(gate.reasonCodes.includes('DECISION_CRITICAL_COVERAGE_CONTRADICTED'));
});

test('degraded sensor or occlusion keeps decision-critical corridor from recommendation-grade coverage', () => {
  const map = build(
    [observation('obs-a', 'radar-a', undefined, true), observation('obs-b', 'radar-b')],
    [lease('lease-a', 'obs-a', digestA), lease('lease-b', 'obs-b', digestB)],
    [assertion('assert-a', 'obs-a', 'DEGRADED', 0.6), assertion('assert-b', 'obs-b')],
  );
  const gate = evaluateDecisionCriticalCoverage({
    map,
    state: state(),
    evaluatedAt: '2026-09-12T06:00:01+03:00',
    regionIds: [region.regionId],
    dimensions: ['VULNERABLE_ROAD_USERS'],
  });

  assert.equal(map.cells[0]!.state, 'DEGRADED');
  assert.equal(gate.decision, 'REQUEST_MORE_EVIDENCE');
});

test('region with no trusted evidence remains UNKNOWN rather than being treated as empty and safe', () => {
  const map = build([], [], []);
  const gate = evaluateDecisionCriticalCoverage({
    map,
    state: state(),
    evaluatedAt: '2026-09-12T06:00:01+03:00',
    regionIds: [region.regionId],
    dimensions: ['VULNERABLE_ROAD_USERS'],
  });

  assert.equal(map.cells[0]!.state, 'UNKNOWN');
  assert.equal(gate.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(gate.negativeSceneInferenceAuthorized, false);
});

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

function candidate(id: string, action: CounterfactualCandidate['action'], risk: number): CounterfactualCandidate {
  return {
    candidateId: id,
    action,
    stateDigest,
    validUntil: '2026-09-12T06:00:05+03:00',
    assumptions: action === 'NO_ACTION' ? [] : ['bounded-response-model-v1'],
    predictedOutcomes: outcomes(risk),
    uncertainty: 0.1,
    authority: 'ADVISORY_ONLY',
    directVehicleControl: false,
    requiresVehicleLocalVeto: true,
  };
}

test('coverage-governed counterfactual path blocks an otherwise attractive recommendation in a blind corridor', () => {
  const map = build(
    [observation('obs-a', 'radar-a')],
    [lease('lease-a', 'obs-a', digestA)],
    [assertion('assert-a', 'obs-a', 'BLIND', 1)],
  );
  const result = evaluateCoverageGovernedCounterfactualCandidates({
    map,
    state: state(),
    evaluatedAt: '2026-09-12T06:00:01+03:00',
    criticalRegionIds: [region.regionId],
    requiredDimensions: ['VULNERABLE_ROAD_USERS'],
    candidates: [
      candidate('no-action', 'NO_ACTION', 10),
      candidate('warning', 'WARN_ROAD_USER', 1),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(result.selectedCandidateId, null);
  assert(result.reasonCodes.includes('EPISTEMIC_COVERAGE_GATE_BLOCK'));
});

test('coverage-governed counterfactual path permits advisory ranking only after decision-critical coverage is observed', () => {
  const map = build(
    [observation('obs-a', 'radar-a'), observation('obs-b', 'radar-b')],
    [lease('lease-a', 'obs-a', digestA), lease('lease-b', 'obs-b', digestB)],
    [assertion('assert-a', 'obs-a'), assertion('assert-b', 'obs-b')],
  );
  const result = evaluateCoverageGovernedCounterfactualCandidates({
    map,
    state: state(),
    evaluatedAt: '2026-09-12T06:00:01+03:00',
    criticalRegionIds: [region.regionId],
    requiredDimensions: ['VULNERABLE_ROAD_USERS'],
    candidates: [
      candidate('no-action', 'NO_ACTION', 10),
      candidate('warning', 'WARN_ROAD_USER', 1),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'RECOMMEND');
  assert.equal(result.selectedCandidateId, 'warning');
});
