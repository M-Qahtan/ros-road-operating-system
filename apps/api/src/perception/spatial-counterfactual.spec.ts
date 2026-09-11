import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COGNITIVE_ROAD_STATE_SCHEMA,
  type CognitiveEntity,
  type CognitiveRoadState,
  type CounterfactualCandidate,
  type ProtectedOutcomeVector,
} from '@ros/contracts';
import {
  computeConstantVelocityConflict,
  evaluateCognitivePairwiseConflict,
  evaluateCounterfactualCandidates,
} from './spatial-counterfactual.js';

const digest = 'd'.repeat(64);

function entity(
  id: string,
  positionX: number,
  velocityX: number,
  epistemicState: CognitiveEntity['epistemicState'] = 'CORROBORATED',
): CognitiveEntity {
  return {
    entityId: id,
    entityClass: 'VEHICLE',
    state: {
      positionM: [positionX, 0, 0],
      estimatedVelocityMps: [velocityX, 0, 0],
      covariance: [0.1, 0, 0, 0.1],
      estimator: 'test-estimator-v1',
    },
    supportingObservationIds: [`obs-${id}`],
    contradictingObservationIds: epistemicState === 'CONTRADICTED' ? [`obs-${id}-conflict`] : [],
    confidence: epistemicState === 'CONTRADICTED' ? 0.4 : 0.95,
    epistemicState,
    validUntil: '2026-09-11T07:10:10+03:00',
  };
}

function state(
  entities: readonly CognitiveEntity[],
  contradictions: CognitiveRoadState['contradictions'] = [],
): CognitiveRoadState {
  return {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: 'CRS-RUH-Z41-4D-001',
    zoneId: 'RUH-Z41',
    stateTime: '2026-09-11T07:10:00+03:00',
    validUntil: '2026-09-11T07:10:05+03:00',
    stateDigest: digest,
    sensorHealthDigest: 'a'.repeat(64),
    entities,
    hazards: [],
    trafficState: {},
    environment: {},
    signalState: {},
    infrastructureState: {},
    evidenceObservationIds: entities.flatMap((item) => item.supportingObservationIds),
    contradictions,
    epistemicSummary: { known: entities.map((item) => item.entityId), uncertain: [], unknown: [] },
  };
}

function outcomes(overrides: Partial<ProtectedOutcomeVector> = {}): ProtectedOutcomeVector {
  return {
    humanSafetyRisk: 10,
    emergencyAccessRisk: 2,
    secondaryIncidentRisk: 2,
    evidenceIntegrityRisk: 1,
    authorityPrivacyRisk: 1,
    criticalNetworkResilienceRisk: 1,
    mobilityCost: 5,
    delayCost: 5,
    efficiencyCost: 5,
    ...overrides,
  };
}

function candidate(
  id: string,
  action: CounterfactualCandidate['action'],
  predictedOutcomes: ProtectedOutcomeVector,
  uncertainty = 0.1,
): CounterfactualCandidate {
  return {
    candidateId: id,
    action,
    stateDigest: digest,
    validUntil: '2026-09-11T07:10:03+03:00',
    assumptions: action === 'NO_ACTION' ? [] : ['bounded-response-model-v1'],
    predictedOutcomes,
    uncertainty,
    authority: 'ADVISORY_ONLY',
    directVehicleControl: false,
    requiresVehicleLocalVeto: true,
  };
}

test('head-on constant-velocity primitive predicts safety-envelope intersection', () => {
  const primitive = computeConstantVelocityConflict(
    entity('A', 0, 10),
    entity('B', 100, -10),
    10,
    4,
    0,
  );

  assert.equal(primitive.collisionEnvelopeIntersected, true);
  assert(Math.abs((primitive.timeToCollisionEnvelopeSeconds ?? 0) - 4.8) < 1e-9);
  assert.equal(primitive.relativeSpeedMps, 20);
  assert.equal(primitive.authority, 'NONE');
});

test('diverging trajectories do not create a false collision prediction', () => {
  const primitive = computeConstantVelocityConflict(
    entity('A', 0, -10),
    entity('B', 100, 10),
    10,
    4,
    0,
  );

  assert.equal(primitive.collisionEnvelopeIntersected, false);
  assert.equal(primitive.timeToCollisionEnvelopeSeconds, null);
  assert.equal(primitive.timeToClosestApproachSeconds, 0);
});

test('contradicted cognitive state blocks pairwise predictive use', () => {
  const crs = state(
    [entity('A', 0, 10), entity('B', 100, -10)],
    [{ contradictionId: 'c1', observationIds: ['obs-A', 'obs-B'], material: true, reason: 'CPAL_MATERIAL_CONTRADICTION' }],
  );
  const result = evaluateCognitivePairwiseConflict({
    state: crs,
    entityAId: 'A',
    entityBId: 'B',
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    horizonSeconds: 10,
    combinedSafetyRadiusM: 4,
    uncertaintyMarginM: 1,
  });

  assert.equal(result.decision, 'ABSTAIN');
  assert.equal(result.primitive, null);
});

test('lexicographic selection prefers lower human-safety risk even when delay is worse', () => {
  const crs = state([entity('A', 0, 10), entity('B', 100, -10)]);
  const noAction = candidate('no-action', 'NO_ACTION', outcomes({ humanSafetyRisk: 10, delayCost: 1 }));
  const warning = candidate('warn', 'WARN_ROAD_USER', outcomes({ humanSafetyRisk: 4, delayCost: 20 }));

  const result = evaluateCounterfactualCandidates({
    state: crs,
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    candidates: [noAction, warning],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'RECOMMEND');
  assert.equal(result.selectedCandidateId, 'warn');
});

test('mobility or delay benefit cannot compensate for higher human-safety risk', () => {
  const crs = state([entity('A', 0, 10), entity('B', 100, -10)]);
  const noAction = candidate('no-action', 'NO_ACTION', outcomes({ humanSafetyRisk: 3, delayCost: 20 }));
  const fastRoute = candidate('fast-route', 'ROUTE_RECOMMENDATION', outcomes({ humanSafetyRisk: 4, delayCost: 0 }));

  const result = evaluateCounterfactualCandidates({
    state: crs,
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    candidates: [noAction, fastRoute],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.selectedCandidateId, 'no-action');
  assert.equal(result.decision, 'RECOMMEND');
});

test('forged direct vehicle-control candidate fails the whole evaluation closed', () => {
  const crs = state([entity('A', 0, 10), entity('B', 100, -10)]);
  const noAction = candidate('no-action', 'NO_ACTION', outcomes());
  const forged = {
    ...candidate('forged', 'WARN_ROAD_USER', outcomes({ humanSafetyRisk: 1 })),
    directVehicleControl: true,
  } as unknown as CounterfactualCandidate;

  const result = evaluateCounterfactualCandidates({
    state: crs,
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    candidates: [noAction, forged],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'ABSTAIN');
  assert.equal(result.selectedCandidateId, null);
  assert(result.reasonCodes.includes('DIRECT_VEHICLE_CONTROL_FORBIDDEN'));
  assert(result.reasonCodes.includes('COUNTERFACTUAL_POLICY_VIOLATION'));
});

test('one malicious authority-import candidate poisons the cycle even beside a valid safe advisory', () => {
  const crs = state([entity('A', 0, 10), entity('B', 100, -10)]);
  const safeWarning = candidate('safe-warning', 'WARN_ROAD_USER', outcomes({ humanSafetyRisk: 2 }));
  const forgedAuthority = {
    ...candidate('forged-authority', 'ROUTE_RECOMMENDATION', outcomes({ humanSafetyRisk: 1 })),
    authority: 'COMMAND' as unknown as 'ADVISORY_ONLY',
  } as CounterfactualCandidate;

  const result = evaluateCounterfactualCandidates({
    state: crs,
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    candidates: [candidate('no-action', 'NO_ACTION', outcomes()), safeWarning, forgedAuthority],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'ABSTAIN');
  assert.equal(result.selectedCandidateId, null);
  assert(result.reasonCodes.includes('NON_ADVISORY_AUTHORITY_FORBIDDEN'));
  assert(result.reasonCodes.includes('COUNTERFACTUAL_POLICY_VIOLATION'));
});

test('high-uncertainty intervention is softly excluded and requests more evidence', () => {
  const crs = state([entity('A', 0, 10), entity('B', 100, -10)]);
  const result = evaluateCounterfactualCandidates({
    state: crs,
    evaluatedAt: '2026-09-11T07:10:01+03:00',
    candidates: [
      candidate('no-action', 'NO_ACTION', outcomes()),
      candidate('uncertain-warning', 'WARN_ROAD_USER', outcomes({ humanSafetyRisk: 1 }), 0.8),
    ],
    maxRecommendationUncertainty: 0.3,
  });

  assert.equal(result.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(result.selectedCandidateId, null);
  assert(result.reasonCodes.includes('CANDIDATE_UNCERTAINTY_TOO_HIGH'));
});
