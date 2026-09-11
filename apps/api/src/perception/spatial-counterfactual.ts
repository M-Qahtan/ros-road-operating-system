import {
  cognitiveStateRequiresAbstention,
  compareProtectedOutcomesLexicographically,
  type CognitiveEntity,
  type CognitiveRoadState,
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

export function evaluateCognitivePairwiseConflict(input: {
  readonly state: CognitiveRoadState;
  readonly entityAId: string;
  readonly entityBId: string;
  readonly evaluatedAt: string;
  readonly horizonSeconds: number;
  readonly combinedSafetyRadiusM: number;
  readonly uncertaintyMarginM: number;
}): CognitiveConflictEvaluation {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) return blockedConflict('REQUEST_MORE_EVIDENCE', 'INVALID_EVALUATION_TIME');
  if (Date.parse(input.state.validUntil) <= evaluatedAt) return blockedConflict('REQUEST_MORE_EVIDENCE', 'COGNITIVE_STATE_EXPIRED');
  if (cognitiveStateRequiresAbstention(input.state)) return blockedConflict('ABSTAIN', 'COGNITIVE_STATE_CONTRADICTED');

  const entityA = input.state.entities.find((entity) => entity.entityId === input.entityAId);
  const entityB = input.state.entities.find((entity) => entity.entityId === input.entityBId);
  if (!entityA || !entityB || entityA.entityId === entityB.entityId) {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_BINDING_INVALID');
  }
  if (entityA.epistemicState !== 'CORROBORATED' || entityB.epistemicState !== 'CORROBORATED') {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_STATE_NOT_CORROBORATED');
  }
  if (Date.parse(entityA.validUntil) <= evaluatedAt || Date.parse(entityB.validUntil) <= evaluatedAt) {
    return blockedConflict('REQUEST_MORE_EVIDENCE', 'PAIRWISE_ENTITY_STATE_EXPIRED');
  }

  return {
    decision: 'EVALUATED',
    primitive: computeConstantVelocityConflict(
      entityA,
      entityB,
      input.horizonSeconds,
      input.combinedSafetyRadiusM,
      input.uncertaintyMarginM,
    ),
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

  const relativePosition = subtract(entityB.state.positionM, entityA.state.positionM);
  const relativeVelocity = subtract(entityB.state.estimatedVelocityMps, entityA.state.estimatedVelocityMps);
  assertFiniteVector(relativePosition, 'RELATIVE_POSITION');
  assertFiniteVector(relativeVelocity, 'RELATIVE_VELOCITY');

  const velocitySquared = dot(relativeVelocity, relativeVelocity);
  const relativeSpeedMps = Math.sqrt(velocitySquared);
  const safetyEnvelope = combinedSafetyRadiusM + uncertaintyMarginM;

  const closestTime = velocitySquared <= Number.EPSILON
    ? 0
    : clamp(-dot(relativePosition, relativeVelocity) / velocitySquared, 0, horizonSeconds);
  const closestPosition = add(relativePosition, scale(relativeVelocity, closestTime));
  const minimumSeparationM = norm(closestPosition);

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
  const evaluatedAtEpoch = Date.parse(input.evaluatedAt);
  const reasons = new Set<string>();

  if (!Number.isFinite(evaluatedAtEpoch)) {
    return counterfactualBlocked(input, 'ABSTAIN', ['INVALID_EVALUATION_TIME']);
  }
  if (Date.parse(input.state.validUntil) <= evaluatedAtEpoch) {
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

  const ids = new Set<string>();
  const eligible: CounterfactualCandidate[] = [];
  for (const candidate of input.candidates) {
    if (ids.has(candidate.candidateId)) {
      reasons.add('DUPLICATE_CANDIDATE_ID');
      continue;
    }
    ids.add(candidate.candidateId);

    const error = validateCandidate(candidate, input.state, evaluatedAtEpoch, input.maxRecommendationUncertainty);
    if (error !== null) {
      reasons.add(error);
      continue;
    }
    eligible.push(candidate);
  }

  if (reasons.has('DUPLICATE_CANDIDATE_ID')) {
    return counterfactualBlocked(input, 'ABSTAIN', [...reasons]);
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

function validateCandidate(
  candidate: CounterfactualCandidate,
  state: CognitiveRoadState,
  evaluatedAtEpoch: number,
  maxUncertainty: number,
): string | null {
  if (!candidate.candidateId.trim()) return 'MISSING_CANDIDATE_ID';
  if (candidate.stateDigest !== state.stateDigest) return 'CANDIDATE_STATE_DIGEST_MISMATCH';
  if (Date.parse(candidate.validUntil) <= evaluatedAtEpoch) return 'CANDIDATE_EXPIRED';
  if (candidate.authority !== 'ADVISORY_ONLY') return 'NON_ADVISORY_AUTHORITY_FORBIDDEN';
  if (candidate.directVehicleControl !== false) return 'DIRECT_VEHICLE_CONTROL_FORBIDDEN';
  if (candidate.requiresVehicleLocalVeto !== true) return 'VEHICLE_LOCAL_VETO_REQUIRED';
  if (!Number.isFinite(candidate.uncertainty) || candidate.uncertainty < 0 || candidate.uncertainty > 1) return 'INVALID_CANDIDATE_UNCERTAINTY';
  if (candidate.uncertainty > maxUncertainty) return 'CANDIDATE_UNCERTAINTY_TOO_HIGH';
  if (candidate.action !== 'NO_ACTION' && candidate.assumptions.length === 0) return 'COUNTERFACTUAL_ASSUMPTIONS_REQUIRED';
  if (!validProtectedOutcomeVector(candidate.predictedOutcomes)) return 'INVALID_PROTECTED_OUTCOME_VECTOR';
  return null;
}

function validProtectedOutcomeVector(value: ProtectedOutcomeVector): boolean {
  return Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);
}

function counterfactualBlocked(
  input: { readonly state: CognitiveRoadState; readonly evaluatedAt: string; readonly candidates: readonly CounterfactualCandidate[] },
  decision: CounterfactualEvaluation['decision'],
  reasonCodes: readonly string[],
): CounterfactualEvaluation {
  return {
    crsId: input.state.crsId,
    stateDigest: input.state.stateDigest,
    evaluatedAt: input.evaluatedAt,
    candidates: input.candidates,
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
  if (c <= 0) return 0;
  if (a <= Number.EPSILON) return null;

  const b = 2 * dot(relativePosition, relativeVelocity);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  for (const candidate of [first, second]) {
    if (candidate >= 0 && candidate <= horizonSeconds) return candidate;
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
  if (value.some((item) => !Number.isFinite(item))) throw new Error(`NON_FINITE_${label}`);
}
