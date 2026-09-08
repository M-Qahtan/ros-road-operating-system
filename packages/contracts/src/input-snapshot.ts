import type { SafetyFusionRecommendation } from './safety-fusion.js';

export const SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION = 'ros-eye.input-snapshot.v1' as const;

export interface AuthoritativeRevisionBinding {
  readonly revision: number;
  readonly digest: string;
}

export interface SafetyFusionInputSnapshot {
  readonly policyVersion: typeof SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION;
  readonly tenantId: string;
  readonly caseId: string;
  readonly inputVersion: number;
  readonly capturedAt: string;
  readonly case: AuthoritativeRevisionBinding;
  readonly severity: AuthoritativeRevisionBinding;
  readonly contact: AuthoritativeRevisionBinding | null;
  readonly evidence: AuthoritativeRevisionBinding;
  readonly indicators: AuthoritativeRevisionBinding;
  /** Digest issued by the future authoritative snapshot writer over its canonical snapshot. */
  readonly snapshotDigest: string;
}

export interface RecommendationSnapshotBinding {
  readonly policyVersion: typeof SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION;
  readonly inputVersion: number;
  readonly recommendationFingerprint: string;
  readonly sourceSnapshotDigest: string;
  readonly boundAt: string;
}

export interface CurrentInputRevisions {
  readonly tenantId: string;
  readonly caseId: string;
  readonly case: AuthoritativeRevisionBinding;
  readonly severity: AuthoritativeRevisionBinding;
  readonly contact: AuthoritativeRevisionBinding | null;
  readonly evidence: AuthoritativeRevisionBinding;
  readonly indicators: AuthoritativeRevisionBinding;
}

export type SnapshotBindingReason =
  | 'VERIFIED'
  | 'MISSING_BINDING'
  | 'INVALID_BINDING'
  | 'SCOPE_MISMATCH'
  | 'SOURCE_MISMATCH'
  | 'CURRENT_INPUT_CHANGED';

export interface SnapshotBindingAssessment {
  readonly status: 'VERIFIED' | 'UNVERIFIED' | 'INVALIDATED';
  readonly reason: SnapshotBindingReason;
  readonly sourceSnapshotDigest: string | null;
}

/**
 * Verifies an issued snapshot receipt against a recommendation and current
 * authoritative revisions. It does not issue revisions or digests; those stay
 * owned by their source modules and the durable snapshot writer.
 */
export function assessRecommendationSnapshotBinding(
  recommendation: SafetyFusionRecommendation | null,
  snapshot: SafetyFusionInputSnapshot | null,
  binding: RecommendationSnapshotBinding | null,
  current: CurrentInputRevisions | null
): SnapshotBindingAssessment {
  if (snapshot === null || binding === null || current === null) return assessment('UNVERIFIED', 'MISSING_BINDING', null);
  if (!validRecommendationIdentity(recommendation) || !validSnapshot(snapshot) || !validBinding(binding) || !validCurrent(current)) {
    return assessment('UNVERIFIED', 'INVALID_BINDING', null);
  }
  if (recommendation.tenantId !== snapshot.tenantId || recommendation.caseId !== snapshot.caseId ||
      current.tenantId !== snapshot.tenantId || current.caseId !== snapshot.caseId) {
    return assessment('INVALIDATED', 'SCOPE_MISMATCH', null);
  }
  if (recommendation.inputVersion !== snapshot.inputVersion || binding.inputVersion !== snapshot.inputVersion ||
      binding.recommendationFingerprint !== recommendation.deterministicFingerprint ||
      binding.sourceSnapshotDigest !== snapshot.snapshotDigest ||
      Date.parse(snapshot.capturedAt) > Date.parse(recommendation.evaluatedAt) ||
      Date.parse(recommendation.evaluatedAt) > Date.parse(binding.boundAt)) {
    return assessment('INVALIDATED', 'SOURCE_MISMATCH', snapshot.snapshotDigest);
  }
  if (!same(snapshot.case, current.case) || !same(snapshot.severity, current.severity) ||
      !sameNullable(snapshot.contact, current.contact) || !same(snapshot.evidence, current.evidence) ||
      !same(snapshot.indicators, current.indicators)) {
    return assessment('INVALIDATED', 'CURRENT_INPUT_CHANGED', snapshot.snapshotDigest);
  }
  return assessment('VERIFIED', 'VERIFIED', snapshot.snapshotDigest);
}

function assessment(status: SnapshotBindingAssessment['status'], reason: SnapshotBindingReason, digest: string | null): SnapshotBindingAssessment {
  return Object.freeze({ status, reason, sourceSnapshotDigest: digest });
}

function same(left: AuthoritativeRevisionBinding, right: AuthoritativeRevisionBinding): boolean {
  return left.revision === right.revision && left.digest === right.digest;
}

function sameNullable(left: AuthoritativeRevisionBinding | null, right: AuthoritativeRevisionBinding | null): boolean {
  return left === null || right === null ? left === right : same(left, right);
}

function validSnapshot(value: SafetyFusionInputSnapshot): boolean {
  return value.policyVersion === SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION && validScope(value.tenantId) && validScope(value.caseId) &&
    positive(value.inputVersion) && validTimestamp(value.capturedAt) && validRevision(value.case) && validRevision(value.severity) &&
    (value.contact === null || validRevision(value.contact)) && validRevision(value.evidence) && validRevision(value.indicators) &&
    validDigest(value.snapshotDigest);
}

function validBinding(value: RecommendationSnapshotBinding): boolean {
  return value.policyVersion === SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION && positive(value.inputVersion) &&
    validDigest(value.recommendationFingerprint) && validDigest(value.sourceSnapshotDigest) && validTimestamp(value.boundAt);
}

function validCurrent(value: CurrentInputRevisions): boolean {
  return validScope(value.tenantId) && validScope(value.caseId) && validRevision(value.case) && validRevision(value.severity) &&
    (value.contact === null || validRevision(value.contact)) && validRevision(value.evidence) && validRevision(value.indicators);
}

function validRecommendationIdentity(value: SafetyFusionRecommendation | null): value is SafetyFusionRecommendation {
  return typeof value === 'object' && value !== null && validScope(value.tenantId) && validScope(value.caseId) &&
    positive(value.inputVersion) && validTimestamp(value.evaluatedAt) && validDigest(value.deterministicFingerprint);
}

function validRevision(value: AuthoritativeRevisionBinding): boolean {
  return typeof value === 'object' && value !== null && positive(value.revision) && validDigest(value.digest);
}

function validDigest(value: string): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validScope(value: string): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function validTimestamp(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
