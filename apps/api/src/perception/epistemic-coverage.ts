import { createHash } from 'node:crypto';
import {
  EPISTEMIC_COVERAGE_MAP_SCHEMA,
  assessSensorObservationAdmission,
  cognitiveStateRequiresAbstention,
  validateEpistemicCoverageAssertion,
  validateEpistemicCoverageRegion,
  validateEpistemicIndependenceLease,
  type CognitiveRoadState,
  type CounterfactualCandidate,
  type CounterfactualEvaluation,
  type DecisionCriticalCoverageGate,
  type EpistemicCoverageAssertion,
  type EpistemicCoverageAssertionState,
  type EpistemicCoverageCell,
  type EpistemicCoverageDimension,
  type EpistemicCoverageMap,
  type EpistemicCoverageRegion,
  type EpistemicIndependenceLease,
  type SensorDegradationCause,
  type SensorObservationEnvelope,
  type SensorSourceClass,
} from '@ros/contracts';
import { evaluateCounterfactualCandidates } from './spatial-counterfactual.js';

export interface EpistemicCoverageBuildInput {
  readonly mapId: string;
  readonly state: CognitiveRoadState;
  readonly trustedNowEpochMs: number;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly eventEpoch: string;
  readonly regions: readonly EpistemicCoverageRegion[];
  readonly dimensions: readonly EpistemicCoverageDimension[];
  readonly observations: readonly SensorObservationEnvelope[];
  readonly leases: readonly EpistemicIndependenceLease[];
  readonly assertions: readonly EpistemicCoverageAssertion[];
  readonly minimumIndependentCoverage?: number;
  readonly maximumObservedOcclusionFraction?: number;
}

interface TrustedCoverageAssertion {
  readonly assertion: EpistemicCoverageAssertion;
  readonly observation: SensorObservationEnvelope;
  readonly lease: EpistemicIndependenceLease;
  readonly admissionDisposition: 'ACCEPT' | 'DEGRADED_USABLE';
}

interface IndependenceClassSummary {
  readonly independenceClassDigest: string;
  readonly state: EpistemicCoverageAssertionState;
  readonly observationIds: readonly string[];
  readonly sourceClasses: readonly SensorSourceClass[];
  readonly degradationCauses: readonly SensorDegradationCause[];
  readonly maximumOcclusionFraction: number;
  readonly validUntilEpochMs: number;
  readonly reasonCodes: readonly string[];
  readonly degradedByAdmission: boolean;
}

const ALLOWED_DIMENSIONS = new Set<EpistemicCoverageDimension>([
  'OCCUPANCY',
  'DYNAMIC_OBJECTS',
  'VELOCITY',
  'VULNERABLE_ROAD_USERS',
  'SIGNAL_STATE',
  'ENVIRONMENT',
  'INFRASTRUCTURE',
]);

export function buildEpistemicCoverageMap(input: EpistemicCoverageBuildInput): EpistemicCoverageMap {
  validateBuildInput(input);

  const stateValidUntilEpochMs = Date.parse(input.state.validUntil);
  const generatedAt = new Date(input.trustedNowEpochMs).toISOString();
  const minimumIndependentCoverage = input.minimumIndependentCoverage ?? 2;
  const maximumObservedOcclusionFraction = input.maximumObservedOcclusionFraction ?? 0.2;

  const regionById = new Map<string, EpistemicCoverageRegion>();
  for (const region of input.regions) {
    const errors = validateEpistemicCoverageRegion(region);
    if (errors.length > 0) throw new Error(`INVALID_COVERAGE_REGION:${errors.join(',')}`);
    if (regionById.has(region.regionId)) throw new Error('DUPLICATE_COVERAGE_REGION_ID');
    if (region.zoneId !== input.state.zoneId) throw new Error('COVERAGE_REGION_ZONE_MISMATCH');
    regionById.set(region.regionId, region);
  }

  const observationById = new Map<string, SensorObservationEnvelope>();
  const admissionByObservationId = new Map<string, ReturnType<typeof assessSensorObservationAdmission>>();
  for (const observation of input.observations) {
    if (observationById.has(observation.observationId)) throw new Error('DUPLICATE_COVERAGE_OBSERVATION_ID');
    observationById.set(observation.observationId, observation);
    admissionByObservationId.set(
      observation.observationId,
      assessSensorObservationAdmission(observation, input.trustedNowEpochMs),
    );
  }

  const validLeases = input.leases.filter((lease) => {
    if (validateEpistemicIndependenceLease(lease, input.trustedNowEpochMs).length > 0) return false;
    return lease.roadStateDigest === input.state.stateDigest
      && lease.purpose === input.purpose
      && lease.jurisdiction === input.jurisdiction
      && lease.eventEpoch === input.eventEpoch
      && lease.authority === 'NONE';
  });

  const assertionIds = new Set<string>();
  const trustedByCell = new Map<string, TrustedCoverageAssertion[]>();
  for (const assertion of input.assertions) {
    if (assertionIds.has(assertion.assertionId)) throw new Error('DUPLICATE_COVERAGE_ASSERTION_ID');
    assertionIds.add(assertion.assertionId);

    if (validateEpistemicCoverageAssertion(assertion).length > 0) continue;
    if (!regionById.has(assertion.regionId)) continue;
    if (!ALLOWED_DIMENSIONS.has(assertion.dimension)) continue;
    if (!input.dimensions.includes(assertion.dimension)) continue;

    const assertionValidUntil = Date.parse(assertion.validUntil);
    if (!Number.isFinite(assertionValidUntil) || assertionValidUntil <= input.trustedNowEpochMs) continue;

    const observation = observationById.get(assertion.observationId);
    if (observation === undefined) continue;
    const admission = admissionByObservationId.get(observation.observationId)!;
    if (!admission.usableForCurrentState) continue;

    const expectedBinding = coverageObjectBinding(assertion.regionId, assertion.dimension);
    const lease = validLeases.find((item) => item.objectBinding === expectedBinding
      && item.observationIds.includes(assertion.observationId));
    if (lease === undefined) continue;

    const key = coverageCellKey(assertion.regionId, assertion.dimension);
    const existing = trustedByCell.get(key) ?? [];
    existing.push({
      assertion,
      observation,
      lease,
      admissionDisposition: admission.disposition === 'ACCEPT' ? 'ACCEPT' : 'DEGRADED_USABLE',
    });
    trustedByCell.set(key, existing);
  }

  const dimensions = [...new Set(input.dimensions)].sort();
  const cells: EpistemicCoverageCell[] = [];
  for (const region of [...input.regions].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
    for (const dimension of dimensions) {
      const trusted = trustedByCell.get(coverageCellKey(region.regionId, dimension)) ?? [];
      cells.push(fuseCoverageCell({
        regionId: region.regionId,
        dimension,
        trusted,
        trustedNowEpochMs: input.trustedNowEpochMs,
        stateValidUntilEpochMs,
        minimumIndependentCoverage,
        maximumObservedOcclusionFraction,
      }));
    }
  }

  const validUntilEpochMs = Math.min(
    stateValidUntilEpochMs,
    ...cells.map((cell) => Date.parse(cell.validUntil)).filter(Number.isFinite),
  );
  const validUntil = new Date(validUntilEpochMs).toISOString();
  const digestMaterial = {
    schema: EPISTEMIC_COVERAGE_MAP_SCHEMA,
    mapId: input.mapId,
    crsId: input.state.crsId,
    stateDigest: input.state.stateDigest,
    zoneId: input.state.zoneId,
    generatedAt,
    validUntil,
    regions: [...input.regions].sort((a, b) => a.regionId.localeCompare(b.regionId)),
    cells,
    authority: 'NONE' as const,
    negativeSceneInferenceAuthorized: false as const,
  };

  return {
    ...digestMaterial,
    mapDigest: sha256(stableStringify(digestMaterial)),
  };
}

export function evaluateDecisionCriticalCoverage(input: {
  readonly map: EpistemicCoverageMap;
  readonly state: CognitiveRoadState;
  readonly evaluatedAt: string;
  readonly regionIds: readonly string[];
  readonly dimensions: readonly EpistemicCoverageDimension[];
  readonly allowDegraded?: boolean;
}): DecisionCriticalCoverageGate {
  const evaluatedAt = Date.parse(input.evaluatedAt);
  const reasons = new Set<string>();
  const blockingRegionIds = new Set<string>();
  const blockingDimensions = new Set<EpistemicCoverageDimension>();

  if (!Number.isFinite(evaluatedAt)) return coverageGate('ABSTAIN', [], [], ['INVALID_COVERAGE_EVALUATION_TIME']);
  if (input.map.schema !== EPISTEMIC_COVERAGE_MAP_SCHEMA) return coverageGate('ABSTAIN', [], [], ['UNSUPPORTED_COVERAGE_MAP_SCHEMA']);
  if (input.map.authority !== 'NONE' || input.map.negativeSceneInferenceAuthorized !== false) {
    return coverageGate('ABSTAIN', [], [], ['COVERAGE_AUTHORITY_BOUNDARY_VIOLATION']);
  }
  if (input.map.crsId !== input.state.crsId || input.map.stateDigest !== input.state.stateDigest || input.map.zoneId !== input.state.zoneId) {
    return coverageGate('ABSTAIN', [], [], ['COVERAGE_CRS_BINDING_MISMATCH']);
  }
  if (!coverageDigestValid(input.map)) return coverageGate('ABSTAIN', [], [], ['COVERAGE_MAP_DIGEST_MISMATCH']);
  if (cognitiveStateRequiresAbstention(input.state)) return coverageGate('ABSTAIN', [], [], ['COGNITIVE_STATE_CONTRADICTED']);

  const mapValidUntil = Date.parse(input.map.validUntil);
  if (!Number.isFinite(mapValidUntil) || mapValidUntil <= evaluatedAt) {
    return coverageGate('REQUEST_MORE_EVIDENCE', input.regionIds, input.dimensions, ['EPISTEMIC_COVERAGE_EXPIRED']);
  }
  if (input.regionIds.length === 0 || input.dimensions.length === 0) {
    return coverageGate('ABSTAIN', [], [], ['EMPTY_DECISION_CRITICAL_COVERAGE_SCOPE']);
  }

  const requestedRegions = [...new Set(input.regionIds)];
  const requestedDimensions = [...new Set(input.dimensions)];
  for (const regionId of requestedRegions) {
    for (const dimension of requestedDimensions) {
      const cell = input.map.cells.find((item) => item.regionId === regionId && item.dimension === dimension);
      if (cell === undefined) {
        reasons.add('MISSING_DECISION_CRITICAL_COVERAGE_CELL');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
        continue;
      }
      const cellValidUntil = Date.parse(cell.validUntil);
      if (!Number.isFinite(cellValidUntil) || cellValidUntil <= evaluatedAt) {
        reasons.add('DECISION_CRITICAL_COVERAGE_CELL_EXPIRED');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
        continue;
      }
      if (cell.state === 'CONTRADICTED') {
        reasons.add('DECISION_CRITICAL_COVERAGE_CONTRADICTED');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
        continue;
      }
      if (cell.state === 'BLIND') {
        reasons.add('DECISION_CRITICAL_REGION_BLIND');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
        continue;
      }
      if (cell.state === 'UNKNOWN') {
        reasons.add('DECISION_CRITICAL_REGION_UNKNOWN');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
        continue;
      }
      if (cell.state === 'DEGRADED' && input.allowDegraded !== true) {
        reasons.add('DECISION_CRITICAL_COVERAGE_DEGRADED');
        blockingRegionIds.add(regionId);
        blockingDimensions.add(dimension);
      }
    }
  }

  if (reasons.has('DECISION_CRITICAL_COVERAGE_CONTRADICTED')) {
    return coverageGate('ABSTAIN', [...blockingRegionIds], [...blockingDimensions], [...reasons]);
  }
  if (reasons.size > 0) {
    return coverageGate('REQUEST_MORE_EVIDENCE', [...blockingRegionIds], [...blockingDimensions], [...reasons]);
  }
  return coverageGate('ALLOW_ADVISORY_EVALUATION', [], [], ['DECISION_CRITICAL_COVERAGE_OBSERVED']);
}

/**
 * Governed handoff: counterfactual ranking cannot run for a decision-critical
 * corridor until the epistemic coverage gate explicitly allows it.
 */
export function evaluateCoverageGovernedCounterfactualCandidates(input: {
  readonly map: EpistemicCoverageMap;
  readonly state: CognitiveRoadState;
  readonly evaluatedAt: string;
  readonly criticalRegionIds: readonly string[];
  readonly requiredDimensions: readonly EpistemicCoverageDimension[];
  readonly candidates: readonly CounterfactualCandidate[];
  readonly maxRecommendationUncertainty: number;
}): CounterfactualEvaluation {
  const gate = evaluateDecisionCriticalCoverage({
    map: input.map,
    state: input.state,
    evaluatedAt: input.evaluatedAt,
    regionIds: input.criticalRegionIds,
    dimensions: input.requiredDimensions,
  });

  if (gate.decision !== 'ALLOW_ADVISORY_EVALUATION') {
    return {
      crsId: input.state.crsId,
      stateDigest: input.state.stateDigest,
      evaluatedAt: input.evaluatedAt,
      candidates: input.candidates,
      selectedCandidateId: null,
      decision: gate.decision === 'ABSTAIN' ? 'ABSTAIN' : 'REQUEST_MORE_EVIDENCE',
      reasonCodes: [...new Set(['EPISTEMIC_COVERAGE_GATE_BLOCK', ...gate.reasonCodes])].sort(),
    };
  }

  return evaluateCounterfactualCandidates({
    state: input.state,
    evaluatedAt: input.evaluatedAt,
    candidates: input.candidates,
    maxRecommendationUncertainty: input.maxRecommendationUncertainty,
  });
}

function validateBuildInput(input: EpistemicCoverageBuildInput): void {
  if (!input.mapId.trim()) throw new Error('MISSING_COVERAGE_MAP_ID');
  if (!Number.isFinite(input.trustedNowEpochMs)) throw new Error('INVALID_TRUSTED_COVERAGE_TIME');
  if (!input.purpose.trim() || !input.jurisdiction.trim() || !input.eventEpoch.trim()) throw new Error('INVALID_COVERAGE_CONTEXT');
  if (!Array.isArray(input.regions) || input.regions.length === 0) throw new Error('MISSING_COVERAGE_REGIONS');
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) throw new Error('MISSING_COVERAGE_DIMENSIONS');
  if (input.dimensions.some((item) => !ALLOWED_DIMENSIONS.has(item))) throw new Error('UNSUPPORTED_COVERAGE_DIMENSION');
  const minimum = input.minimumIndependentCoverage ?? 2;
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 16) throw new Error('INVALID_MINIMUM_INDEPENDENT_COVERAGE');
  const maxOcclusion = input.maximumObservedOcclusionFraction ?? 0.2;
  if (!Number.isFinite(maxOcclusion) || maxOcclusion < 0 || maxOcclusion > 1) throw new Error('INVALID_MAXIMUM_OBSERVED_OCCLUSION');
  const stateValidUntil = Date.parse(input.state.validUntil);
  if (!Number.isFinite(stateValidUntil) || stateValidUntil <= input.trustedNowEpochMs) throw new Error('COGNITIVE_STATE_NOT_CURRENT_FOR_COVERAGE');
}

function fuseCoverageCell(input: {
  readonly regionId: string;
  readonly dimension: EpistemicCoverageDimension;
  readonly trusted: readonly TrustedCoverageAssertion[];
  readonly trustedNowEpochMs: number;
  readonly stateValidUntilEpochMs: number;
  readonly minimumIndependentCoverage: number;
  readonly maximumObservedOcclusionFraction: number;
}): EpistemicCoverageCell {
  if (input.trusted.length === 0) {
    return {
      regionId: input.regionId,
      dimension: input.dimension,
      state: 'UNKNOWN',
      effectiveIndependentEvidence: 0,
      independenceClassDigests: [],
      sourceClasses: [],
      supportingObservationIds: [],
      degradationCauses: [],
      maximumObservedOcclusionFraction: null,
      reasonCodes: ['NO_TRUSTED_CURRENT_COVERAGE_ASSERTION'],
      validUntil: new Date(input.stateValidUntilEpochMs).toISOString(),
      authority: 'NONE',
    };
  }

  const byClass = new Map<string, TrustedCoverageAssertion[]>();
  for (const item of input.trusted) {
    const existing = byClass.get(item.lease.independenceClassDigest) ?? [];
    existing.push(item);
    byClass.set(item.lease.independenceClassDigest, existing);
  }
  const summaries = [...byClass.entries()].map(([digest, values]) => summarizeIndependenceClass(digest, values, input.stateValidUntilEpochMs));
  const states = new Set(summaries.map((item) => item.state));
  const reasons = new Set<string>();
  let state: EpistemicCoverageCell['state'];

  if (states.has('BLIND') && (states.has('COVERED') || states.has('DEGRADED'))) {
    state = 'CONTRADICTED';
    reasons.add('MATERIAL_COVERAGE_CONTRADICTION');
  } else if ([...states].every((item) => item === 'BLIND')) {
    state = 'BLIND';
    reasons.add('ALL_TRUSTED_COVERAGE_CLASSES_BLIND');
  } else if ([...states].every((item) => item === 'UNKNOWN')) {
    state = 'UNKNOWN';
    reasons.add('TRUSTED_SOURCES_REPORT_COVERAGE_UNKNOWN');
  } else {
    const maxOcclusion = Math.max(...summaries.map((item) => item.maximumOcclusionFraction));
    const degraded = states.has('DEGRADED')
      || states.has('BLIND')
      || states.has('UNKNOWN')
      || summaries.some((item) => item.degradedByAdmission)
      || maxOcclusion > input.maximumObservedOcclusionFraction;

    if (summaries.length < input.minimumIndependentCoverage) {
      state = 'DEGRADED';
      reasons.add('INSUFFICIENT_INDEPENDENT_COVERAGE');
    } else if (degraded) {
      state = 'DEGRADED';
      reasons.add('COVERAGE_DEGRADED_OR_OCCLUDED');
    } else {
      state = 'OBSERVED';
      reasons.add('INDEPENDENT_CURRENT_COVERAGE_CORROBORATED');
    }
  }

  for (const summary of summaries) for (const reason of summary.reasonCodes) reasons.add(reason);
  const validUntilEpochMs = Math.min(input.stateValidUntilEpochMs, ...summaries.map((item) => item.validUntilEpochMs));
  const maximumObservedOcclusionFraction = Math.max(...summaries.map((item) => item.maximumOcclusionFraction));

  return {
    regionId: input.regionId,
    dimension: input.dimension,
    state,
    effectiveIndependentEvidence: summaries.length,
    independenceClassDigests: summaries.map((item) => item.independenceClassDigest).sort(),
    sourceClasses: uniqueSorted(summaries.flatMap((item) => item.sourceClasses)) as SensorSourceClass[],
    supportingObservationIds: uniqueSorted(summaries.flatMap((item) => item.observationIds)),
    degradationCauses: uniqueSorted(summaries.flatMap((item) => item.degradationCauses)) as SensorDegradationCause[],
    maximumObservedOcclusionFraction,
    reasonCodes: [...reasons].sort(),
    validUntil: new Date(validUntilEpochMs).toISOString(),
    authority: 'NONE',
  };
}

function summarizeIndependenceClass(
  independenceClassDigest: string,
  values: readonly TrustedCoverageAssertion[],
  stateValidUntilEpochMs: number,
): IndependenceClassSummary {
  const states = new Set(values.map((item) => item.assertion.state));
  let state: EpistemicCoverageAssertionState;
  const reasons = new Set<string>();

  if (states.size > 1) {
    state = 'DEGRADED';
    reasons.add('SAME_LINEAGE_COVERAGE_ASSERTIONS_DIVERGE');
  } else {
    state = values[0]!.assertion.state;
  }

  for (const item of values) {
    if (item.admissionDisposition === 'DEGRADED_USABLE') reasons.add('OBSERVATION_ADMITTED_DEGRADED');
    for (const reason of item.assertion.reasonCodes) reasons.add(reason);
  }

  const validUntilEpochMs = Math.min(
    stateValidUntilEpochMs,
    ...values.map((item) => Date.parse(item.assertion.validUntil)),
    ...values.map((item) => Date.parse(item.observation.capturedAt) + item.observation.timing.freshnessTtlMs),
    ...values.map((item) => Date.parse(item.lease.expiresAt)),
  );

  return {
    independenceClassDigest,
    state,
    observationIds: uniqueSorted(values.map((item) => item.observation.observationId)),
    sourceClasses: uniqueSorted(values.map((item) => item.observation.sourceClass)) as SensorSourceClass[],
    degradationCauses: uniqueSorted(values.flatMap((item) => [
      ...item.assertion.degradationCauses,
      ...item.observation.health.degradationCauses,
    ])) as SensorDegradationCause[],
    maximumOcclusionFraction: Math.max(...values.map((item) => item.assertion.occlusionFraction)),
    validUntilEpochMs,
    reasonCodes: [...reasons].sort(),
    degradedByAdmission: values.some((item) => item.admissionDisposition === 'DEGRADED_USABLE'),
  };
}

function coverageGate(
  decision: DecisionCriticalCoverageGate['decision'],
  blockingRegionIds: readonly string[],
  blockingDimensions: readonly EpistemicCoverageDimension[],
  reasonCodes: readonly string[],
): DecisionCriticalCoverageGate {
  return {
    decision,
    blockingRegionIds: uniqueSorted(blockingRegionIds),
    blockingDimensions: uniqueSorted(blockingDimensions) as EpistemicCoverageDimension[],
    reasonCodes: [...new Set(reasonCodes)].sort(),
    authority: 'NONE',
    negativeSceneInferenceAuthorized: false,
  };
}

function coverageDigestValid(map: EpistemicCoverageMap): boolean {
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

function coverageObjectBinding(regionId: string, dimension: EpistemicCoverageDimension): string {
  return `coverage:${regionId}:${dimension}`;
}

function coverageCellKey(regionId: string, dimension: EpistemicCoverageDimension): string {
  return `${regionId}\u0000${dimension}`;
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
