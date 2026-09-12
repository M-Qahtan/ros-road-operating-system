import type { EpistemicCoverageDimension, EpistemicCoverageState } from './epistemic-coverage.js';

export const EVIDENCE_ACQUISITION_PLAN_SCHEMA = 'ros.evidence-acquisition-plan/v1' as const;

export type EvidenceAcquisitionRequestType =
  | 'FETCH_EXISTING_SENSOR_OBSERVATION'
  | 'FETCH_EXISTING_RSU_OBSERVATION'
  | 'FETCH_EXISTING_V2X_OBSERVATION'
  | 'REQUEST_OPERATOR_OBSERVATION'
  | 'REQUEST_CALIBRATION_REASSESSMENT'
  | 'WAIT_FOR_FRESH_OBSERVATION';

export type EvidenceAcquisitionPlanDecision =
  | 'PLAN_AVAILABLE'
  | 'REQUEST_HUMAN_REVIEW'
  | 'ABSTAIN';

export interface EvidenceAcquisitionTarget {
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly currentCoverageState: EpistemicCoverageState;
  /** S0..S4 semantics match ROS safety severity; higher is more safety-critical. */
  readonly safetyCriticality: 0 | 1 | 2 | 3 | 4;
  /** Minimum number of new epistemically independent classes requested. */
  readonly requiredNewIndependentClasses: number;
  readonly reasonCodes: readonly string[];
}

export interface EvidenceAcquisitionRequest {
  readonly requestId: string;
  readonly requestType: EvidenceAcquisitionRequestType;
  readonly sourceId: string;
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly expectedIndependenceClassDigest: string;
  readonly expectedIndependentGain: 0 | 1;
  readonly expectedEvidenceQuality: number;
  readonly expectedLatencyMs: number;
  readonly privacyBurden: number;
  readonly operationalCost: number;
  readonly validUntil: string;
  readonly assumptions: readonly string[];
  readonly requestOnly: true;
  readonly authority: 'NONE';
  readonly activationAuthorized: false;
  readonly configurationChangeAuthorized: false;
  readonly privateDeviceCompulsionAuthorized: false;
}

export interface EvidenceAcquisitionPlan {
  readonly schema: typeof EVIDENCE_ACQUISITION_PLAN_SCHEMA;
  readonly planId: string;
  readonly crsId: string;
  readonly stateDigest: string;
  readonly coverageMapId: string;
  readonly coverageMapDigest: string;
  /** Digest supplied by a separate trusted source-registry boundary. */
  readonly sourceRegistryDigest: string;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly decision: EvidenceAcquisitionPlanDecision;
  readonly targets: readonly EvidenceAcquisitionTarget[];
  readonly requests: readonly EvidenceAcquisitionRequest[];
  readonly unresolvedTargets: readonly EvidenceAcquisitionTarget[];
  readonly reasonCodes: readonly string[];
  readonly planDigest: string;
  readonly authority: 'NONE';
  readonly sensorActivationAuthorized: false;
  readonly sensorConfigurationChangeAuthorized: false;
  readonly privateSensorCompulsionAuthorized: false;
  readonly vehicleActuationAuthorized: false;
  readonly externalDispatchAuthorized: false;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const REQUEST_TYPES = new Set<EvidenceAcquisitionRequestType>([
  'FETCH_EXISTING_SENSOR_OBSERVATION',
  'FETCH_EXISTING_RSU_OBSERVATION',
  'FETCH_EXISTING_V2X_OBSERVATION',
  'REQUEST_OPERATOR_OBSERVATION',
  'REQUEST_CALIBRATION_REASSESSMENT',
  'WAIT_FOR_FRESH_OBSERVATION',
]);
const COVERAGE_STATES = new Set<EpistemicCoverageState>([
  'OBSERVED', 'DEGRADED', 'BLIND', 'CONTRADICTED', 'UNKNOWN',
]);
const COVERAGE_DIMENSIONS = new Set<EpistemicCoverageDimension>([
  'OCCUPANCY',
  'DYNAMIC_OBJECTS',
  'VELOCITY',
  'VULNERABLE_ROAD_USERS',
  'SIGNAL_STATE',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
]);

export function validateEvidenceAcquisitionTarget(value: EvidenceAcquisitionTarget): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_ACQUISITION_TARGET'];
  if (!boundedIdentifier(raw.regionId)) errors.push('INVALID_TARGET_REGION_ID');
  if (typeof raw.dimension !== 'string' || !COVERAGE_DIMENSIONS.has(raw.dimension as EpistemicCoverageDimension)) errors.push('INVALID_TARGET_DIMENSION');
  if (typeof raw.currentCoverageState !== 'string' || !COVERAGE_STATES.has(raw.currentCoverageState as EpistemicCoverageState)) {
    errors.push('INVALID_TARGET_COVERAGE_STATE');
  }
  if (!Number.isSafeInteger(raw.safetyCriticality) || (raw.safetyCriticality as number) < 0 || (raw.safetyCriticality as number) > 4) {
    errors.push('INVALID_TARGET_SAFETY_CRITICALITY');
  }
  if (!Number.isSafeInteger(raw.requiredNewIndependentClasses)
    || (raw.requiredNewIndependentClasses as number) < 0
    || (raw.requiredNewIndependentClasses as number) > 8) {
    errors.push('INVALID_REQUIRED_INDEPENDENT_CLASSES');
  }
  if (!Array.isArray(raw.reasonCodes)
    || raw.reasonCodes.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 128)) {
    errors.push('INVALID_TARGET_REASON_CODES');
  }
  return errors;
}

export function validateEvidenceAcquisitionRequest(value: EvidenceAcquisitionRequest): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_ACQUISITION_REQUEST'];
  if (!boundedIdentifier(raw.requestId)) errors.push('INVALID_REQUEST_ID');
  if (typeof raw.requestType !== 'string' || !REQUEST_TYPES.has(raw.requestType as EvidenceAcquisitionRequestType)) errors.push('INVALID_REQUEST_TYPE');
  if (!boundedIdentifier(raw.sourceId)) errors.push('INVALID_REQUEST_SOURCE_ID');
  if (!boundedIdentifier(raw.regionId)) errors.push('INVALID_REQUEST_REGION_ID');
  if (typeof raw.dimension !== 'string' || !COVERAGE_DIMENSIONS.has(raw.dimension as EpistemicCoverageDimension)) errors.push('INVALID_REQUEST_DIMENSION');
  if (typeof raw.expectedIndependenceClassDigest !== 'string' || !SHA256_HEX.test(raw.expectedIndependenceClassDigest)) {
    errors.push('INVALID_REQUEST_INDEPENDENCE_DIGEST');
  }
  if (raw.expectedIndependentGain !== 0 && raw.expectedIndependentGain !== 1) errors.push('INVALID_REQUEST_INDEPENDENCE_GAIN');
  for (const key of ['expectedEvidenceQuality', 'privacyBurden'] as const) {
    const metric = raw[key];
    if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0 || metric > 1) errors.push(`INVALID_REQUEST_UNIT_INTERVAL:${key}`);
  }
  for (const key of ['expectedLatencyMs', 'operationalCost'] as const) {
    const metric = raw[key];
    if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) errors.push(`INVALID_REQUEST_NON_NEGATIVE:${key}`);
  }
  if (typeof raw.validUntil !== 'string' || !Number.isFinite(Date.parse(raw.validUntil))) errors.push('INVALID_REQUEST_VALID_UNTIL');
  if (!Array.isArray(raw.assumptions)
    || raw.assumptions.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 256)) {
    errors.push('INVALID_REQUEST_ASSUMPTIONS');
  }
  if (raw.requestOnly !== true) errors.push('REQUEST_ONLY_INVARIANT_VIOLATION');
  if (raw.authority !== 'NONE') errors.push('ACQUISITION_AUTHORITY_FORBIDDEN');
  if (raw.activationAuthorized !== false) errors.push('SENSOR_ACTIVATION_FORBIDDEN');
  if (raw.configurationChangeAuthorized !== false) errors.push('SENSOR_CONFIGURATION_CHANGE_FORBIDDEN');
  if (raw.privateDeviceCompulsionAuthorized !== false) errors.push('PRIVATE_DEVICE_COMPULSION_FORBIDDEN');
  return errors;
}

export function validateEvidenceAcquisitionPlan(value: EvidenceAcquisitionPlan): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_ACQUISITION_PLAN'];
  if (raw.schema !== EVIDENCE_ACQUISITION_PLAN_SCHEMA) errors.push('UNSUPPORTED_ACQUISITION_PLAN_SCHEMA');
  if (!boundedIdentifier(raw.planId)) errors.push('INVALID_PLAN_ID');
  if (!boundedIdentifier(raw.crsId)) errors.push('INVALID_PLAN_CRS_ID');
  if (typeof raw.stateDigest !== 'string' || !SHA256_HEX.test(raw.stateDigest)) errors.push('INVALID_PLAN_STATE_DIGEST');
  if (!boundedIdentifier(raw.coverageMapId)) errors.push('INVALID_PLAN_COVERAGE_MAP_ID');
  if (typeof raw.coverageMapDigest !== 'string' || !SHA256_HEX.test(raw.coverageMapDigest)) errors.push('INVALID_PLAN_COVERAGE_DIGEST');
  if (typeof raw.sourceRegistryDigest !== 'string' || !SHA256_HEX.test(raw.sourceRegistryDigest)) errors.push('INVALID_SOURCE_REGISTRY_DIGEST');
  if (typeof raw.purpose !== 'string' || raw.purpose.trim().length === 0 || raw.purpose.length > 128) errors.push('INVALID_PLAN_PURPOSE');
  if (typeof raw.jurisdiction !== 'string' || raw.jurisdiction.trim().length === 0 || raw.jurisdiction.length > 128) errors.push('INVALID_PLAN_JURISDICTION');
  const generatedAt = typeof raw.generatedAt === 'string' ? Date.parse(raw.generatedAt) : Number.NaN;
  const validUntil = typeof raw.validUntil === 'string' ? Date.parse(raw.validUntil) : Number.NaN;
  if (!Number.isFinite(generatedAt) || !Number.isFinite(validUntil) || validUntil <= generatedAt) errors.push('INVALID_PLAN_WINDOW');
  if (!['PLAN_AVAILABLE', 'REQUEST_HUMAN_REVIEW', 'ABSTAIN'].includes(String(raw.decision))) errors.push('INVALID_PLAN_DECISION');
  if (!Array.isArray(raw.targets)) errors.push('INVALID_PLAN_TARGETS');
  else for (const target of raw.targets) errors.push(...validateEvidenceAcquisitionTarget(target as EvidenceAcquisitionTarget));
  if (!Array.isArray(raw.requests)) errors.push('INVALID_PLAN_REQUESTS');
  else for (const request of raw.requests) errors.push(...validateEvidenceAcquisitionRequest(request as EvidenceAcquisitionRequest));
  if (!Array.isArray(raw.unresolvedTargets)) errors.push('INVALID_PLAN_UNRESOLVED_TARGETS');
  else for (const target of raw.unresolvedTargets) errors.push(...validateEvidenceAcquisitionTarget(target as EvidenceAcquisitionTarget));
  if (!Array.isArray(raw.reasonCodes)
    || raw.reasonCodes.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > 128)) {
    errors.push('INVALID_PLAN_REASON_CODES');
  }
  if (typeof raw.planDigest !== 'string' || !SHA256_HEX.test(raw.planDigest)) errors.push('INVALID_PLAN_DIGEST');
  if (raw.authority !== 'NONE') errors.push('ACQUISITION_AUTHORITY_FORBIDDEN');
  if (raw.sensorActivationAuthorized !== false) errors.push('SENSOR_ACTIVATION_FORBIDDEN');
  if (raw.sensorConfigurationChangeAuthorized !== false) errors.push('SENSOR_CONFIGURATION_CHANGE_FORBIDDEN');
  if (raw.privateSensorCompulsionAuthorized !== false) errors.push('PRIVATE_DEVICE_COMPULSION_FORBIDDEN');
  if (raw.vehicleActuationAuthorized !== false) errors.push('VEHICLE_ACTUATION_FORBIDDEN');
  if (raw.externalDispatchAuthorized !== false) errors.push('EXTERNAL_DISPATCH_FORBIDDEN');
  return errors;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}
