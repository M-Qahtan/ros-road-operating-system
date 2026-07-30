import { createHash } from 'node:crypto';
import {
  SAFETY_FUSION_FRESH_EVIDENCE_MS,
  SAFETY_FUSION_MAX_EVIDENCE_AGE_MS,
  SAFETY_FUSION_POLICY_VERSION,
  SAFETY_FUSION_REGISTRY_SCHEMA_VERSION,
  SAFETY_FUSION_THRESHOLD_VERSION,
  type SafetyFusionClockPort,
  type SafetyFusionDeviceCondition,
  type SafetyFusionEvidence,
  type SafetyFusionEvidenceCode,
  type SafetyFusionFingerprintPort,
  type SafetyFusionGuardDisposition,
  type SafetyFusionGuardKind,
  type SafetyFusionGuardPort,
  type SafetyFusionGuardResult,
  type SafetyFusionInput,
  type SafetyFusionIntegrity,
  type SafetyFusionMissingEvidenceFlag,
  type SafetyFusionReasonCode,
  type SafetyFusionRecommendation,
  type SafetyFusionRegistryPort,
  type SafetyFusionRuleSetRegistryEntry,
  type SafetyFusionSeverity,
  type SafetyFusionSourceContribution,
  type SafetyFusionSourceType
} from '@ros/contracts';

export const SAFETY_FUSION_RULE_SET_VERSION = 'ros-eye.safety-fusion.rules.v1' as const;
export const SAFETY_FUSION_SAFE_DEFAULT_RULE_SET_VERSION = 'ros-eye.safety-fusion.rules.safe-default.v0' as const;
export const SAFETY_FUSION_MAX_INPUTS = 256;

const SEVERITY_RANK: Readonly<Record<SafetyFusionSeverity, number>> = Object.freeze({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 });
const SEVERITY_BY_RANK: readonly SafetyFusionSeverity[] = ['S0', 'S1', 'S2', 'S3', 'S4'];
const SOURCE_TYPES = new Set<SafetyFusionSourceType>(['PHONE', 'VEHICLE', 'PERSON', 'OPERATOR', 'INFRASTRUCTURE', 'CONTACT_RUNTIME', 'SIMULATION']);
const INTEGRITY_VALUES = new Set<SafetyFusionIntegrity>(['VERIFIED', 'UNVERIFIED', 'INVALID']);
const DEVICE_CONDITIONS = new Set<SafetyFusionDeviceCondition>(['HEALTHY', 'DEGRADED', 'UNKNOWN']);
const GUARD_KINDS = new Set<SafetyFusionGuardKind>(['DATA_QUALITY', 'DRIFT', 'OUT_OF_DISTRIBUTION', 'ADVERSARIAL_INPUT']);
const ALLOWED_EVIDENCE_CODES = new Set<SafetyFusionEvidenceCode>([
  'PERSON_RESPONDED', 'PERSON_NOT_RESPONDING', 'COMMUNICATION_INTERRUPTED', 'HELP_REQUESTED',
  'POSSIBLE_IMMEDIATE_DANGER', 'LOCATION_UNCERTAIN', 'MULTIPLE_PEOPLE_REPORTED',
  'CONTRADICTORY_RESPONSE', 'ACCESSIBILITY_SUPPORT_REQUIRED', 'DEVICE_IMPACT', 'DEVICE_AIRBAG',
  'DEVICE_ROLLOVER', 'DEVICE_HARD_BRAKE', 'CHANNEL_HEALTHY', 'CHANNEL_UNAVAILABLE',
  'SOURCE_CLOCK_SKEW', 'SOURCE_INTEGRITY_FAILURE', 'SOURCE_CONFLICT'
]);

const BASE_WEIGHT: Readonly<Record<SafetyFusionEvidenceCode, number>> = Object.freeze({
  PERSON_RESPONDED: 1.5,
  PERSON_NOT_RESPONDING: 4,
  COMMUNICATION_INTERRUPTED: 2,
  HELP_REQUESTED: 4,
  POSSIBLE_IMMEDIATE_DANGER: 4.5,
  LOCATION_UNCERTAIN: 0.75,
  MULTIPLE_PEOPLE_REPORTED: 2,
  CONTRADICTORY_RESPONSE: 1.5,
  ACCESSIBILITY_SUPPORT_REQUIRED: 0.25,
  DEVICE_IMPACT: 2.5,
  DEVICE_AIRBAG: 4,
  DEVICE_ROLLOVER: 4.5,
  DEVICE_HARD_BRAKE: 1.25,
  CHANNEL_HEALTHY: 0.5,
  CHANNEL_UNAVAILABLE: 1.5,
  SOURCE_CLOCK_SKEW: 1,
  SOURCE_INTEGRITY_FAILURE: 2,
  SOURCE_CONFLICT: 1.5
});

const REASON_ORDER: readonly SafetyFusionReasonCode[] = [
  'FUSION_HIGH_RISK_INDICATOR', 'FUSION_DEVICE_AIRBAG', 'FUSION_DEVICE_ROLLOVER',
  'FUSION_DEVICE_IMPACT', 'FUSION_HELP_REQUESTED', 'FUSION_NO_RESPONSE',
  'FUSION_CHANNEL_UNAVAILABLE', 'FUSION_CORROBORATED', 'FUSION_CONTRADICTORY_INPUTS',
  'FUSION_SPARSE_EVIDENCE', 'FUSION_STALE_EVIDENCE', 'FUSION_DEGRADED_DEVICE',
  'FUSION_UNVERIFIED_SOURCE', 'FUSION_GUARD_DEGRADED', 'FUSION_GUARD_BLOCKED',
  'FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED', 'FUSION_HIGH_UNCERTAINTY',
  'FUSION_HUMAN_AUTHORITY_REQUIRED'
];

const MISSING_ORDER: readonly SafetyFusionMissingEvidenceFlag[] = [
  'MISSING_RECENT_TRUSTED_SOURCE', 'MISSING_CORROBORATION', 'MISSING_CONTACT_OUTCOME',
  'MISSING_DEVICE_HEALTH', 'MISSING_LOCATION_QUALITY', 'MISSING_GUARD_CLEARANCE'
];

export const ACTIVE_SAFETY_FUSION_RULE_SET: SafetyFusionRuleSetRegistryEntry = Object.freeze({
  schemaVersion: SAFETY_FUSION_REGISTRY_SCHEMA_VERSION,
  ruleSetVersion: SAFETY_FUSION_RULE_SET_VERSION,
  thresholdVersion: SAFETY_FUSION_THRESHOLD_VERSION,
  status: 'ACTIVE',
  approvedBy: 'ros-safety-governance',
  approvedAt: '2026-07-30T00:00:00.000Z',
  regressionEvidenceDigest: 'sha256:91a86e13ed014be0803b749f39c947a96ddbd034c4292d3800a259ebfbc8891b',
  rollbackRuleSetVersion: SAFETY_FUSION_SAFE_DEFAULT_RULE_SET_VERSION,
  protectedAttributePolicy: 'PROHIBITED',
  notes: 'Deterministic baseline. Recommendation only; human authority is mandatory for S3/S4 downgrade, resolution, diagnosis and dispatch.'
});

export class StaticSafetyFusionRegistry implements SafetyFusionRegistryPort {
  constructor(private readonly entries: readonly SafetyFusionRuleSetRegistryEntry[] = [ACTIVE_SAFETY_FUSION_RULE_SET]) {}
  async findRuleSet(ruleSetVersion: string): Promise<SafetyFusionRuleSetRegistryEntry | null> {
    return this.entries.find((entry) => entry.ruleSetVersion === ruleSetVersion) ?? null;
  }
}

export class SystemSafetyFusionClock implements SafetyFusionClockPort {
  async now(): Promise<string> { return new Date().toISOString(); }
}

export class NodeSafetyFusionFingerprint implements SafetyFusionFingerprintPort {
  async digest(material: string): Promise<string> {
    return `sha256:${createHash('sha256').update(material).digest('hex')}`;
  }
}

export class SafetyFusionService {
  constructor(
    private readonly registry: SafetyFusionRegistryPort,
    private readonly guards: readonly SafetyFusionGuardPort[],
    private readonly clock: SafetyFusionClockPort,
    private readonly fingerprint: SafetyFusionFingerprintPort
  ) {}

  async recommend(input: SafetyFusionInput): Promise<SafetyFusionRecommendation> {
    const evaluatedAt = await safeClock(this.clock);
    if (!validInput(input) || evaluatedAt === null) {
      return blockedRecommendation(input, evaluatedAt ?? '1970-01-01T00:00:00.000Z', [], this.fingerprint);
    }

    const registryEntry = await this.registry.findRuleSet(input.requestedRuleSetVersion).catch(() => null);
    if (!validRegistryEntry(registryEntry, input)) {
      return blockedRecommendation(input, evaluatedAt, [blockedGuard('DATA_QUALITY', input.inputVersion, 'registry_entry_invalid')], this.fingerprint);
    }

    const guardResults: SafetyFusionGuardResult[] = [];
    for (const guard of [...this.guards].sort((a, b) => a.kind.localeCompare(b.kind))) {
      try {
        const result = await guard.evaluate(input, evaluatedAt);
        guardResults.push(validGuardResult(result, guard.kind, input.inputVersion)
          ? result
          : blockedGuard(guard.kind, input.inputVersion, 'guard_contract_invalid'));
      } catch {
        guardResults.push(blockedGuard(guard.kind, input.inputVersion, 'guard_unavailable'));
      }
    }

    return evaluateSafetyFusion(input, evaluatedAt, guardResults, registryEntry, this.fingerprint);
  }
}

export async function evaluateSafetyFusion(
  input: SafetyFusionInput,
  evaluatedAt: string,
  guardResults: readonly SafetyFusionGuardResult[],
  registryEntry: SafetyFusionRuleSetRegistryEntry,
  fingerprint: SafetyFusionFingerprintPort
): Promise<SafetyFusionRecommendation> {
  if (!validInput(input) || !validTime(evaluatedAt) || !validRegistryEntry(registryEntry, input)) {
    return blockedRecommendation(input, validTime(evaluatedAt) ? evaluatedAt : '1970-01-01T00:00:00.000Z', guardResults, fingerprint);
  }

  const reasons = new Set<SafetyFusionReasonCode>();
  const missing = new Set<SafetyFusionMissingEvidenceFlag>();
  const evaluatedMs = Date.parse(evaluatedAt);
  const evidence = [...input.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const contributions = evidence.map((item) => contribution(item, evaluatedMs));
  const riskContributions = contributions.filter((item) => item.signedContribution > 0);
  const safetyContributions = contributions.filter((item) => item.signedContribution < 0);
  const recentTrusted = evidence.filter((item) => isRecentTrusted(item, evaluatedMs));
  const recentRiskSources = new Set(evidence.filter((item) => isRecentTrusted(item, evaluatedMs) && item.direction === 'SUPPORTS_RISK').map((item) => item.sourceType));
  const riskGroups = new Set(evidence.filter((item) => item.direction === 'SUPPORTS_RISK').map((item) => item.corroborationGroup));
  const contradictory = hasContradiction(evidence);
  const allStale = evidence.length > 0 && evidence.every((item) => evidenceAge(item, evaluatedMs) > SAFETY_FUSION_FRESH_EVIDENCE_MS);
  const degradedDevice = evidence.some((item) => item.deviceCondition !== 'HEALTHY');
  const unverified = evidence.some((item) => item.integrity !== 'VERIFIED');
  const guardBlocked = guardResults.some((item) => item.disposition === 'BLOCK_AND_REVIEW');
  const guardDegraded = guardResults.some((item) => item.disposition === 'DEGRADED');

  let score = sum(riskContributions.map((item) => item.signedContribution));
  const safetyOffset = Math.min(1.25, Math.abs(sum(safetyContributions.map((item) => item.signedContribution))));

  for (const item of evidence) addEvidenceReason(item, reasons);

  if (recentRiskSources.size >= 2 && riskGroups.size >= 1) {
    score += 0.75;
    reasons.add('FUSION_CORROBORATED');
  }

  const contactBoost = contactRiskBoost(input.contactState);
  score += contactBoost;
  if (contactBoost > 0) reasons.add(input.contactState === 'NO_RESPONSE' || input.contactState === 'UNREACHABLE' ? 'FUSION_NO_RESPONSE' : 'FUSION_CHANNEL_UNAVAILABLE');

  if (contradictory) {
    score += 0.5;
    reasons.add('FUSION_CONTRADICTORY_INPUTS');
  } else if (!guardBlocked && !allStale && recentTrusted.length >= 2 && contactBoost === 0) {
    score = Math.max(0, score - safetyOffset);
  }

  if (recentTrusted.length < 2) {
    reasons.add('FUSION_SPARSE_EVIDENCE');
    missing.add('MISSING_RECENT_TRUSTED_SOURCE');
  }
  if (riskContributions.length > 0 && recentRiskSources.size < 2) missing.add('MISSING_CORROBORATION');
  if (allStale || evidence.some((item) => evidenceAge(item, evaluatedMs) > SAFETY_FUSION_MAX_EVIDENCE_AGE_MS)) reasons.add('FUSION_STALE_EVIDENCE');
  if (degradedDevice) {
    reasons.add('FUSION_DEGRADED_DEVICE');
    missing.add('MISSING_DEVICE_HEALTH');
  }
  if (unverified) reasons.add('FUSION_UNVERIFIED_SOURCE');
  if (input.contactState === 'NOT_STARTED' || ['CREATED', 'CONSENT_PENDING', 'LANGUAGE_SELECTION', 'CONTACTING', 'AWAITING_RESPONSE', 'PARTIAL_RESPONSE'].includes(input.contactState)) missing.add('MISSING_CONTACT_OUTCOME');
  if (evidence.length === 0 || evidence.every((item) => item.locationQuality === 'UNKNOWN')) missing.add('MISSING_LOCATION_QUALITY');
  if (guardDegraded) reasons.add('FUSION_GUARD_DEGRADED');
  if (guardBlocked) reasons.add('FUSION_GUARD_BLOCKED');
  if (guardDegraded || guardBlocked || guardResults.length === 0) missing.add('MISSING_GUARD_CLEARANCE');

  let uncertainty = 0.05;
  if (contradictory) uncertainty += 0.3;
  if (recentTrusted.length < 2) uncertainty += 0.25;
  if (allStale) uncertainty += 0.2;
  if (degradedDevice) uncertainty += 0.1;
  if (unverified) uncertainty += 0.15;
  if (guardDegraded) uncertainty += 0.2;
  if (guardBlocked) uncertainty += 0.5;
  if (input.contactState === 'NO_RESPONSE' || input.contactState === 'UNREACHABLE' || input.contactState === 'DISCONNECTED') uncertainty += 0.15;
  uncertainty = clamp01(uncertainty + Math.min(0.2, missing.size * 0.03));

  if (uncertainty >= 0.35) reasons.add('FUSION_HIGH_UNCERTAINTY');
  if (guardBlocked) score = Math.max(score, 3);

  const rawSeverity = severityFromScore(round(score));
  const recommendedSeverity = maxSeverity(rawSeverity, input.currentSeverity);
  if (SEVERITY_RANK[rawSeverity] < SEVERITY_RANK[input.currentSeverity]) reasons.add('FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED');

  const weightedQuality = contributions.length === 0 ? 0 : contributions.reduce((total, item) => total + item.freshnessFactor * item.reliabilityFactor * item.integrityFactor * item.deviceConditionFactor, 0) / contributions.length;
  const confidence = round(clamp01(weightedQuality * (1 - uncertainty * 0.65)));
  const requiresHumanReview = SEVERITY_RANK[recommendedSeverity] >= SEVERITY_RANK.S3
    || uncertainty >= 0.3
    || contradictory
    || allStale
    || recentTrusted.length < 2
    || guardResults.some((item) => item.disposition !== 'CLEAR');
  if (requiresHumanReview) reasons.add('FUSION_HUMAN_AUTHORITY_REQUIRED');

  const orderedReasons = REASON_ORDER.filter((reason) => reasons.has(reason));
  const orderedMissing = MISSING_ORDER.filter((flag) => missing.has(flag));
  const orderedGuards = [...guardResults].sort((a, b) => a.kind.localeCompare(b.kind) || a.guardVersion.localeCompare(b.guardVersion));
  const material = stableStringify({
    input,
    evaluatedAt,
    recommendedSeverity,
    score: round(score),
    confidence,
    uncertainty: round(uncertainty),
    reasonCodes: orderedReasons,
    missingEvidenceFlags: orderedMissing,
    contributions,
    guardResults: orderedGuards,
    policyVersion: SAFETY_FUSION_POLICY_VERSION,
    ruleSetVersion: registryEntry.ruleSetVersion,
    thresholdVersion: registryEntry.thresholdVersion
  });

  return Object.freeze({
    tenantId: input.tenantId,
    caseId: input.caseId,
    inputVersion: input.inputVersion,
    evaluatedAt,
    recommendedSeverity,
    currentSeverity: input.currentSeverity,
    score: round(score),
    confidence,
    uncertainty: round(uncertainty),
    reasonCodes: Object.freeze(orderedReasons),
    missingEvidenceFlags: Object.freeze(orderedMissing),
    contributions: Object.freeze(contributions),
    guardResults: Object.freeze(orderedGuards),
    requiresHumanReview,
    authority: 'RECOMMENDATION_ONLY',
    autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false,
    autonomousDispatchPermitted: false,
    policyVersion: SAFETY_FUSION_POLICY_VERSION,
    ruleSetVersion: registryEntry.ruleSetVersion,
    thresholdVersion: registryEntry.thresholdVersion,
    deterministicFingerprint: await fingerprint.digest(material)
  });
}

export class DeterministicDataQualityGuard implements SafetyFusionGuardPort {
  readonly kind = 'DATA_QUALITY' as const;
  readonly version = 'ros-eye.safety-fusion.guard.data-quality.v1';
  async evaluate(input: SafetyFusionInput, evaluatedAt: string): Promise<SafetyFusionGuardResult> {
    if (!validInput(input) || !validTime(evaluatedAt)) return guard(this.kind, 'BLOCK_AND_REVIEW', 'invalid_input_contract', this.version, input.inputVersion);
    const invalidCount = input.evidence.filter((item) => item.integrity === 'INVALID').length;
    const staleCount = input.evidence.filter((item) => evidenceAge(item, Date.parse(evaluatedAt)) > SAFETY_FUSION_MAX_EVIDENCE_AGE_MS).length;
    if (invalidCount > 0) return guard(this.kind, 'BLOCK_AND_REVIEW', 'invalid_source_integrity', this.version, input.inputVersion);
    if (input.evidence.length === 0 || staleCount > input.evidence.length / 2) return guard(this.kind, 'DEGRADED', 'sparse_or_stale_evidence', this.version, input.inputVersion);
    return guard(this.kind, 'CLEAR', 'data_quality_clear', this.version, input.inputVersion);
  }
}

export class DeterministicDriftGuard implements SafetyFusionGuardPort {
  readonly kind = 'DRIFT' as const;
  readonly version = 'ros-eye.safety-fusion.guard.drift.v1';
  async evaluate(input: SafetyFusionInput, _evaluatedAt: string): Promise<SafetyFusionGuardResult> {
    if (input.evidence.length < 4) return guard(this.kind, 'CLEAR', 'insufficient_volume_for_drift', this.version, input.inputVersion);
    const counts = new Map<SafetyFusionSourceType, number>();
    for (const item of input.evidence) counts.set(item.sourceType, (counts.get(item.sourceType) ?? 0) + 1);
    const largest = Math.max(...counts.values());
    return largest / input.evidence.length > 0.85
      ? guard(this.kind, 'DEGRADED', 'single_source_distribution_shift', this.version, input.inputVersion)
      : guard(this.kind, 'CLEAR', 'distribution_within_baseline', this.version, input.inputVersion);
  }
}

export class DeterministicOutOfDistributionGuard implements SafetyFusionGuardPort {
  readonly kind = 'OUT_OF_DISTRIBUTION' as const;
  readonly version = 'ros-eye.safety-fusion.guard.ood.v1';
  async evaluate(input: SafetyFusionInput, _evaluatedAt: string): Promise<SafetyFusionGuardResult> {
    const malformed = input.evidence.some((item) => !ALLOWED_EVIDENCE_CODES.has(item.code) || !SOURCE_TYPES.has(item.sourceType));
    return malformed
      ? guard(this.kind, 'BLOCK_AND_REVIEW', 'unknown_evidence_vocabulary', this.version, input.inputVersion)
      : guard(this.kind, 'CLEAR', 'input_within_declared_vocabulary', this.version, input.inputVersion);
  }
}

export class DeterministicAdversarialInputGuard implements SafetyFusionGuardPort {
  readonly kind = 'ADVERSARIAL_INPUT' as const;
  readonly version = 'ros-eye.safety-fusion.guard.adversarial.v1';
  async evaluate(input: SafetyFusionInput, _evaluatedAt: string): Promise<SafetyFusionGuardResult> {
    const byId = new Map<string, SafetyFusionEvidence>();
    for (const item of input.evidence) {
      const existing = byId.get(item.evidenceId);
      if (existing && stableStringify(existing) !== stableStringify(item)) return guard(this.kind, 'BLOCK_AND_REVIEW', 'conflicting_duplicate_evidence_id', this.version, input.inputVersion);
      byId.set(item.evidenceId, item);
    }
    const sourceCounts = new Map<string, number>();
    for (const item of input.evidence) sourceCounts.set(item.sourceRef, (sourceCounts.get(item.sourceRef) ?? 0) + 1);
    const repeated = [...sourceCounts.values()].some((count) => count > 16);
    return repeated
      ? guard(this.kind, 'DEGRADED', 'source_repetition_anomaly', this.version, input.inputVersion)
      : guard(this.kind, 'CLEAR', 'no_adversarial_pattern_detected', this.version, input.inputVersion);
  }
}

export const DEFAULT_SAFETY_FUSION_GUARDS: readonly SafetyFusionGuardPort[] = Object.freeze([
  new DeterministicDataQualityGuard(),
  new DeterministicDriftGuard(),
  new DeterministicOutOfDistributionGuard(),
  new DeterministicAdversarialInputGuard()
]);

export function validRegistryEntry(entry: SafetyFusionRuleSetRegistryEntry | null, input: SafetyFusionInput): entry is SafetyFusionRuleSetRegistryEntry {
  return entry !== null
    && entry.schemaVersion === SAFETY_FUSION_REGISTRY_SCHEMA_VERSION
    && entry.status === 'ACTIVE'
    && entry.ruleSetVersion === input.requestedRuleSetVersion
    && entry.thresholdVersion === input.requestedThresholdVersion
    && entry.thresholdVersion === SAFETY_FUSION_THRESHOLD_VERSION
    && validId(entry.approvedBy)
    && validTime(entry.approvedAt)
    && /^sha256:[a-f0-9]{64}$/.test(entry.regressionEvidenceDigest)
    && validId(entry.rollbackRuleSetVersion ?? '')
    && entry.rollbackRuleSetVersion !== entry.ruleSetVersion
    && entry.protectedAttributePolicy === 'PROHIBITED';
}

function validInput(input: SafetyFusionInput): boolean {
  if (!validId(input.tenantId) || !validId(input.caseId) || !Number.isInteger(input.inputVersion) || input.inputVersion < 1) return false;
  if (!(input.currentSeverity in SEVERITY_RANK) || !validId(input.requestedRuleSetVersion) || !validId(input.requestedThresholdVersion)) return false;
  if (!Array.isArray(input.evidence) || input.evidence.length > SAFETY_FUSION_MAX_INPUTS) return false;
  return input.evidence.every(validEvidence);
}

function validEvidence(item: SafetyFusionEvidence): boolean {
  return validId(item.evidenceId)
    && validId(item.sourceRef)
    && SOURCE_TYPES.has(item.sourceType)
    && ALLOWED_EVIDENCE_CODES.has(item.code)
    && ['SUPPORTS_RISK', 'SUPPORTS_SAFETY', 'CONTEXT_ONLY'].includes(item.direction)
    && validTime(item.observedAt)
    && validTime(item.receivedAt)
    && finiteUnit(item.reliability)
    && INTEGRITY_VALUES.has(item.integrity)
    && DEVICE_CONDITIONS.has(item.deviceCondition)
    && validId(item.corroborationGroup)
    && ['PRECISE', 'APPROXIMATE', 'UNKNOWN'].includes(item.locationQuality);
}

function validGuardResult(result: SafetyFusionGuardResult, kind: SafetyFusionGuardKind, inputVersion: number): boolean {
  return result.kind === kind
    && GUARD_KINDS.has(result.kind)
    && ['CLEAR', 'DEGRADED', 'BLOCK_AND_REVIEW'].includes(result.disposition)
    && validId(result.reasonCode)
    && validId(result.guardVersion)
    && result.evaluatedInputVersion === inputVersion;
}

async function blockedRecommendation(
  input: SafetyFusionInput,
  evaluatedAt: string,
  guardResults: readonly SafetyFusionGuardResult[],
  fingerprint: SafetyFusionFingerprintPort
): Promise<SafetyFusionRecommendation> {
  const current = input.currentSeverity in SEVERITY_RANK ? input.currentSeverity : 'S4';
  const recommendedSeverity = maxSeverity(current, 'S3');
  const reasons: readonly SafetyFusionReasonCode[] = ['FUSION_GUARD_BLOCKED', 'FUSION_HIGH_UNCERTAINTY', 'FUSION_HUMAN_AUTHORITY_REQUIRED'];
  const missing: readonly SafetyFusionMissingEvidenceFlag[] = ['MISSING_GUARD_CLEARANCE'];
  const material = stableStringify({ input, evaluatedAt, recommendedSeverity, reasons, missing, guardResults });
  return Object.freeze({
    tenantId: validId(input.tenantId) ? input.tenantId : 'invalid-tenant',
    caseId: validId(input.caseId) ? input.caseId : 'invalid-case',
    inputVersion: Number.isInteger(input.inputVersion) ? input.inputVersion : 0,
    evaluatedAt,
    recommendedSeverity,
    currentSeverity: current,
    score: 3,
    confidence: 0,
    uncertainty: 1,
    reasonCodes: reasons,
    missingEvidenceFlags: missing,
    contributions: Object.freeze([]),
    guardResults: Object.freeze([...guardResults]),
    requiresHumanReview: true,
    authority: 'RECOMMENDATION_ONLY',
    autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false,
    autonomousDispatchPermitted: false,
    policyVersion: SAFETY_FUSION_POLICY_VERSION,
    ruleSetVersion: validId(input.requestedRuleSetVersion) ? input.requestedRuleSetVersion : SAFETY_FUSION_SAFE_DEFAULT_RULE_SET_VERSION,
    thresholdVersion: validId(input.requestedThresholdVersion) ? input.requestedThresholdVersion : SAFETY_FUSION_THRESHOLD_VERSION,
    deterministicFingerprint: await fingerprint.digest(material)
  });
}

function contribution(item: SafetyFusionEvidence, evaluatedMs: number): SafetyFusionSourceContribution {
  const freshnessFactor = freshness(item, evaluatedMs);
  const reliabilityFactor = round(item.reliability);
  const integrityFactor = item.integrity === 'VERIFIED' ? 1 : item.integrity === 'UNVERIFIED' ? 0.55 : 0;
  const deviceConditionFactor = item.deviceCondition === 'HEALTHY' ? 1 : item.deviceCondition === 'DEGRADED' ? 0.7 : 0.5;
  const direction = item.direction === 'SUPPORTS_RISK' ? 1 : item.direction === 'SUPPORTS_SAFETY' ? -1 : 0;
  let signedContribution = BASE_WEIGHT[item.code] * freshnessFactor * reliabilityFactor * integrityFactor * deviceConditionFactor * direction;
  if (signedContribution < 0) signedContribution = Math.max(-1.25, signedContribution);
  return Object.freeze({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    code: item.code,
    signedContribution: round(signedContribution),
    freshnessFactor: round(freshnessFactor),
    reliabilityFactor,
    integrityFactor,
    deviceConditionFactor
  });
}

function addEvidenceReason(item: SafetyFusionEvidence, reasons: Set<SafetyFusionReasonCode>): void {
  if (item.code === 'POSSIBLE_IMMEDIATE_DANGER' || item.code === 'PERSON_NOT_RESPONDING') reasons.add('FUSION_HIGH_RISK_INDICATOR');
  if (item.code === 'HELP_REQUESTED') reasons.add('FUSION_HELP_REQUESTED');
  if (item.code === 'DEVICE_IMPACT') reasons.add('FUSION_DEVICE_IMPACT');
  if (item.code === 'DEVICE_AIRBAG') reasons.add('FUSION_DEVICE_AIRBAG');
  if (item.code === 'DEVICE_ROLLOVER') reasons.add('FUSION_DEVICE_ROLLOVER');
  if (item.code === 'CHANNEL_UNAVAILABLE' || item.code === 'COMMUNICATION_INTERRUPTED') reasons.add('FUSION_CHANNEL_UNAVAILABLE');
  if (item.code === 'CONTRADICTORY_RESPONSE' || item.code === 'SOURCE_CONFLICT') reasons.add('FUSION_CONTRADICTORY_INPUTS');
}

function hasContradiction(evidence: readonly SafetyFusionEvidence[]): boolean {
  if (evidence.some((item) => item.code === 'CONTRADICTORY_RESPONSE' || item.code === 'SOURCE_CONFLICT')) return true;
  const codes = new Set(evidence.map((item) => item.code));
  if (codes.has('PERSON_RESPONDED') && codes.has('PERSON_NOT_RESPONDING')) return true;
  if (codes.has('CHANNEL_HEALTHY') && codes.has('CHANNEL_UNAVAILABLE')) return true;
  const groups = new Map<string, Set<string>>();
  for (const item of evidence) {
    const values = groups.get(item.corroborationGroup) ?? new Set<string>();
    values.add(item.direction);
    groups.set(item.corroborationGroup, values);
  }
  return [...groups.values()].some((values) => values.has('SUPPORTS_RISK') && values.has('SUPPORTS_SAFETY'));
}

function contactRiskBoost(state: SafetyFusionInput['contactState']): number {
  if (state === 'NO_RESPONSE' || state === 'UNREACHABLE') return 2;
  if (state === 'DISCONNECTED') return 1.5;
  if (state === 'HUMAN_REVIEW' || state === 'ESCALATED' || state === 'OPERATOR_TAKEOVER') return 0.5;
  return 0;
}

function severityFromScore(score: number): SafetyFusionSeverity {
  if (score >= 5.5) return 'S4';
  if (score >= 3) return 'S3';
  if (score >= 1.5) return 'S2';
  if (score >= 0.5) return 'S1';
  return 'S0';
}

export function safetyFusionSeverityRank(severity: SafetyFusionSeverity): number { return SEVERITY_RANK[severity]; }

function maxSeverity(a: SafetyFusionSeverity, b: SafetyFusionSeverity): SafetyFusionSeverity {
  return SEVERITY_BY_RANK[Math.max(SEVERITY_RANK[a], SEVERITY_RANK[b])] ?? 'S4';
}

function isRecentTrusted(item: SafetyFusionEvidence, evaluatedMs: number): boolean {
  return item.integrity === 'VERIFIED'
    && item.reliability >= 0.7
    && item.deviceCondition !== 'UNKNOWN'
    && evidenceAge(item, evaluatedMs) <= SAFETY_FUSION_FRESH_EVIDENCE_MS;
}

function evidenceAge(item: SafetyFusionEvidence, evaluatedMs: number): number {
  return Math.max(0, evaluatedMs - Date.parse(item.observedAt));
}

function freshness(item: SafetyFusionEvidence, evaluatedMs: number): number {
  const age = evidenceAge(item, evaluatedMs);
  if (Date.parse(item.observedAt) > evaluatedMs + 5 * 60 * 1000) return 0;
  if (age <= SAFETY_FUSION_FRESH_EVIDENCE_MS) return 1;
  if (age <= SAFETY_FUSION_MAX_EVIDENCE_AGE_MS) return 0.55;
  return 0.15;
}

function guard(kind: SafetyFusionGuardKind, disposition: SafetyFusionGuardDisposition, reasonCode: string, guardVersion: string, evaluatedInputVersion: number): SafetyFusionGuardResult {
  return Object.freeze({ kind, disposition, reasonCode, guardVersion, evaluatedInputVersion });
}

function blockedGuard(kind: SafetyFusionGuardKind, inputVersion: number, reasonCode: string): SafetyFusionGuardResult {
  return guard(kind, 'BLOCK_AND_REVIEW', reasonCode, 'ros-eye.safety-fusion.guard.unavailable.v1', inputVersion);
}

async function safeClock(clock: SafetyFusionClockPort): Promise<string | null> {
  try {
    const value = await clock.now();
    return validTime(value) ? value : null;
  } catch { return null; }
}

function validId(value: string): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(value); }
function validTime(value: string): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function finiteUnit(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }
function round(value: number): number { return Math.round(value * 10000) / 10000; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
