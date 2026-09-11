export const COGNITIVE_ROAD_STATE_SCHEMA = 'ros.cognitive-road-state/v1' as const;

export type CognitiveEntityClass =
  | 'VEHICLE'
  | 'PEDESTRIAN'
  | 'CYCLIST'
  | 'LIVESTOCK'
  | 'DEBRIS'
  | 'STATIC_OBSTACLE'
  | 'EMERGENCY_VEHICLE'
  | 'UNKNOWN';

export type EpistemicState =
  | 'CORROBORATED'
  | 'UNCERTAIN'
  | 'CONTRADICTED'
  | 'UNKNOWN';

export interface CognitiveKinematicState {
  readonly positionM: readonly [number, number, number];
  readonly estimatedVelocityMps: readonly [number, number, number];
  readonly estimatedAccelerationMps2?: readonly [number, number, number];
  readonly covariance: readonly number[];
  readonly estimator: string;
}

export interface CognitiveEntity {
  readonly entityId: string;
  readonly entityClass: CognitiveEntityClass;
  readonly state: CognitiveKinematicState;
  readonly laneId?: string;
  readonly roadSegmentId?: string;
  readonly supportingObservationIds: readonly string[];
  readonly contradictingObservationIds: readonly string[];
  readonly confidence: number;
  readonly epistemicState: EpistemicState;
  readonly validUntil: string;
}

export interface CognitiveHazard {
  readonly hazardId: string;
  readonly type: string;
  readonly severity: 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
  readonly confidence: number;
  readonly affectedEntityIds: readonly string[];
  readonly supportingObservationIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface CognitiveRoadState {
  readonly schema: typeof COGNITIVE_ROAD_STATE_SCHEMA;
  readonly crsId: string;
  readonly zoneId: string;
  readonly stateTime: string;
  readonly validUntil: string;
  readonly stateDigest: string;
  readonly sensorHealthDigest: string;
  readonly entities: readonly CognitiveEntity[];
  readonly hazards: readonly CognitiveHazard[];
  readonly trafficState: Readonly<Record<string, unknown>>;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly signalState: Readonly<Record<string, unknown>>;
  readonly infrastructureState: Readonly<Record<string, unknown>>;
  readonly evidenceObservationIds: readonly string[];
  readonly contradictions: readonly {
    readonly contradictionId: string;
    readonly observationIds: readonly string[];
    readonly material: boolean;
    readonly reason: string;
  }[];
  readonly epistemicSummary: {
    readonly known: readonly string[];
    readonly uncertain: readonly string[];
    readonly unknown: readonly string[];
  };
}

export type CounterfactualAction =
  | 'NO_ACTION'
  | 'WARN_ROAD_USER'
  | 'WARN_OPERATOR'
  | 'REQUEST_MORE_EVIDENCE'
  | 'ROUTE_RECOMMENDATION'
  | 'SIGNAL_PLAN_RECOMMENDATION'
  | 'EMERGENCY_CORRIDOR_RECOMMENDATION'
  | 'REDUCE_CONFIDENCE'
  | 'ABSTAIN'
  | 'REQUEST_HUMAN_REVIEW';

export interface ProtectedOutcomeVector {
  /** Lower is safer/better. */
  readonly humanSafetyRisk: number;
  readonly emergencyAccessRisk: number;
  readonly secondaryIncidentRisk: number;
  readonly evidenceIntegrityRisk: number;
  readonly authorityPrivacyRisk: number;
  readonly criticalNetworkResilienceRisk: number;
  readonly mobilityCost: number;
  readonly delayCost: number;
  readonly efficiencyCost: number;
}

export interface CounterfactualCandidate {
  readonly candidateId: string;
  readonly action: CounterfactualAction;
  readonly stateDigest: string;
  readonly validUntil: string;
  readonly assumptions: readonly string[];
  readonly predictedOutcomes: ProtectedOutcomeVector;
  readonly uncertainty: number;
  readonly authority: 'ADVISORY_ONLY';
  readonly directVehicleControl: false;
  readonly requiresVehicleLocalVeto: true;
}

export interface CounterfactualEvaluation {
  readonly crsId: string;
  readonly stateDigest: string;
  readonly evaluatedAt: string;
  readonly candidates: readonly CounterfactualCandidate[];
  readonly selectedCandidateId: string | null;
  readonly decision: 'RECOMMEND' | 'ABSTAIN' | 'REQUEST_MORE_EVIDENCE' | 'REQUEST_HUMAN_REVIEW';
  readonly reasonCodes: readonly string[];
}

const PROTECTED_KEYS: readonly (keyof ProtectedOutcomeVector)[] = [
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

/**
 * Lexicographic comparison: no lower-priority benefit may compensate for a
 * regression in a higher-priority protected objective.
 * Returns -1 when a is preferred, 1 when b is preferred, and 0 when equal.
 */
export function compareProtectedOutcomesLexicographically(
  a: ProtectedOutcomeVector,
  b: ProtectedOutcomeVector,
): -1 | 0 | 1 {
  for (const key of PROTECTED_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      throw new Error(`NON_FINITE_PROTECTED_OUTCOME:${key}`);
    }
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * Any material contradiction in the current Cognitive Road State prevents an
 * automatic recommendation from being treated as corroborated knowledge.
 */
export function cognitiveStateRequiresAbstention(state: CognitiveRoadState): boolean {
  return state.contradictions.some((item) => item.material)
    || state.entities.some((entity) => entity.epistemicState === 'CONTRADICTED');
}
