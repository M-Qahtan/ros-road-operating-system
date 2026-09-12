import type { SensorDegradationCause, SensorSourceClass } from './sensor-perception.js';

export const EPISTEMIC_COVERAGE_ASSERTION_SCHEMA = 'ros.epistemic-coverage-assertion/v1' as const;
export const EPISTEMIC_COVERAGE_MAP_SCHEMA = 'ros.epistemic-coverage-map/v1' as const;

export type EpistemicCoverageDimension =
  | 'OCCUPANCY'
  | 'DYNAMIC_OBJECTS'
  | 'VELOCITY'
  | 'VULNERABLE_ROAD_USERS'
  | 'SIGNAL_STATE'
  | 'ENVIRONMENT'
  | 'INFRASTRUCTURE';

export type EpistemicCoverageAssertionState =
  | 'COVERED'
  | 'DEGRADED'
  | 'BLIND'
  | 'UNKNOWN';

export type EpistemicCoverageState =
  | 'OBSERVED'
  | 'DEGRADED'
  | 'BLIND'
  | 'CONTRADICTED'
  | 'UNKNOWN';

export type EpistemicRegionType =
  | 'LANE'
  | 'CROSSWALK'
  | 'INTERSECTION_CONFLICT_ZONE'
  | 'ROAD_SEGMENT'
  | 'SHOULDER'
  | 'CUSTOM';

export interface EpistemicCoverageRegion {
  readonly regionId: string;
  readonly zoneId: string;
  readonly regionType: EpistemicRegionType;
  readonly spatialFrameId: string;
  /** Digest of the exact polygon/volume definition held in the geometry store. */
  readonly geometryDigest: string;
  readonly roadSegmentId?: string;
  readonly laneId?: string;
}

/**
 * A source may assert observability of a region, but the assertion itself is
 * not trusted until ROS binds it to a current admitted observation and a valid
 * Epistemic Independence Lease.
 */
export interface EpistemicCoverageAssertion {
  readonly schema: typeof EPISTEMIC_COVERAGE_ASSERTION_SCHEMA;
  readonly assertionId: string;
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly observationId: string;
  readonly state: EpistemicCoverageAssertionState;
  readonly confidence: number;
  readonly occlusionFraction: number;
  readonly degradationCauses: readonly SensorDegradationCause[];
  readonly reasonCodes: readonly string[];
  readonly validUntil: string;
  readonly authority: 'NONE';
}

export interface EpistemicCoverageCell {
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly state: EpistemicCoverageState;
  readonly effectiveIndependentEvidence: number;
  readonly independenceClassDigests: readonly string[];
  readonly sourceClasses: readonly SensorSourceClass[];
  readonly supportingObservationIds: readonly string[];
  readonly degradationCauses: readonly SensorDegradationCause[];
  readonly maximumObservedOcclusionFraction: number | null;
  readonly reasonCodes: readonly string[];
  readonly validUntil: string;
  readonly authority: 'NONE';
}

export interface EpistemicCoverageMap {
  readonly schema: typeof EPISTEMIC_COVERAGE_MAP_SCHEMA;
  readonly mapId: string;
  readonly crsId: string;
  readonly stateDigest: string;
  readonly zoneId: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly regions: readonly EpistemicCoverageRegion[];
  readonly cells: readonly EpistemicCoverageCell[];
  readonly mapDigest: string;
  readonly authority: 'NONE';
  /** Coverage never turns non-detection into proof that the scene is safe. */
  readonly negativeSceneInferenceAuthorized: false;
}

export interface DecisionCriticalCoverageGate {
  readonly decision: 'ALLOW_ADVISORY_EVALUATION' | 'REQUEST_MORE_EVIDENCE' | 'ABSTAIN';
  readonly blockingRegionIds: readonly string[];
  readonly blockingDimensions: readonly EpistemicCoverageDimension[];
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
  readonly negativeSceneInferenceAuthorized: false;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const DIMENSIONS = new Set<EpistemicCoverageDimension>([
  'OCCUPANCY',
  'DYNAMIC_OBJECTS',
  'VELOCITY',
  'VULNERABLE_ROAD_USERS',
  'SIGNAL_STATE',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
]);
const ASSERTION_STATES = new Set<EpistemicCoverageAssertionState>(['COVERED', 'DEGRADED', 'BLIND', 'UNKNOWN']);
const REGION_TYPES = new Set<EpistemicRegionType>([
  'LANE', 'CROSSWALK', 'INTERSECTION_CONFLICT_ZONE', 'ROAD_SEGMENT', 'SHOULDER', 'CUSTOM',
]);

export function validateEpistemicCoverageRegion(value: EpistemicCoverageRegion): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_COVERAGE_REGION'];
  if (!boundedIdentifier(raw.regionId)) errors.push('INVALID_REGION_ID');
  if (!boundedIdentifier(raw.zoneId)) errors.push('INVALID_ZONE_ID');
  if (typeof raw.regionType !== 'string' || !REGION_TYPES.has(raw.regionType as EpistemicRegionType)) errors.push('INVALID_REGION_TYPE');
  if (!boundedIdentifier(raw.spatialFrameId)) errors.push('INVALID_SPATIAL_FRAME_ID');
  if (typeof raw.geometryDigest !== 'string' || !SHA256_HEX.test(raw.geometryDigest)) errors.push('INVALID_GEOMETRY_DIGEST');
  if (raw.roadSegmentId !== undefined && !boundedIdentifier(raw.roadSegmentId)) errors.push('INVALID_ROAD_SEGMENT_ID');
  if (raw.laneId !== undefined && !boundedIdentifier(raw.laneId)) errors.push('INVALID_LANE_ID');
  return errors;
}

export function validateEpistemicCoverageAssertion(value: EpistemicCoverageAssertion): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_COVERAGE_ASSERTION'];
  if (raw.schema !== EPISTEMIC_COVERAGE_ASSERTION_SCHEMA) errors.push('UNSUPPORTED_COVERAGE_ASSERTION_SCHEMA');
  if (!boundedIdentifier(raw.assertionId)) errors.push('INVALID_ASSERTION_ID');
  if (!boundedIdentifier(raw.regionId)) errors.push('INVALID_REGION_ID');
  if (typeof raw.dimension !== 'string' || !DIMENSIONS.has(raw.dimension as EpistemicCoverageDimension)) errors.push('INVALID_COVERAGE_DIMENSION');
  if (!boundedIdentifier(raw.observationId)) errors.push('INVALID_OBSERVATION_ID');
  if (typeof raw.state !== 'string' || !ASSERTION_STATES.has(raw.state as EpistemicCoverageAssertionState)) errors.push('INVALID_ASSERTION_STATE');
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) errors.push('INVALID_ASSERTION_CONFIDENCE');
  if (typeof raw.occlusionFraction !== 'number' || !Number.isFinite(raw.occlusionFraction) || raw.occlusionFraction < 0 || raw.occlusionFraction > 1) errors.push('INVALID_OCCLUSION_FRACTION');
  if (!Array.isArray(raw.degradationCauses) || raw.degradationCauses.some((item) => typeof item !== 'string')) errors.push('INVALID_DEGRADATION_CAUSES');
  if (!Array.isArray(raw.reasonCodes) || raw.reasonCodes.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 128)) errors.push('INVALID_REASON_CODES');
  if (typeof raw.validUntil !== 'string' || !Number.isFinite(Date.parse(raw.validUntil))) errors.push('INVALID_ASSERTION_VALID_UNTIL');
  if (raw.authority !== 'NONE') errors.push('COVERAGE_AUTHORITY_FORBIDDEN');
  return errors;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}
