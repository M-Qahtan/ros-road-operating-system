import type { HumanContactSessionContract } from './human-contact-protocol.js';
import type { HumanSafetyCaseContract } from './human-safety.js';
import { SAFETY_FUSION_POLICY_VERSION, SAFETY_FUSION_THRESHOLD_VERSION, type SafetyFusionRecommendation } from './safety-fusion.js';

export const NEXT_EVIDENCE_POLICY_VERSION = 'ros-eye.next-evidence.v1' as const;
export const NEXT_EVIDENCE_LIFETIME_MS = 5 * 60_000;

export type NextEvidenceSuggestion =
  | 'REVIEW_CONTACT_OUTCOME' | 'REVIEW_CONTRADICTORY_EVIDENCE'
  | 'REVIEW_RECENT_TRUSTED_SOURCE' | 'REVIEW_INDEPENDENT_CORROBORATION'
  | 'REVIEW_DEVICE_HEALTH' | 'REVIEW_LOCATION_QUALITY' | 'REVIEW_SOURCE_INTEGRITY';

export type NextEvidenceReason =
  | 'SOURCE_SNAPSHOT_UNVERIFIED' | 'NO_RECOMMENDATION' | 'INVALID_CONTEXT'
  | 'CASE_INACTIVE' | 'SCOPE_MISMATCH' | 'INVALID_RECOMMENDATION'
  | 'SOURCE_EXPIRED' | 'SOURCE_IN_FUTURE' | 'CONTEXT_CHANGED'
  | 'GUARD_REVIEW_REQUIRED' | 'EVIDENCE_QUARANTINED' | 'NO_TARGETED_GAP';

export interface NextEvidenceContext {
  readonly tenantId: string;
  readonly safetyCase: Pick<HumanSafetyCaseContract, 'id' | 'state' | 'severity' | 'version' | 'nextDeadlineAt'>;
  readonly contactSession: Pick<HumanContactSessionContract, 'caseId' | 'state' | 'version' | 'lastInteractionAt'> | null;
  readonly recommendation: SafetyFusionRecommendation | null;
  readonly evidenceState: 'TRUSTED' | 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING' | 'QUARANTINED';
  /** Known update times are rejection signals, never proof of an atomic snapshot. */
  readonly contextObservedAt: readonly string[];
}

export interface NextEvidenceAdvice {
  readonly policyVersion: typeof NEXT_EVIDENCE_POLICY_VERSION;
  readonly status: 'SUGGESTED' | 'ABSTAIN';
  readonly mode: 'SHADOW_ONLY';
  readonly authority: 'RECOMMENDATION_ONLY';
  readonly activationAuthorized: false;
  readonly collectionPermitted: false;
  readonly sourceSnapshotStatus: 'UNVERIFIED';
  readonly reviewPriority: 'URGENT' | 'STANDARD';
  readonly generatedAt: string | null;
  readonly sourceEvaluatedAt: string | null;
  readonly expiresAt: string | null;
  readonly sourceFingerprint: string | null;
  /** Opaque fusion input version; this is NOT a RoadEvent version. */
  readonly sourceInputVersion: number | null;
  readonly caseVersion: number;
  readonly contactVersion: number | null;
  readonly reasons: readonly NextEvidenceReason[];
  readonly suggestions: readonly NextEvidenceSuggestion[];
}

/** Pure, non-executable guidance. Never grants access to acquire new evidence. */
export function suggestNextEvidence(context: NextEvidenceContext, now: string): NextEvidenceAdvice {
  const nowMs = timestamp(now);
  const deadline = context.safetyCase.nextDeadlineAt;
  const urgent = context.safetyCase.state !== 'RESOLVED' && (
    !Number.isFinite(nowMs) || ['S3', 'S4'].includes(context.safetyCase.severity) ||
    ['NO_RESPONSE', 'UNREACHABLE', 'ESCALATED'].includes(context.safetyCase.state) ||
    ['NO_RESPONSE', 'UNREACHABLE', 'DISCONNECTED', 'ESCALATED'].includes(context.contactSession?.state ?? '') ||
    (deadline !== null && (!Number.isFinite(timestamp(deadline)) || timestamp(deadline) <= nowMs))
  );
  const base: NextEvidenceAdvice = {
    policyVersion: NEXT_EVIDENCE_POLICY_VERSION, status: 'ABSTAIN', mode: 'SHADOW_ONLY',
    authority: 'RECOMMENDATION_ONLY', activationAuthorized: false, collectionPermitted: false,
    sourceSnapshotStatus: 'UNVERIFIED', reviewPriority: urgent ? 'URGENT' : 'STANDARD',
    generatedAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null,
    sourceEvaluatedAt: null, expiresAt: null, sourceFingerprint: null, sourceInputVersion: null,
    caseVersion: context.safetyCase.version, contactVersion: context.contactSession?.version ?? null,
    reasons: ['SOURCE_SNAPSHOT_UNVERIFIED'], suggestions: []
  };
  const abstain = (reason: NextEvidenceReason, source: NextEvidenceAdvice = base): NextEvidenceAdvice => ({
    ...source, status: 'ABSTAIN', reasons: [...base.reasons, reason], suggestions: []
  });
  const observed = [...context.contextObservedAt];
  if (context.contactSession?.lastInteractionAt != null) observed.push(context.contactSession.lastInteractionAt);
  if (!Number.isFinite(nowMs) || !positiveVersion(context.safetyCase.version) ||
      (context.contactSession !== null && !positiveVersion(context.contactSession.version)) ||
      (deadline !== null && !Number.isFinite(timestamp(deadline))) ||
      observed.some((at) => !Number.isFinite(timestamp(at)) || timestamp(at) > nowMs)) return abstain('INVALID_CONTEXT');
  if (context.contactSession !== null && context.contactSession.caseId !== context.safetyCase.id) return abstain('SCOPE_MISMATCH');
  if (context.safetyCase.state === 'RESOLVED') return abstain('CASE_INACTIVE');
  const recommendation = context.recommendation;
  if (recommendation === null) return abstain('NO_RECOMMENDATION');
  if (typeof recommendation !== 'object') return abstain('INVALID_RECOMMENDATION');
  if (recommendation.tenantId !== context.tenantId || recommendation.caseId !== context.safetyCase.id) return abstain('SCOPE_MISMATCH');
  if (!validRecommendation(recommendation)) return abstain('INVALID_RECOMMENDATION');
  const evaluatedMs = timestamp(recommendation.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) return abstain('INVALID_RECOMMENDATION');
  const sourced: NextEvidenceAdvice = {
    ...base, sourceInputVersion: recommendation.inputVersion,
    sourceFingerprint: recommendation.deterministicFingerprint,
    sourceEvaluatedAt: new Date(evaluatedMs).toISOString(),
    expiresAt: new Date(evaluatedMs + NEXT_EVIDENCE_LIFETIME_MS).toISOString()
  };
  if (evaluatedMs > nowMs) return abstain('SOURCE_IN_FUTURE', sourced);
  if (nowMs >= evaluatedMs + NEXT_EVIDENCE_LIFETIME_MS) return abstain('SOURCE_EXPIRED', sourced);
  // inputVersion has no specified relationship to RoadEvent/contact versions.
  // These checks can reject a known mismatch but cannot certify snapshot identity.
  if (recommendation.currentSeverity !== context.safetyCase.severity ||
      observed.some((at) => timestamp(at) > evaluatedMs)) return abstain('CONTEXT_CHANGED', sourced);
  if (recommendation.guardResults.some((guard) => guard.disposition === 'BLOCK_AND_REVIEW') ||
      recommendation.missingEvidenceFlags.includes('MISSING_GUARD_CLEARANCE') ||
      recommendation.reasonCodes.includes('FUSION_GUARD_BLOCKED')) return abstain('GUARD_REVIEW_REQUIRED', sourced);
  if (context.evidenceState === 'QUARANTINED') return abstain('EVIDENCE_QUARANTINED', sourced);

  const flags = recommendation.missingEvidenceFlags;
  const reasons = recommendation.reasonCodes;
  const suggestions: NextEvidenceSuggestion[] = [];
  if (flags.includes('MISSING_CONTACT_OUTCOME') || context.contactSession === null ||
      ['NO_RESPONSE', 'UNREACHABLE', 'DISCONNECTED'].includes(context.contactSession.state)) suggestions.push('REVIEW_CONTACT_OUTCOME');
  if (context.evidenceState === 'CONFLICTING' || reasons.includes('FUSION_CONTRADICTORY_INPUTS')) suggestions.push('REVIEW_CONTRADICTORY_EVIDENCE');
  if (flags.includes('MISSING_RECENT_TRUSTED_SOURCE') || reasons.includes('FUSION_STALE_EVIDENCE')) suggestions.push('REVIEW_RECENT_TRUSTED_SOURCE');
  if (flags.includes('MISSING_CORROBORATION')) suggestions.push('REVIEW_INDEPENDENT_CORROBORATION');
  if (flags.includes('MISSING_DEVICE_HEALTH') || reasons.includes('FUSION_DEGRADED_DEVICE')) suggestions.push('REVIEW_DEVICE_HEALTH');
  if (flags.includes('MISSING_LOCATION_QUALITY')) suggestions.push('REVIEW_LOCATION_QUALITY');
  if (reasons.includes('FUSION_UNVERIFIED_SOURCE') || recommendation.guardResults.some((guard) => guard.disposition === 'DEGRADED')) suggestions.push('REVIEW_SOURCE_INTEGRITY');
  if (suggestions.length === 0) return abstain('NO_TARGETED_GAP', sourced);
  return { ...sourced, status: 'SUGGESTED', suggestions: suggestions.slice(0, 3) };
}

function positiveVersion(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function timestamp(value: string): number {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function validRecommendation(value: SafetyFusionRecommendation): boolean {
  const kinds = ['DATA_QUALITY', 'DRIFT', 'OUT_OF_DISTRIBUTION', 'ADVERSARIAL_INPUT'];
  const flags = ['MISSING_RECENT_TRUSTED_SOURCE', 'MISSING_CORROBORATION', 'MISSING_CONTACT_OUTCOME',
    'MISSING_DEVICE_HEALTH', 'MISSING_LOCATION_QUALITY', 'MISSING_GUARD_CLEARANCE'];
  return positiveVersion(value.inputVersion) && value.policyVersion === SAFETY_FUSION_POLICY_VERSION &&
    value.thresholdVersion === SAFETY_FUSION_THRESHOLD_VERSION &&
    typeof value.ruleSetVersion === 'string' && value.ruleSetVersion.trim().length > 0 &&
    value.authority === 'RECOMMENDATION_ONLY' && value.autonomousDowngradePermitted === false &&
    value.autonomousClosurePermitted === false && value.autonomousDispatchPermitted === false &&
    typeof value.deterministicFingerprint === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value.deterministicFingerprint) &&
    Array.isArray(value.reasonCodes) && value.reasonCodes.every((code) => typeof code === 'string') &&
    Array.isArray(value.missingEvidenceFlags) && value.missingEvidenceFlags.every((flag) => flags.includes(flag)) &&
    Array.isArray(value.guardResults) && value.guardResults.length === kinds.length &&
    value.guardResults.every((guard) => guard !== null && typeof guard === 'object' && kinds.includes(guard.kind) &&
      ['CLEAR', 'DEGRADED', 'BLOCK_AND_REVIEW'].includes(guard.disposition) && guard.evaluatedInputVersion === value.inputVersion) &&
    new Set(value.guardResults.map((guard) => guard.kind)).size === kinds.length;
}
