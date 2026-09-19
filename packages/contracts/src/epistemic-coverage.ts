import type { SensorDegradationCause, SensorSourceClass } from './sensor-perception.js';

export const EPISTEMIC_COVERAGE_ASSERTION_SCHEMA = 'ros.epistemic-coverage-assertion/v1' as const;
export const EPISTEMIC_COVERAGE_CONTRADICTION_SCHEMA = 'ros.epistemic-coverage-contradiction/v1' as const;
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
 * A source may assert its own observability of a region, but the assertion
 * itself is not trusted until ROS binds it to a current admitted observation
 * and a valid Epistemic Independence Lease.
 *
 * BLIND here means this evidence source cannot observe the requested dimension
 * in the bound region. It does not mean another independent modality cannot.
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

/**
 * Material contradiction is a separate evidence product. It cannot be inferred
 * merely because one sensor is blind while another sensor has coverage.
 */
export interface EpistemicCoverageContradiction {
  readonly schema: typeof EPISTEMIC_COVERAGE_CONTRADICTION_SCHEMA;
  readonly contradictionId: string;
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly observationIds: readonly string[];
  readonly independenceClassDigests: readonly string[];
  readonly reason: string;
  readonly validUntil: string;
  readonly material: true;
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
const DEGRADATION_CAUSES = new Set<SensorDegradationCause>([
  'GLARE',
  'LOW_LIGHT',
  'THERMAL_HAZE',
  'DUST',
  'SANDSTORM',
  'SMOKE',
  'FIRE_SATURATION',
  'PARTIAL_OCCLUSION',
  'DIRTY_APERTURE',
  'SIGNAL_NOISE',
  'CLOCK_DRIFT',
  'CALIBRATION_DRIFT',
  'PACKET_LOSS',
  'FRAME_DROP',
  'NETWORK_LATENCY',
  'POWER_DEGRADATION',
  'UNKNOWN',
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
  if (!Array.isArray(raw.degradationCauses)
    || raw.degradationCauses.some((item) => typeof item !== 'string' || !DEGRADATION_CAUSES.has(item as SensorDegradationCause))) {
    errors.push('INVALID_DEGRADATION_CAUSES');
  }
  if (!Array.isArray(raw.reasonCodes) || raw.reasonCodes.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 128)) errors.push('INVALID_REASON_CODES');
  if (typeof raw.validUntil !== 'string' || !Number.isFinite(Date.parse(raw.validUntil))) errors.push('INVALID_ASSERTION_VALID_UNTIL');
  if (raw.authority !== 'NONE') errors.push('COVERAGE_AUTHORITY_FORBIDDEN');
  return errors;
}

export function validateEpistemicCoverageContradiction(value: EpistemicCoverageContradiction): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_COVERAGE_CONTRADICTION'];
  if (raw.schema !== EPISTEMIC_COVERAGE_CONTRADICTION_SCHEMA) errors.push('UNSUPPORTED_COVERAGE_CONTRADICTION_SCHEMA');
  if (!boundedIdentifier(raw.contradictionId)) errors.push('INVALID_CONTRADICTION_ID');
  if (!boundedIdentifier(raw.regionId)) errors.push('INVALID_REGION_ID');
  if (typeof raw.dimension !== 'string' || !DIMENSIONS.has(raw.dimension as EpistemicCoverageDimension)) errors.push('INVALID_COVERAGE_DIMENSION');
  if (!Array.isArray(raw.observationIds) || raw.observationIds.length < 2 || raw.observationIds.some((item) => !boundedIdentifier(item))) {
    errors.push('INVALID_CONTRADICTION_OBSERVATIONS');
  }
  if (!Array.isArray(raw.independenceClassDigests)
    || raw.independenceClassDigests.length < 2
    || raw.independenceClassDigests.some((item) => typeof item !== 'string' || !SHA256_HEX.test(item))) {
    errors.push('INVALID_CONTRADICTION_INDEPENDENCE_CLASSES');
  }
  if (Array.isArray(raw.independenceClassDigests)
    && new Set(raw.independenceClassDigests).size !== raw.independenceClassDigests.length) {
    errors.push('DUPLICATE_CONTRADICTION_INDEPENDENCE_CLASS');
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0 || raw.reason.length > 256) errors.push('INVALID_CONTRADICTION_REASON');
  if (typeof raw.validUntil !== 'string' || !Number.isFinite(Date.parse(raw.validUntil))) errors.push('INVALID_CONTRADICTION_VALID_UNTIL');
  if (raw.material !== true) errors.push('COVERAGE_CONTRADICTION_NOT_MATERIAL');
  if (raw.authority !== 'NONE') errors.push('COVERAGE_AUTHORITY_FORBIDDEN');
  return errors;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}
