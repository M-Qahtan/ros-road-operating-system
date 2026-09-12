import { createHash } from 'node:crypto';
import {
  EPISTEMIC_COVERAGE_MAP_SCHEMA,
  EVIDENCE_ACQUISITION_PLAN_SCHEMA,
  cognitiveStateRequiresAbstention,
  validateEvidenceAcquisitionPlan,
  type CognitiveRoadState,
  type EpistemicCoverageDimension,
  type EpistemicCoverageMap,
  type EvidenceAcquisitionPlan,
  type EvidenceAcquisitionRequest,
  type EvidenceAcquisitionRequestType,
  type EvidenceAcquisitionTarget,
} from '@ros/contracts';

export type TrustedEvidenceSourceKind = 'SENSOR' | 'RSU' | 'V2X' | 'OPERATOR';
export type TrustedEvidenceSourceTrustBasis = 'CERTIFIED_ADAPTER' | 'AUTHORIZED_OPERATOR';

export interface TrustedEvidenceSourceRecord {
  readonly sourceId: string;
  readonly sourceKind: TrustedEvidenceSourceKind;
  readonly trustBasis: TrustedEvidenceSourceTrustBasis;
  readonly independenceClassDigest: string;
  readonly supportedRegionIds: readonly string[];
  readonly supportedDimensions: readonly EpistemicCoverageDimension[];
  readonly supportedRequestTypes: readonly EvidenceAcquisitionRequestType[];
  readonly currentlyAvailable: boolean;
  readonly evidenceRequestAuthorized: boolean;
  readonly activationRequired: boolean;
  readonly configurationChangeRequired: boolean;
  readonly privateDevice: boolean;
  readonly ownerConsentRequired: boolean;
  readonly ownerConsentPresent: boolean;
  readonly validUntil: string;
  readonly evidenceQuality: number;
  readonly latencyP95Ms: number;
  readonly privacyBurden: number;
  readonly operationalCost: number;
  /** Required for CERTIFIED_ADAPTER trust basis. */
  readonly certificationDecision?: 'CERTIFIED' | 'CERTIFIED_WITH_LIMITATIONS' | 'CONTEXT_ONLY' | 'REJECTED';
  readonly certificationEvidenceSetDigest?: string;
  /** Required for AUTHORIZED_OPERATOR trust basis. */
  readonly operatorAuthorizationActive?: boolean;
}

export interface CriticalEvidenceTargetInput {
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly safetyCriticality: 0 | 1 | 2 | 3 | 4;
}

export interface ActiveEvidenceAcquisitionInput {
  readonly planId: string;
  readonly state: CognitiveRoadState;
  readonly coverageMap: EpistemicCoverageMap;
  readonly trustedNowEpochMs: number;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly criticalTargets: readonly CriticalEvidenceTargetInput[];
  readonly trustedSources: readonly TrustedEvidenceSourceRecord[];
  /** Supplied from a separate trusted registry boundary. */
  readonly trustedSourceRegistryDigest: string;
  readonly maximumPlanTtlMs?: number;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SOURCE_KINDS = new Set<TrustedEvidenceSourceKind>(['SENSOR', 'RSU', 'V2X', 'OPERATOR']);
const TRUST_BASES = new Set<TrustedEvidenceSourceTrustBasis>(['CERTIFIED_ADAPTER', 'AUTHORIZED_OPERATOR']);
const DIMENSIONS = new Set<EpistemicCoverageDimension>([
  'OCCUPANCY',
  'DYNAMIC_OBJECTS',
  'VELOCITY',
  'VULNERABLE_ROAD_USERS',
  'SIGNAL_STATE',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
]);
const REQUEST_TYPES = new Set<EvidenceAcquisitionRequestType>([
  'FETCH_EXISTING_SENSOR_OBSERVATION',
  'FETCH_EXISTING_RSU_OBSERVATION',
  'FETCH_EXISTING_V2X_OBSERVATION',
  'REQUEST_OPERATOR_OBSERVATION',
  'REQUEST_CALIBRATION_REASSESSMENT',
  'WAIT_FOR_FRESH_OBSERVATION',
]);
const DIRECT_EVIDENCE_REQUEST_TYPES = new Set<EvidenceAcquisitionRequestType>([
  'FETCH_EXISTING_SENSOR_OBSERVATION',
  'FETCH_EXISTING_RSU_OBSERVATION',
  'FETCH_EXISTING_V2X_OBSERVATION',
  'REQUEST_OPERATOR_OBSERVATION',
  'WAIT_FOR_FRESH_OBSERVATION',
]);

export function computeTrustedEvidenceSourceRegistryDigest(
  sources: readonly TrustedEvidenceSourceRecord[],
): string {
  const canonical = [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return sha256(stableStringify(canonical));
}

export function planActiveEvidenceAcquisition(input: ActiveEvidenceAcquisitionInput): EvidenceAcquisitionPlan {
  const structuralErrors = validatePlannerInput(input);
  const actualRegistryDigest = computeTrustedEvidenceSourceRegistryDigest(input.trustedSources);
  if (actualRegistryDigest !== input.trustedSourceRegistryDigest) structuralErrors.push('SOURCE_REGISTRY_DIGEST_MISMATCH');

  const sourceErrors = validateTrustedSourceRegistry(input.trustedSources, input.trustedNowEpochMs);
  structuralErrors.push(...sourceErrors);

  if (structuralErrors.length > 0) {
    return makePlan({
      input,
      decision: 'ABSTAIN',
      targets: [],
      requests: [],
      unresolvedTargets: [],
      reasonCodes: [...new Set(['ACQUISITION_TRUST_BOUNDARY_REJECTED', ...structuralErrors])].sort(),
      registryDigest: input.trustedSourceRegistryDigest,
    });
  }

  if (cognitiveStateRequiresAbstention(input.state)) {
    return makePlan({
      input,
      decision: 'REQUEST_HUMAN_REVIEW',
      targets: [],
      requests: [],
      unresolvedTargets: [],
      reasonCodes: ['COGNITIVE_STATE_CONTRADICTED', 'AUTOMATED_ACQUISITION_SELECTION_WITHHELD'],
      registryDigest: actualRegistryDigest,
    });
  }

  const targets = deriveAcquisitionTargets(input);
  if (targets.length === 0) {
    return makePlan({
      input,
      decision: 'PLAN_AVAILABLE',
      targets: [],
      requests: [],
      unresolvedTargets: [],
      reasonCodes: ['NO_EVIDENCE_ACQUISITION_REQUIRED'],
      registryDigest: actualRegistryDigest,
    });
  }

  const eligibleSources = input.trustedSources.filter((source) => sourceEligibleAtTrustBoundary(source, input.trustedNowEpochMs));
  const requests: EvidenceAcquisitionRequest[] = [];
  const unresolvedTargets: EvidenceAcquisitionTarget[] = [];
  const reasons = new Set<string>();

  for (const target of targets) {
    const cell = input.coverageMap.cells.find((item) => item.regionId === target.regionId && item.dimension === target.dimension);
    const existingClasses = new Set(cell?.independenceClassDigests ?? []);
    const candidates = eligibleSources
      .filter((source) => source.supportedRegionIds.includes(target.regionId))
      .filter((source) => source.supportedDimensions.includes(target.dimension))
      .map((source) => ({
        source,
        expectedGain: existingClasses.has(source.independenceClassDigest) ? 0 as const : 1 as const,
        requestType: preferredDirectRequestType(source),
      }))
      .filter((candidate): candidate is { source: TrustedEvidenceSourceRecord; expectedGain: 0 | 1; requestType: EvidenceAcquisitionRequestType } => candidate.requestType !== null)
      .sort(compareEvidenceCandidates);

    const selectedClasses = new Set<string>();
    let remaining = target.requiredNewIndependentClasses;
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      if (candidate.expectedGain !== 1) continue;
      if (selectedClasses.has(candidate.source.independenceClassDigest)) continue;
      selectedClasses.add(candidate.source.independenceClassDigest);
      remaining -= 1;

      const requestValidUntilEpochMs = Math.min(
        Date.parse(candidate.source.validUntil),
        Date.parse(input.state.validUntil),
        Date.parse(input.coverageMap.validUntil),
        input.trustedNowEpochMs + (input.maximumPlanTtlMs ?? 5_000),
      );
      requests.push({
        requestId: requestIdFor(target, candidate.source.sourceId),
        requestType: candidate.requestType,
        sourceId: candidate.source.sourceId,
        regionId: target.regionId,
        dimension: target.dimension,
        expectedIndependenceClassDigest: candidate.source.independenceClassDigest,
        expectedIndependentGain: 1,
        expectedEvidenceQuality: candidate.source.evidenceQuality,
        expectedLatencyMs: candidate.source.latencyP95Ms,
        privacyBurden: candidate.source.privacyBurden,
        operationalCost: candidate.source.operationalCost,
        validUntil: new Date(requestValidUntilEpochMs).toISOString(),
        assumptions: [
          'SOURCE_REMAINS_AVAILABLE_UNTIL_REQUEST_COMPLETION',
          'EXPECTED_INDEPENDENCE_CLASS_REQUIRES_POST_ACQUISITION_REVALIDATION',
          'ACQUISITION_RESULT_REQUIRES_NORMAL_ADMISSION_AND_EVIDENCE_ASSURANCE',
        ],
        requestOnly: true,
        authority: 'NONE',
        activationAuthorized: false,
        configurationChangeAuthorized: false,
        privateDeviceCompulsionAuthorized: false,
      });
    }

    if (remaining > 0) {
      unresolvedTargets.push(target);
      reasons.add('INSUFFICIENT_AUTHORIZED_INDEPENDENT_EVIDENCE_PATHS');
    } else {
      reasons.add('INDEPENDENT_EVIDENCE_PATH_IDENTIFIED');
    }
  }

  const decision = unresolvedTargets.length > 0 ? 'REQUEST_HUMAN_REVIEW' : 'PLAN_AVAILABLE';
  if (unresolvedTargets.length > 0) reasons.add('HUMAN_REVIEW_REQUIRED_FOR_UNRESOLVED_EPISTEMIC_GAP');

  return makePlan({
    input,
    decision,
    targets,
    requests,
    unresolvedTargets,
    reasonCodes: [...reasons].sort(),
    registryDigest: actualRegistryDigest,
  });
}

function deriveAcquisitionTargets(input: ActiveEvidenceAcquisitionInput): EvidenceAcquisitionTarget[] {
  const targets: EvidenceAcquisitionTarget[] = [];
  const seen = new Set<string>();
  for (const requested of [...input.criticalTargets].sort((a, b) => {
    if (a.safetyCriticality !== b.safetyCriticality) return b.safetyCriticality - a.safetyCriticality;
    return `${a.regionId}:${a.dimension}`.localeCompare(`${b.regionId}:${b.dimension}`);
  })) {
    const key = `${requested.regionId}\u0000${requested.dimension}`;
    if (seen.has(key)) throw new Error('DUPLICATE_CRITICAL_ACQUISITION_TARGET');
    seen.add(key);
    const cell = input.coverageMap.cells.find((item) => item.regionId === requested.regionId && item.dimension === requested.dimension);
    const currentState = cell?.state ?? 'UNKNOWN';
    if (currentState === 'OBSERVED') continue;

    const requiredNewIndependentClasses = currentState === 'DEGRADED' ? 1 : 2;
    targets.push({
      regionId: requested.regionId,
      dimension: requested.dimension,
      currentCoverageState: currentState,
      safetyCriticality: requested.safetyCriticality,
      requiredNewIndependentClasses,
      reasonCodes: cell === undefined
        ? ['DECISION_CRITICAL_COVERAGE_CELL_MISSING']
        : uniqueSorted(['DECISION_CRITICAL_EPISTEMIC_GAP', ...cell.reasonCodes]),
    });
  }
  return targets;
}

function validatePlannerInput(input: ActiveEvidenceAcquisitionInput): string[] {
  const errors: string[] = [];
  if (!boundedIdentifier(input.planId)) errors.push('INVALID_ACQUISITION_PLAN_ID');
  if (!Number.isFinite(input.trustedNowEpochMs)) errors.push('INVALID_TRUSTED_ACQUISITION_TIME');
  if (!boundedText(input.purpose, 128)) errors.push('INVALID_ACQUISITION_PURPOSE');
  if (!boundedText(input.jurisdiction, 128)) errors.push('INVALID_ACQUISITION_JURISDICTION');
  if (!Array.isArray(input.criticalTargets) || input.criticalTargets.length === 0) errors.push('MISSING_CRITICAL_ACQUISITION_TARGETS');
  if (!Array.isArray(input.trustedSources)) errors.push('INVALID_TRUSTED_SOURCE_REGISTRY');
  if (!SHA256_HEX.test(input.trustedSourceRegistryDigest)) errors.push('INVALID_TRUSTED_SOURCE_REGISTRY_DIGEST');
  const ttl = input.maximumPlanTtlMs ?? 5_000;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 60_000) errors.push('INVALID_ACQUISITION_PLAN_TTL');

  if (input.coverageMap.schema !== EPISTEMIC_COVERAGE_MAP_SCHEMA) errors.push('UNSUPPORTED_COVERAGE_MAP_SCHEMA');
  if (input.coverageMap.authority !== 'NONE' || input.coverageMap.negativeSceneInferenceAuthorized !== false) {
    errors.push('COVERAGE_AUTHORITY_BOUNDARY_VIOLATION');
  }
  if (input.coverageMap.crsId !== input.state.crsId
    || input.coverageMap.stateDigest !== input.state.stateDigest
    || input.coverageMap.zoneId !== input.state.zoneId) {
    errors.push('COVERAGE_CRS_BINDING_MISMATCH');
  }
  if (!coverageMapDigestValid(input.coverageMap)) errors.push('COVERAGE_MAP_DIGEST_MISMATCH');

  const stateValidUntil = Date.parse(input.state.validUntil);
  const mapValidUntil = Date.parse(input.coverageMap.validUntil);
  if (!Number.isFinite(stateValidUntil) || stateValidUntil <= input.trustedNowEpochMs) errors.push('COGNITIVE_STATE_EXPIRED_FOR_ACQUISITION');
  if (!Number.isFinite(mapValidUntil) || mapValidUntil <= input.trustedNowEpochMs) errors.push('COVERAGE_MAP_EXPIRED_FOR_ACQUISITION');

  const targetKeys = new Set<string>();
  if (Array.isArray(input.criticalTargets)) {
    for (const target of input.criticalTargets) {
      if (!boundedIdentifier(target.regionId)) errors.push('INVALID_CRITICAL_TARGET_REGION_ID');
      if (!DIMENSIONS.has(target.dimension)) errors.push('INVALID_CRITICAL_TARGET_DIMENSION');
      if (!Number.isSafeInteger(target.safetyCriticality) || target.safetyCriticality < 0 || target.safetyCriticality > 4) {
        errors.push('INVALID_CRITICAL_TARGET_SAFETY');
      }
      const key = `${target.regionId}\u0000${target.dimension}`;
      if (targetKeys.has(key)) errors.push('DUPLICATE_CRITICAL_ACQUISITION_TARGET');
      targetKeys.add(key);
    }
  }
  return errors;
}

function validateTrustedSourceRegistry(
  sources: readonly TrustedEvidenceSourceRecord[],
  trustedNowEpochMs: number,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const source of sources as readonly unknown[]) {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      errors.push('INVALID_TRUSTED_SOURCE_RECORD');
      continue;
    }
    const raw = source as Record<string, unknown>;
    const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId : 'UNKNOWN';
    if (!boundedIdentifier(raw.sourceId)) errors.push(`INVALID_SOURCE_ID:${sourceId}`);
    if (ids.has(sourceId)) errors.push(`DUPLICATE_SOURCE_ID:${sourceId}`);
    ids.add(sourceId);
    if (typeof raw.sourceKind !== 'string' || !SOURCE_KINDS.has(raw.sourceKind as TrustedEvidenceSourceKind)) errors.push(`INVALID_SOURCE_KIND:${sourceId}`);
    if (typeof raw.trustBasis !== 'string' || !TRUST_BASES.has(raw.trustBasis as TrustedEvidenceSourceTrustBasis)) errors.push(`INVALID_SOURCE_TRUST_BASIS:${sourceId}`);
    if (typeof raw.independenceClassDigest !== 'string' || !SHA256_HEX.test(raw.independenceClassDigest)) errors.push(`INVALID_SOURCE_INDEPENDENCE_CLASS:${sourceId}`);
    if (!Array.isArray(raw.supportedRegionIds) || raw.supportedRegionIds.length === 0 || raw.supportedRegionIds.some((item) => !boundedIdentifier(item))) {
      errors.push(`INVALID_SOURCE_REGIONS:${sourceId}`);
    }
    if (!Array.isArray(raw.supportedDimensions) || raw.supportedDimensions.length === 0
      || raw.supportedDimensions.some((item) => typeof item !== 'string' || !DIMENSIONS.has(item as EpistemicCoverageDimension))) {
      errors.push(`INVALID_SOURCE_DIMENSIONS:${sourceId}`);
    }
    if (!Array.isArray(raw.supportedRequestTypes) || raw.supportedRequestTypes.length === 0
      || raw.supportedRequestTypes.some((item) => typeof item !== 'string' || !REQUEST_TYPES.has(item as EvidenceAcquisitionRequestType))) {
      errors.push(`INVALID_SOURCE_REQUEST_TYPES:${sourceId}`);
    }
    for (const key of [
      'currentlyAvailable',
      'evidenceRequestAuthorized',
      'activationRequired',
      'configurationChangeRequired',
      'privateDevice',
      'ownerConsentRequired',
      'ownerConsentPresent',
    ] as const) {
      if (typeof raw[key] !== 'boolean') errors.push(`INVALID_SOURCE_BOOLEAN:${sourceId}:${key}`);
    }
    const validUntil = typeof raw.validUntil === 'string' ? Date.parse(raw.validUntil) : Number.NaN;
    if (!Number.isFinite(validUntil)) errors.push(`INVALID_SOURCE_VALID_UNTIL:${sourceId}`);
    else if (validUntil <= trustedNowEpochMs) errors.push(`EXPIRED_TRUSTED_SOURCE_RECORD:${sourceId}`);
    for (const key of ['evidenceQuality', 'privacyBurden'] as const) {
      const metric = raw[key];
      if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0 || metric > 1) errors.push(`INVALID_SOURCE_UNIT_INTERVAL:${sourceId}:${key}`);
    }
    for (const key of ['latencyP95Ms', 'operationalCost'] as const) {
      const metric = raw[key];
      if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) errors.push(`INVALID_SOURCE_NON_NEGATIVE:${sourceId}:${key}`);
    }

    if (raw.trustBasis === 'CERTIFIED_ADAPTER') {
      if (raw.certificationDecision !== 'CERTIFIED') errors.push(`SOURCE_NOT_FULLY_CERTIFIED:${sourceId}`);
      if (typeof raw.certificationEvidenceSetDigest !== 'string' || !SHA256_HEX.test(raw.certificationEvidenceSetDigest)) {
        errors.push(`INVALID_SOURCE_CERTIFICATION_DIGEST:${sourceId}`);
      }
    } else if (raw.trustBasis === 'AUTHORIZED_OPERATOR') {
      if (raw.operatorAuthorizationActive !== true) errors.push(`OPERATOR_AUTHORIZATION_INACTIVE:${sourceId}`);
    }
  }
  return errors;
}

function sourceEligibleAtTrustBoundary(source: TrustedEvidenceSourceRecord, trustedNowEpochMs: number): boolean {
  if (!source.currentlyAvailable || !source.evidenceRequestAuthorized) return false;
  if (source.activationRequired || source.configurationChangeRequired) return false;
  if (source.privateDevice && source.ownerConsentRequired && !source.ownerConsentPresent) return false;
  if (Date.parse(source.validUntil) <= trustedNowEpochMs) return false;
  if (source.trustBasis === 'CERTIFIED_ADAPTER' && source.certificationDecision !== 'CERTIFIED') return false;
  if (source.trustBasis === 'AUTHORIZED_OPERATOR' && source.operatorAuthorizationActive !== true) return false;
  return true;
}

function preferredDirectRequestType(source: TrustedEvidenceSourceRecord): EvidenceAcquisitionRequestType | null {
  const expectedByKind: Readonly<Record<TrustedEvidenceSourceKind, readonly EvidenceAcquisitionRequestType[]>> = {
    SENSOR: ['FETCH_EXISTING_SENSOR_OBSERVATION', 'WAIT_FOR_FRESH_OBSERVATION'],
    RSU: ['FETCH_EXISTING_RSU_OBSERVATION', 'WAIT_FOR_FRESH_OBSERVATION'],
    V2X: ['FETCH_EXISTING_V2X_OBSERVATION', 'WAIT_FOR_FRESH_OBSERVATION'],
    OPERATOR: ['REQUEST_OPERATOR_OBSERVATION'],
  };
  for (const type of expectedByKind[source.sourceKind]) {
    if (DIRECT_EVIDENCE_REQUEST_TYPES.has(type) && source.supportedRequestTypes.includes(type)) return type;
  }
  return null;
}

function compareEvidenceCandidates(
  a: { readonly source: TrustedEvidenceSourceRecord; readonly expectedGain: 0 | 1 },
  b: { readonly source: TrustedEvidenceSourceRecord; readonly expectedGain: 0 | 1 },
): number {
  if (a.expectedGain !== b.expectedGain) return b.expectedGain - a.expectedGain;
  if (a.source.evidenceQuality !== b.source.evidenceQuality) return b.source.evidenceQuality - a.source.evidenceQuality;
  if (a.source.latencyP95Ms !== b.source.latencyP95Ms) return a.source.latencyP95Ms - b.source.latencyP95Ms;
  if (a.source.privacyBurden !== b.source.privacyBurden) return a.source.privacyBurden - b.source.privacyBurden;
  if (a.source.operationalCost !== b.source.operationalCost) return a.source.operationalCost - b.source.operationalCost;
  return a.source.sourceId.localeCompare(b.source.sourceId);
}

function requestIdFor(target: EvidenceAcquisitionTarget, sourceId: string): string {
  const material = `${target.regionId}|${target.dimension}|${sourceId}`;
  return `acq:${sha256(material).slice(0, 24)}`;
}

function makePlan(input: {
  readonly input: ActiveEvidenceAcquisitionInput;
  readonly decision: EvidenceAcquisitionPlan['decision'];
  readonly targets: readonly EvidenceAcquisitionTarget[];
  readonly requests: readonly EvidenceAcquisitionRequest[];
  readonly unresolvedTargets: readonly EvidenceAcquisitionTarget[];
  readonly reasonCodes: readonly string[];
  readonly registryDigest: string;
}): EvidenceAcquisitionPlan {
  const generatedAt = new Date(Number.isFinite(input.input.trustedNowEpochMs) ? input.input.trustedNowEpochMs : 0).toISOString();
  const ttl = Number.isSafeInteger(input.input.maximumPlanTtlMs) && (input.input.maximumPlanTtlMs ?? 0) > 0
    ? input.input.maximumPlanTtlMs!
    : 5_000;
  const boundaryTimes = [
    input.input.trustedNowEpochMs + ttl,
    Date.parse(input.input.state.validUntil),
    Date.parse(input.input.coverageMap.validUntil),
    ...input.requests.map((request) => Date.parse(request.validUntil)),
  ].filter(Number.isFinite);
  let validUntilEpochMs = boundaryTimes.length > 0 ? Math.min(...boundaryTimes) : input.input.trustedNowEpochMs + 1;
  if (!Number.isFinite(validUntilEpochMs) || validUntilEpochMs <= input.input.trustedNowEpochMs) {
    validUntilEpochMs = input.input.trustedNowEpochMs + 1;
  }
  const validUntil = new Date(validUntilEpochMs).toISOString();
  const material = {
    schema: EVIDENCE_ACQUISITION_PLAN_SCHEMA,
    planId: boundedIdentifier(input.input.planId) ? input.input.planId : 'invalid-acquisition-plan',
    crsId: boundedIdentifier(input.input.state.crsId) ? input.input.state.crsId : 'invalid-crs',
    stateDigest: SHA256_HEX.test(input.input.state.stateDigest) ? input.input.state.stateDigest : '0'.repeat(64),
    coverageMapId: boundedIdentifier(input.input.coverageMap.mapId) ? input.input.coverageMap.mapId : 'invalid-coverage-map',
    coverageMapDigest: SHA256_HEX.test(input.input.coverageMap.mapDigest) ? input.input.coverageMap.mapDigest : '0'.repeat(64),
    sourceRegistryDigest: SHA256_HEX.test(input.registryDigest) ? input.registryDigest : '0'.repeat(64),
    purpose: boundedText(input.input.purpose, 128) ? input.input.purpose : 'invalid-purpose',
    jurisdiction: boundedText(input.input.jurisdiction, 128) ? input.input.jurisdiction : 'invalid-jurisdiction',
    generatedAt,
    validUntil,
    decision: input.decision,
    targets: input.targets,
    requests: input.requests,
    unresolvedTargets: input.unresolvedTargets,
    reasonCodes: input.reasonCodes.length > 0 ? input.reasonCodes : ['NO_PLAN_REASON_RECORDED'],
    authority: 'NONE' as const,
    sensorActivationAuthorized: false as const,
    sensorConfigurationChangeAuthorized: false as const,
    privateSensorCompulsionAuthorized: false as const,
    vehicleActuationAuthorized: false as const,
    externalDispatchAuthorized: false as const,
  };
  const plan: EvidenceAcquisitionPlan = {
    ...material,
    planDigest: sha256(stableStringify(material)),
  };
  const errors = validateEvidenceAcquisitionPlan(plan);
  if (errors.length > 0) {
    throw new Error(`INTERNAL_ACQUISITION_PLAN_INVARIANT:${errors.join(',')}`);
  }
  return plan;
}

function coverageMapDigestValid(map: EpistemicCoverageMap): boolean {
  const material = {
    schema: map.schema,
    mapId: map.mapId,
    crsId: map.crsId,
    stateDigest: map.stateDigest,
    zoneId: map.zoneId,
    generatedAt: map.generatedAt,
    validUntil: map.validUntil,
    regions: map.regions,
    cells: map.cells,
    authority: map.authority,
    negativeSceneInferenceAuthorized: map.negativeSceneInferenceAuthorized,
  };
  return sha256(stableStringify(material)) === map.mapDigest;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}
