import type { HumanContactState } from './human-contact-protocol.js';
import type { SafetyIndicatorCode } from './human-safety.js';

export const SAFETY_FUSION_POLICY_VERSION = 'ros-eye.safety-fusion.v1' as const;
export const SAFETY_FUSION_THRESHOLD_VERSION = 'ros-eye.safety-fusion.thresholds.v1' as const;
export const SAFETY_FUSION_REGISTRY_SCHEMA_VERSION = 'ros-eye.safety-fusion.registry.v1' as const;
export const SAFETY_FUSION_MAX_EVIDENCE_AGE_MS = 30 * 60 * 1000;
export const SAFETY_FUSION_FRESH_EVIDENCE_MS = 5 * 60 * 1000;

export type SafetyFusionSeverity = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
export type SafetyFusionSourceType = 'PHONE' | 'VEHICLE' | 'PERSON' | 'OPERATOR' | 'INFRASTRUCTURE' | 'CONTACT_RUNTIME' | 'SIMULATION';
export type SafetyFusionIntegrity = 'VERIFIED' | 'UNVERIFIED' | 'INVALID';
export type SafetyFusionDeviceCondition = 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
export type SafetyFusionDirection = 'SUPPORTS_RISK' | 'SUPPORTS_SAFETY' | 'CONTEXT_ONLY';
export type SafetyFusionGuardKind = 'DATA_QUALITY' | 'DRIFT' | 'OUT_OF_DISTRIBUTION' | 'ADVERSARIAL_INPUT';
export type SafetyFusionGuardDisposition = 'CLEAR' | 'DEGRADED' | 'BLOCK_AND_REVIEW';
export type SafetyFusionAuthority = 'RECOMMENDATION_ONLY';

export type SafetyFusionEvidenceCode =
  | SafetyIndicatorCode
  | 'DEVICE_IMPACT'
  | 'DEVICE_AIRBAG'
  | 'DEVICE_ROLLOVER'
  | 'DEVICE_HARD_BRAKE'
  | 'CHANNEL_HEALTHY'
  | 'CHANNEL_UNAVAILABLE'
  | 'SOURCE_CLOCK_SKEW'
  | 'SOURCE_INTEGRITY_FAILURE'
  | 'SOURCE_CONFLICT';

export type SafetyFusionReasonCode =
  | 'FUSION_HIGH_RISK_INDICATOR'
  | 'FUSION_DEVICE_IMPACT'
  | 'FUSION_DEVICE_AIRBAG'
  | 'FUSION_DEVICE_ROLLOVER'
  | 'FUSION_HELP_REQUESTED'
  | 'FUSION_NO_RESPONSE'
  | 'FUSION_CHANNEL_UNAVAILABLE'
  | 'FUSION_CORROBORATED'
  | 'FUSION_CONTRADICTORY_INPUTS'
  | 'FUSION_SPARSE_EVIDENCE'
  | 'FUSION_STALE_EVIDENCE'
  | 'FUSION_DEGRADED_DEVICE'
  | 'FUSION_UNVERIFIED_SOURCE'
  | 'FUSION_GUARD_DEGRADED'
  | 'FUSION_GUARD_BLOCKED'
  | 'FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED'
  | 'FUSION_HIGH_UNCERTAINTY'
  | 'FUSION_HUMAN_AUTHORITY_REQUIRED';

export type SafetyFusionMissingEvidenceFlag =
  | 'MISSING_RECENT_TRUSTED_SOURCE'
  | 'MISSING_CORROBORATION'
  | 'MISSING_CONTACT_OUTCOME'
  | 'MISSING_DEVICE_HEALTH'
  | 'MISSING_LOCATION_QUALITY'
  | 'MISSING_GUARD_CLEARANCE';

export interface SafetyFusionEvidence {
  readonly evidenceId: string;
  readonly sourceRef: string;
  readonly sourceType: SafetyFusionSourceType;
  readonly code: SafetyFusionEvidenceCode;
  readonly direction: SafetyFusionDirection;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly reliability: number;
  readonly integrity: SafetyFusionIntegrity;
  readonly deviceCondition: SafetyFusionDeviceCondition;
  readonly corroborationGroup: string;
  readonly locationQuality: 'PRECISE' | 'APPROXIMATE' | 'UNKNOWN';
}

export interface SafetyFusionInput {
  readonly tenantId: string;
  readonly caseId: string;
  readonly inputVersion: number;
  readonly currentSeverity: SafetyFusionSeverity;
  readonly contactState: HumanContactState | 'NOT_STARTED';
  readonly contactLastInteractionAt: string | null;
  readonly evidence: readonly SafetyFusionEvidence[];
  readonly requestedRuleSetVersion: string;
  readonly requestedThresholdVersion: string;
}

export interface SafetyFusionGuardResult {
  readonly kind: SafetyFusionGuardKind;
  readonly disposition: SafetyFusionGuardDisposition;
  readonly reasonCode: string;
  readonly guardVersion: string;
  readonly evaluatedInputVersion: number;
}

export interface SafetyFusionSourceContribution {
  readonly evidenceId: string;
  readonly sourceType: SafetyFusionSourceType;
  readonly code: SafetyFusionEvidenceCode;
  readonly signedContribution: number;
  readonly freshnessFactor: number;
  readonly reliabilityFactor: number;
  readonly integrityFactor: number;
  readonly deviceConditionFactor: number;
}

export interface SafetyFusionRecommendation {
  readonly tenantId: string;
  readonly caseId: string;
  readonly inputVersion: number;
  readonly evaluatedAt: string;
  readonly recommendedSeverity: SafetyFusionSeverity;
  readonly currentSeverity: SafetyFusionSeverity;
  readonly score: number;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly reasonCodes: readonly SafetyFusionReasonCode[];
  readonly missingEvidenceFlags: readonly SafetyFusionMissingEvidenceFlag[];
  readonly contributions: readonly SafetyFusionSourceContribution[];
  readonly guardResults: readonly SafetyFusionGuardResult[];
  readonly requiresHumanReview: boolean;
  readonly authority: SafetyFusionAuthority;
  readonly autonomousDowngradePermitted: false;
  readonly autonomousClosurePermitted: false;
  readonly autonomousDispatchPermitted: false;
  readonly policyVersion: typeof SAFETY_FUSION_POLICY_VERSION;
  readonly ruleSetVersion: string;
  readonly thresholdVersion: string;
  readonly deterministicFingerprint: string;
}

export interface SafetyFusionRuleSetRegistryEntry {
  readonly schemaVersion: typeof SAFETY_FUSION_REGISTRY_SCHEMA_VERSION;
  readonly ruleSetVersion: string;
  readonly thresholdVersion: string;
  readonly status: 'CANDIDATE' | 'ACTIVE' | 'RETIRED';
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly regressionEvidenceDigest: string;
  readonly rollbackRuleSetVersion: string | null;
  readonly protectedAttributePolicy: 'PROHIBITED';
  readonly notes: string;
}

export interface SafetyFusionRegistryPort {
  findRuleSet(ruleSetVersion: string): Promise<SafetyFusionRuleSetRegistryEntry | null>;
}

export interface SafetyFusionGuardPort {
  readonly kind: SafetyFusionGuardKind;
  evaluate(input: SafetyFusionInput, evaluatedAt: string): Promise<SafetyFusionGuardResult>;
}

export interface SafetyFusionClockPort { now(): Promise<string> }
export interface SafetyFusionFingerprintPort { digest(material: string): Promise<string> }

export interface SafetyFusionEvaluationFixture {
  readonly fixtureId: string;
  readonly input: SafetyFusionInput;
  readonly evaluatedAt: string;
  readonly guardResults: readonly SafetyFusionGuardResult[];
  readonly expectedMinimumSeverity: SafetyFusionSeverity;
  readonly expectedHumanReview: boolean;
  readonly safetyWeight: number;
}

export interface SafetyFusionEvaluationMetrics {
  readonly fixtureCount: number;
  readonly weightedFalseNegativeScore: number;
  readonly underTriageCount: number;
  readonly missedHumanReviewCount: number;
  readonly deterministicMismatchCount: number;
  readonly passed: boolean;
}
