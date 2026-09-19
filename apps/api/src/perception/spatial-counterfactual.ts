import {
  COGNITIVE_ROAD_STATE_SCHEMA,
  cognitiveStateRequiresAbstention,
  compareProtectedOutcomesLexicographically,
  type CognitiveEntity,
  type CognitiveRoadState,
  type CounterfactualAction,
  type CounterfactualCandidate,
  type CounterfactualEvaluation,
  type ProtectedOutcomeVector,
} from '@ros/contracts';

export interface ConstantVelocityConflictPrimitive {
  readonly model: 'CONSTANT_VELOCITY';
  readonly entityAId: string;
  readonly entityBId: string;
  readonly horizonSeconds: number;
  readonly combinedSafetyEnvelopeM: number;
  readonly relativeSpeedMps: number;
  readonly timeToClosestApproachSeconds: number;
  readonly minimumSeparationM: number;
  readonly collisionEnvelopeIntersected: boolean;
  readonly timeToCollisionEnvelopeSeconds: number | null;
  readonly assumptionCodes: readonly ['CONSTANT_VELOCITY', 'SPHERICAL_SAFETY_ENVELOPE'];
  readonly authority: 'NONE';
}

export interface CognitiveConflictEvaluation {
  readonly decision: 'EVALUATED' | 'ABSTAIN' | 'REQUEST_MORE_EVIDENCE';
  readonly primitive: ConstantVelocityConflictPrimitive | null;
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
}

const ALLOWED_COUNTERFACTUAL_ACTIONS = new Set<CounterfactualAction>([
  'NO_ACTION',
  'WARN_ROAD_USER',
  'WARN_OPERATOR',
  'REQUEST_MORE_EVIDENCE',
  'ROUTE_RECOMMENDATION',
  'SIGNAL_PLAN_RECOMMENDATION',
  'EMERGENCY_CORRIDOR_RECOMMENDATION',
  'REDUCE_CONFIDENCE',
  'ABSTAIN',
  'REQUEST_HUMAN_REVIEW',
]);

const PROTECTED_OUTCOME_KEYS: readonly (keyof ProtectedOutcomeVector)[] = [
  'humanSafetyRisk',
  'emergencyAccessRisk',
  'secondaryIncidentRisk',
  'evidenceIntegrityRisk',
  'authorityPrivacyRisk',
  'criticalNetworkResilienceRisk',
  'mobilityCost',
  'delayCost',
  'efficiencyCost',
] as const;

const HARD_CANDIDATE_ERRORS = new Set([
  'DUPLICATE_CANDIDATE_ID',
  'INVALID_CANDIDATE_SHAPE',
  'MISSING_CANDIDATE_ID',
  'UNSUPPORTED_COUNTERFACTUAL_ACTION',
  'CANDIDATE_STATE_DIGEST_MISMATCH',
  'INVALID_CANDIDATE_VALID_UNTIL',
  'CANDIDATE_OUTLIVES_COGNITIVE_STATE',
  'NON_ADVISORY_AUTHORITY_FORBIDDEN',
  'DIRECT_VEHICLE_CONTROL_FORBIDDEN',
  'VEHICLE_LOCAL_VETO_REQUIRED',
  'INVALID_CANDIDATE_UNCERTAINTY',
  'COUNTERFACTUAL_ASSUMPTIONS_REQUIRED',
  'INVALID_COUNTERFACTUAL_ASSUMPTION',
  'INVALID_PROTECTED_OUTCOME_VECTOR',
]);

export function evaluateCognitivePairwiseConflict(input: {
  readonly state: CognitiveRoadState;
  readonly entityAId: string;
  readonly entityBId: string;
  readonly evaluatedAt: string;
  readonly horizonSeconds: number;
  readonly combinedSafetyRadiusM: number;
  readonly uncertaintyMarginM: number;
}): CognitiveConflictEvaluation {
  const stateBoundaryError = validateCognitiveStateBoundary(input.state);
  if (stateBoundaryError !== null) return blockedConflict('ABSTAIN', stateBoundaryError);

  const evaluatedAt = Date.parse(input.evaluatedAt);
  const stateValidUntil = Date.parse(input.state.validUntil);
  if (!Number.isFinite(evaluatedAt)) return blockedConflict('REQUEST_MORE_EVIDENCE', 'INVALID_EVALUATION_TIME');
  if (stateValidUntil <= evaluatedAt) return blockedConflict('REQUEST_MORE_EVIDENCE', 'COGNITIVE_STATE_EXPIRED');
  if (cognitiveStateRequiresAbstention(input.state)) return blockedConflict('ABSTAIN', 'COGNITIVE_STATE_CONTRADICTED');

  const entityA = input.state.entities.find((entity) => entity.entityId === input.entityAId);
  const entityB = input.state.entities.find((entity) => entity.entityId === input.entityBId);
  if (!entityA || !entityB || entityA.entityId === entityB.entityId) {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_BINDING_INVALID');
  }
  if (entityA.epistemicState !== 'CORROBORATED' || entityB.epistemicState !== 'CORROBORATED') {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_STATE_NOT_CORROBORATED');
  }
  const entityAValidUntil = Date.parse(entityA.validUntil);
  const entityBValidUntil = Date.parse(entityB.validUntil);
  if (!Number.isFinite(entityAValidUntil) || !Number.isFinite(entityBValidUntil)) {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'INVALID_PAIRWISE_ENTITY_WINDOW');
  }
  if (entityAValidUntil <= evaluatedAt || entityBValidUntil <= evaluatedAt) {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_STATE_EXPIRED');
  }

  let primitive: ConstantVelocityConflictPrimitive;
  try {
    primitive = computeConstantVelocityConflict(
      entityA,
      entityB,
      input.horizonSeconds,
      input.combinedSafetyRadiusM,
      input.uncertaintyMarginM,
    );
  } catch {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'INVALID_PAIRWISE_KINEMATICS');
  }

  return {
    decision: 'EVALUATED',
    primitive,
    reasonCodes: ['CONSTANT_VELOCITY_PRIMITIVE_ONLY'],
    authority: 'NONE',
  };
}

export function computeConstantVelocityConflict(
  entityA: CognitiveEntity,
  entityB: CognitiveEntity,
  horizonSeconds: number,
  combinedSafetyRadiusM: number,
  uncertaintyMarginM: number,
): ConstantVelocityConflictPrimitive {
  if (!Number.isFinite(horizonSeconds) || horizonSeconds <= 0 || horizonSeconds > 120) throw new Error('INVALID_CONFLICT_HORIZON');
  if (!Number.isFinite(combinedSafetyRadiusM) || combinedSafetyRadiusM < 0) throw new Error('INVALID_SAFETY_RADIUS');
  if (!Number.isFinite(uncertaintyMarginM) || uncertaintyMarginM < 0) throw new Error('INVALID_UNCERTAINTY_MARGIN');

  const safetyEnvelope = combinedSafetyRadiusM + uncertaintyMarginM;
  if (!Number.isFinite(safetyEnvelope)) throw new Error('INVALID_SAFETY_ENVELOPE');

  const relativePosition = subtract(entityB.state.positionM, entityA.state.positionM);
  const relativeVelocity = subtract(entityB.state.estimatedVelocityMps, entityA.state.estimatedVelocityMps);
  assertFiniteVector(relativePosition, 'RELATIVE_POSITION');
  assertFiniteVector(relativeVelocity, 'RELATIVE_VELOCITY');

  const velocitySquared = dot(relativeVelocity, relativeVelocity);
  if (!Number.isFinite(velocitySquared)) throw new Error('INVALID_RELATIVE_SPEED');
  const relativeSpeedMps = Math.sqrt(velocitySquared);

  const closestTime = velocitySquared <= Number.EPSILON
    ? 0
    : clamp(-dot(relativePosition, relativeVelocity) / velocitySquared, 0, horizonSeconds);
  if (!Number.isFinite(closestTime)) throw new Error('INVALID_CLOSEST_APPROACH_TIME');

  const closestPosition = add(relativePosition, scale(relativeVelocity, closestTime));
  const minimumSeparationM = norm(closestPosition);
  if (!Number.isFinite(minimumSeparationM)) throw new Error('INVALID_MINIMUM_SEPARATION');

  const ttc = firstSphereIntersectionSeconds(relativePosition, relativeVelocity, safetyEnvelope, horizonSeconds);

  return {
    model: 'CONSTANT_VELOCITY',
    entityAId: entityA.entityId,
    entityBId: entityB.entityId,
    horizonSeconds,
    combinedSafetyEnvelopeM: safetyEnvelope,
    relativeSpeedMps,
    timeToClosestApproachSeconds: closestTime,
    minimumSeparationM,
    collisionEnvelopeIntersected: ttc !== null,
    timeToCollisionEnvelopeSeconds: ttc,
    assumptionCodes: ['CONSTANT_VELOCITY', 'SPHERICAL_SAFETY_ENVELOPE'],
    authority: 'NONE',
  };
}

export function evaluateCounterfactualCandidates(input: {
  readonly state: CognitiveRoadState;
  readonly evaluatedAt: string;
  readonly candidates: readonly CounterfactualCandidate[];
  readonly maxRecommendationUncertainty: number;
}): CounterfactualEvaluation {
  const stateBoundaryError = validateCognitiveStateBoundary(input.state);
  if (stateBoundaryError !== null) {
    return counterfactualBlocked(input, 'ABSTAIN', [stateBoundaryError]);
  }

  const evaluatedAtEpoch = Date.parse(input.evaluatedAt);
  const stateValidUntil = Date.parse(input.state.validUntil);
  const reasons = new Set<string>();

  if (!Number.isFinite(evaluatedAtEpoch)) {
    return counterfactualBlocked(input, 'ABSTAIN', ['INVALID_EVALUATION_TIME']);
  }
  if (stateValidUntil <= evaluatedAtEpoch) {
    return counterfactualBlocked(input, 'REQUEST_MORE_EVIDENCE', ['COGNITIVE_STATE_EXPIRED']);
  }
  if (cognitiveStateRequiresAbstention(input.state)) {
    return counterfactualBlocked(input, 'ABSTAIN', ['COGNITIVE_STATE_CONTRADICTED']);
  }
  if (!Number.isFinite(input.maxRecommendationUncertainty)
    || input.maxRecommendationUncertainty < 0
    || input.maxRecommendationUncertainty > 1) {
    return counterfactualBlocked(input, 'ABSTAIN', ['INVALID_UNCERTAINTY_POLICY']);
  }
  if (!Array.isArray(input.candidates)) {
    return counterfactualBlocked(input, 'ABSTAIN', ['INVALID_CANDIDATE_SET']);
  }

  const ids = new Set<string>();
  const eligible: CounterfactualCandidate[] = [];
  for (const candidate of input.candidates) {
    const candidateId = runtimeCandidateId(candidate);
    if (candidateId !== null && ids.has(candidateId)) {
      reasons.add('DUPLICATE_CANDIDATE_ID');
      continue;
    }
    if (candidateId !== null) ids.add(candidateId);

    const error = validateCandidate(candidate, input.state, evaluatedAtEpoch, stateValidUntil, input.maxRecommendationUncertainty);
    if (error !== null) {
      reasons.add(error);
      continue;
    }
    eligible.push(candidate);
  }

  if ([...reasons].some((reason) => HARD_CANDIDATE_ERRORS.has(reason))) {
    return counterfactualBlocked(input, 'ABSTAIN', [...reasons, 'COUNTERFACTUAL_POLICY_VIOLATION']);
  }

  const noAction = eligible.filter((candidate) => candidate.action === 'NO_ACTION');
  if (noAction.length !== 1) {
    return counterfactualBlocked(input, 'ABSTAIN', [...reasons, 'EXACTLY_ONE_NO_ACTION_BASELINE_REQUIRED']);
  }

  const interventions = eligible.filter((candidate) => candidate.action !== 'NO_ACTION');
  if (interventions.length === 0) {
    return counterfactualBlocked(input, 'REQUEST_MORE_EVIDENCE', [...reasons, 'NO_ELIGIBLE_INTERVENTION']);
  }

  const ranked = [...eligible].sort((a, b) => {
    const protectedOrder = compareProtectedOutcomesLexicographically(a.predictedOutcomes, b.predictedOutcomes);
    if (protectedOrder !== 0) return protectedOrder;
    return a.candidateId.localeCompare(b.candidateId);
  });
  const selected = ranked[0]!;

  const decision = selected.action === 'ABSTAIN'
    ? 'ABSTAIN'
    : selected.action === 'REQUEST_MORE_EVIDENCE'
      ? 'REQUEST_MORE_EVIDENCE'
      : selected.action === 'REQUEST_HUMAN_REVIEW'
        ? 'REQUEST_HUMAN_REVIEW'
        : 'RECOMMEND';

  return {
    crsId: input.state.crsId,
    stateDigest: input.state.stateDigest,
    evaluatedAt: input.evaluatedAt,
    candidates: input.candidates,
    selectedCandidateId: selected.candidateId,
    decision,
    reasonCodes: [...reasons, 'LEXICOGRAPHIC_PROTECTED_OUTCOME_SELECTION'].sort(),
  };
}

function validateCognitiveStateBoundary(state: CognitiveRoadState): string | null {
  if (!state || typeof state !== 'object') return 'INVALID_COGNITIVE_STATE';
  if (state.schema !== COGNITIVE_ROAD_STATE_SCHEMA) return 'INVALID_COGNITIVE_STATE_SCHEMA';
  if (typeof state.crsId !== 'string' || !state.crsId.trim()) return 'INVALID_COGNITIVE_STATE_ID';
  if (typeof state.stateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(state.stateDigest)) return 'INVALID_COGNITIVE_STATE_DIGEST';
  if (typeof state.validUntil !== 'string' || !Number.isFinite(Date.parse(state.validUntil))) return 'INVALID_COGNITIVE_STATE_WINDOW';
  if (!Array.isArray(state.entities) || !Array.isArray(state.contradictions)) return 'INVALID_COGNITIVE_STATE_COLLECTIONS';
  return null;
}

function validateCandidate(
  candidate: CounterfactualCandidate,
  state: CognitiveRoadState,
  evaluatedAtEpoch: number,
  stateValidUntilEpoch: number,
  maxUncertainty: number,
): string | null {
  if (!candidate || typeof candidate !== 'object') return 'INVALID_CANDIDATE_SHAPE';
  if (typeof candidate.candidateId !== 'string' || !candidate.candidateId.trim()) return 'MISSING_CANDIDATE_ID';
  if (typeof candidate.action !== 'string' || !ALLOWED_COUNTERFACTUAL_ACTIONS.has(candidate.action as CounterfactualAction)) {
    return 'UNSUPPORTED_COUNTERFACTUAL_ACTION';
  }
  if (typeof candidate.stateDigest !== 'string' || candidate.stateDigest !== state.stateDigest) return 'CANDIDATE_STATE_DIGEST_MISMATCH';
  if (typeof candidate.validUntil !== 'string') return 'INVALID_CANDIDATE_VALID_UNTIL';
  const candidateValidUntil = Date.parse(candidate.validUntil);
  if (!Number.isFinite(candidateValidUntil)) return 'INVALID_CANDIDATE_VALID_UNTIL';
  if (candidateValidUntil > stateValidUntilEpoch) return 'CANDIDATE_OUTLIVES_COGNITIVE_STATE';
  if (candidateValidUntil <= evaluatedAtEpoch) return 'CANDIDATE_EXPIRED';
  if (candidate.authority !== 'ADVISORY_ONLY') return 'NON_ADVISORY_AUTHORITY_FORBIDDEN';
  if (candidate.directVehicleControl !== false) return 'DIRECT_VEHICLE_CONTROL_FORBIDDEN';
  if (candidate.requiresVehicleLocalVeto !== true) return 'VEHICLE_LOCAL_VETO_REQUIRED';
  if (typeof candidate.uncertainty !== 'number' || !Number.isFinite(candidate.uncertainty) || candidate.uncertainty < 0 || candidate.uncertainty > 1) {
    return 'INVALID_CANDIDATE_UNCERTAINTY';
  }
  if (candidate.uncertainty > maxUncertainty) return 'CANDIDATE_UNCERTAINTY_TOO_HIGH';
  if (!Array.isArray(candidate.assumptions)) return 'INVALID_COUNTERFACTUAL_ASSUMPTION';
  if (candidate.action !== 'NO_ACTION' && candidate.assumptions.length === 0) return 'COUNTERFACTUAL_ASSUMPTIONS_REQUIRED';
  if (candidate.assumptions.some((item) => typeof item !== 'string' || !item.trim())) return 'INVALID_COUNTERFACTUAL_ASSUMPTION';
  if (!validProtectedOutcomeVector(candidate.predictedOutcomes)) return 'INVALID_PROTECTED_OUTCOME_VECTOR';
  return null;
}

function runtimeCandidateId(candidate: CounterfactualCandidate): string | null {
  return candidate && typeof candidate === 'object' && typeof candidate.candidateId === 'string'
    ? candidate.candidateId
    : null;
}

function validProtectedOutcomeVector(value: ProtectedOutcomeVector): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== PROTECTED_OUTCOME_KEYS.length || !keys.every((key) => PROTECTED_OUTCOME_KEYS.includes(key as keyof ProtectedOutcomeVector))) {
    return false;
  }
  return PROTECTED_OUTCOME_KEYS.every((key) => {
    const item = record[key];
    return typeof item === 'number' && Number.isFinite(item) && item >= 0;
  });
}

function counterfactualBlocked(
  input: { readonly state: CognitiveRoadState; readonly evaluatedAt: string; readonly candidates: readonly CounterfactualCandidate[] },
  decision: CounterfactualEvaluation['decision'],
  reasonCodes: readonly string[],
): CounterfactualEvaluation {
  return {
    crsId: input.state?.crsId ?? 'INVALID_CRS',
    stateDigest: input.state?.stateDigest ?? '',
    evaluatedAt: input.evaluatedAt,
    candidates: Array.isArray(input.candidates) ? input.candidates : [],
    selectedCandidateId: null,
    decision,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}

function blockedConflict(
  decision: CognitiveConflictEvaluation['decision'],
  reason: string,
): CognitiveConflictEvaluation {
  return { decision, primitive: null, reasonCodes: [reason], authority: 'NONE' };
}

function firstSphereIntersectionSeconds(
  relativePosition: readonly [number, number, number],
  relativeVelocity: readonly [number, number, number],
  radiusM: number,
  horizonSeconds: number,
): number | null {
  const a = dot(relativeVelocity, relativeVelocity);
  const c = dot(relativePosition, relativePosition) - radiusM * radiusM;
  if (!Number.isFinite(a) || !Number.isFinite(c)) throw new Error('INVALID_COLLISION_EQUATION');
  if (c <= 0) return 0;
  if (a <= Number.EPSILON) return null;

  const b = 2 * dot(relativePosition, relativeVelocity);
  const discriminant = b * b - 4 * a * c;
  if (!Number.isFinite(b) || !Number.isFinite(discriminant)) throw new Error('INVALID_COLLISION_EQUATION');
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  for (const candidate of [first, second]) {
    if (Number.isFinite(candidate) && candidate >= 0 && candidate <= horizonSeconds) return candidate;
  }
  return null;
}

function subtract(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: readonly [number, number, number], factor: number): [number, number, number] {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: readonly [number, number, number]): number {
  return Math.sqrt(dot(a, a));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertFiniteVector(value: readonly [number, number, number], label: string): void {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`NON_FINITE_${label}`);
  }
}
