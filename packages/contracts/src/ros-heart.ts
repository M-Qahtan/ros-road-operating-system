import type { HumanSafetyActorRole } from './human-safety.js';

export type RosHeartDisposition =
  | 'VETO'
  | 'REQUEST_MORE_EVIDENCE'
  | 'REQUEST_HUMAN_REVIEW'
  | 'ALLOW_ADVISORY';

export type RosHeartRequestedOutput =
  | 'ADVISORY'
  | 'HUMAN_REVIEW'
  | 'EMERGENCY_DISPATCH'
  | 'TRAFFIC_SIGNAL_ACTUATION'
  | 'DIRECT_VEHICLE_CONTROL';

export interface RosHeartEvaluationInput {
  readonly evidence: {
    readonly present: boolean;
    readonly fresh: boolean;
    readonly quality: 'TRUSTED' | 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING';
  };
  readonly authority: {
    readonly present: boolean;
    readonly valid: boolean;
  };
  readonly purpose: {
    readonly present: boolean;
    readonly matches: boolean;
  };
  readonly audit: {
    readonly available: boolean;
  };
  readonly scope: {
    readonly tenantMatches: boolean;
    readonly jurisdictionMatches: boolean;
  };
  readonly integrity: {
    readonly replayDetected: boolean;
    readonly compromised: boolean;
    readonly degraded: boolean;
  };
  readonly requestedOutput: RosHeartRequestedOutput;
}

export interface RosHeartDecision {
  readonly disposition: RosHeartDisposition;
  readonly authority: 'NONE';
  readonly executionAuthorized: false;
  readonly reasonCode: string;
}

const decision = (
  disposition: RosHeartDisposition,
  reasonCode: string
): RosHeartDecision => ({
  disposition,
  authority: 'NONE',
  executionAuthorized: false,
  reasonCode
});

/**
 * This is only a prerequisite check. It must not be exposed as a complete
 * authority or evidence verification gate.
 */
function evaluatePrerequisites(input: RosHeartEvaluationInput): RosHeartDecision {
  if (!input.audit.available) return decision('VETO', 'audit_unavailable');
  if (input.integrity.replayDetected) return decision('VETO', 'replay_detected');
  if (input.integrity.compromised) return decision('VETO', 'component_compromised');
  if (input.integrity.degraded) return decision('REQUEST_HUMAN_REVIEW', 'dependency_degraded');

  if (!input.scope.tenantMatches) return decision('VETO', 'tenant_scope_mismatch');
  if (!input.scope.jurisdictionMatches) return decision('VETO', 'jurisdiction_scope_mismatch');
  if (!input.purpose.present || !input.purpose.matches) return decision('VETO', 'purpose_missing_or_mismatch');

  if (!input.evidence.present || input.evidence.quality === 'MISSING') {
    return decision('REQUEST_MORE_EVIDENCE', 'evidence_missing');
  }
  if (!input.evidence.fresh) return decision('REQUEST_MORE_EVIDENCE', 'evidence_stale');
  if (input.evidence.quality === 'AMBIGUOUS' || input.evidence.quality === 'CONFLICTING') {
    return decision('REQUEST_HUMAN_REVIEW', 'evidence_unresolved');
  }

  if (!input.authority.present || !input.authority.valid) {
    return decision('REQUEST_HUMAN_REVIEW', 'authority_missing_or_invalid');
  }

  if (
    input.requestedOutput === 'EMERGENCY_DISPATCH' ||
    input.requestedOutput === 'TRAFFIC_SIGNAL_ACTUATION' ||
    input.requestedOutput === 'DIRECT_VEHICLE_CONTROL'
  ) {
    return decision('VETO', 'prohibited_effect_requested');
  }

  if (input.requestedOutput === 'HUMAN_REVIEW') {
    return decision('REQUEST_HUMAN_REVIEW', 'human_review_requested');
  }

  if (input.requestedOutput !== 'ADVISORY') return decision('VETO', 'unknown_output');
  return decision('ALLOW_ADVISORY', 'advisory_prerequisites_satisfied');
}

/**
 * Legacy boolean-only entry point is deliberately fail-closed. A caller cannot
 * obtain ALLOW_ADVISORY without the trusted binding + durable replay/audit ports.
 */
export function evaluateRosHeart(input: RosHeartEvaluationInput): RosHeartDecision {
  const preliminary = evaluatePrerequisites(input);
  return preliminary.disposition === 'ALLOW_ADVISORY'
    ? decision('REQUEST_HUMAN_REVIEW', 'trusted_binding_required')
    : preliminary;
}

/**
 * Claim provided with the recommendation. The independently resolved snapshot
 * must bind EVERY field to canonical case/evidence/CRS/policy/authenticated
 * actor context. No model output or client boolean is accepted as authority.
 */
export interface RosHeartBinding {
  readonly roadEventId: string;
  readonly humanSafetyCaseId: string;
  readonly caseVersion: number;
  readonly evidenceRevision: number;
  readonly crsDigest: string;
  readonly crsVersion: number;
  readonly crsExpiresAt: string;
  readonly recommendationDigest: string;
  readonly recommendationVersion: number;
  readonly recommendationExpiresAt: string;
  readonly recommendationAuthority: 'NONE';
  readonly directVehicleControl: false;
  readonly policyDigest: string;
  readonly policyVersion: string;
  readonly actorId: string;
  readonly actorRole: HumanSafetyActorRole;
  readonly traceId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly jurisdiction: string;
}

export interface RosHeartTrustedSnapshot {
  readonly binding: RosHeartBinding;
  readonly checks: Omit<RosHeartEvaluationInput, 'requestedOutput'>;
}

export interface RosHeartBoundInput {
  readonly claim: RosHeartBinding;
  readonly requestedOutput: RosHeartRequestedOutput;
}

export interface RosHeartBindingPorts {
  /**
   * Server-side resolution MUST use authenticated actor/session and authoritative
   * case/evidence/policy/recommendation stores, not values copied from the claim.
   * Missing/ambiguous data MUST return null or throw.
   */
  resolveTrustedSnapshot(request: Readonly<Pick<RosHeartBinding, 'roadEventId' | 'humanSafetyCaseId' | 'traceId'>>): Promise<RosHeartTrustedSnapshot | null>;
  /** Globally atomic, durable, unique consumption within the appropriate tenant scope. */
  consumeIdempotency(request: Readonly<Pick<RosHeartBinding, 'tenantId' | 'humanSafetyCaseId' | 'idempotencyKey' | 'traceId' | 'recommendationDigest'>>): Promise<'CONSUMED' | 'DUPLICATE' | 'UNAVAILABLE'>;
  /** Must persist a tamper-evident audit record BEFORE any ALLOW_ADVISORY is returned. */
  persistDecisionAudit(record: {
    readonly claim: RosHeartBinding;
    readonly disposition: 'ALLOW_ADVISORY';
    readonly reasonCode: string;
    readonly evaluatedAtEpochMs: number;
  }): Promise<'PERSISTED' | 'FAILED'>;
  /** Trusted server clock, not a timestamp supplied by the recommendation. */
  trustedNowEpochMs(): number;
}

const BINDING_KEYS = [
  'roadEventId', 'humanSafetyCaseId', 'caseVersion', 'evidenceRevision',
  'crsDigest', 'crsVersion', 'crsExpiresAt',
  'recommendationDigest', 'recommendationVersion', 'recommendationExpiresAt',
  'recommendationAuthority', 'directVehicleControl',
  'policyDigest', 'policyVersion', 'actorId', 'actorRole',
  'traceId', 'idempotencyKey', 'tenantId', 'purpose', 'jurisdiction'
] as const satisfies readonly (keyof RosHeartBinding)[];

const SHA256 = /^[a-f0-9]{64}$/;
const ROLES = new Set<HumanSafetyActorRole>(['SYSTEM', 'OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD']);

function validBinding(binding: RosHeartBinding): boolean {
  const ids = [binding.roadEventId, binding.humanSafetyCaseId, binding.policyVersion,
    binding.actorId, binding.traceId, binding.idempotencyKey,
    binding.tenantId, binding.purpose, binding.jurisdiction];
  if (!ids.every(value => typeof value === 'string' && value.trim().length > 0)) return false;
  if (![binding.caseVersion, binding.crsVersion, binding.recommendationVersion]
    .every(value => Number.isSafeInteger(value) && value > 0)) return false;
  if (!Number.isSafeInteger(binding.evidenceRevision) || binding.evidenceRevision < 0) return false;
  if (![binding.crsDigest, binding.recommendationDigest, binding.policyDigest]
    .every(value => typeof value === 'string' && SHA256.test(value))) return false;
  if (binding.recommendationAuthority !== 'NONE' || binding.directVehicleControl !== false) return false;
  if (!ROLES.has(binding.actorRole)) return false;
  return true;
}

/**
 * Fail-closed bounded contract adapter. The ports are TRUSTED runtime
 * dependencies, not caller-supplied evidence. This is NOT a live integration,
 * independent-review approval, or authorization for S3/S4 resolution.
 */
export async function evaluateRosHeartBound(
  input: RosHeartBoundInput,
  ports: RosHeartBindingPorts
): Promise<RosHeartDecision> {
  if (!input?.claim || !validBinding(input.claim)) return decision('VETO', 'binding_invalid');
  if (!Number.isFinite(ports.trustedNowEpochMs())) return decision('VETO', 'trusted_clock_invalid');

  try {
    const snapshot = await ports.resolveTrustedSnapshot({
      roadEventId: input.claim.roadEventId,
      humanSafetyCaseId: input.claim.humanSafetyCaseId,
      traceId: input.claim.traceId
    });
    if (!snapshot || !snapshot.binding || !validBinding(snapshot.binding) || !snapshot.checks) {
      return decision('VETO', 'trusted_snapshot_missing');
    }
    for (const key of BINDING_KEYS) {
      if (input.claim[key] !== snapshot.binding[key]) return decision('VETO', 'binding_mismatch_' + key);
    }

    const now = ports.trustedNowEpochMs();
    if (!Number.isFinite(now)) return decision('VETO', 'trusted_clock_invalid');
    const crsExpiry = Date.parse(snapshot.binding.crsExpiresAt);
    const recommendationExpiry = Date.parse(snapshot.binding.recommendationExpiresAt);
    if (!Number.isFinite(crsExpiry) || !Number.isFinite(recommendationExpiry)) {
      return decision('VETO', 'binding_expiry_invalid');
    }
    if (crsExpiry <= now || recommendationExpiry <= now) {
      return decision('REQUEST_MORE_EVIDENCE', 'binding_expired');
    }

    // Every prerequisite comes from trusted server resolution, not from input.
    const preliminary = evaluatePrerequisites({
      ...snapshot.checks,
      requestedOutput: input.requestedOutput
    });
    if (preliminary.disposition !== 'ALLOW_ADVISORY') return preliminary;

    const consumed = await ports.consumeIdempotency({
      tenantId: snapshot.binding.tenantId,
      humanSafetyCaseId: snapshot.binding.humanSafetyCaseId,
      idempotencyKey: snapshot.binding.idempotencyKey,
      traceId: snapshot.binding.traceId,
      recommendationDigest: snapshot.binding.recommendationDigest
    });
    if (consumed !== 'CONSUMED') return decision('VETO', 'idempotency_not_consumed');

    const audit = await ports.persistDecisionAudit({
      claim: snapshot.binding,
      disposition: 'ALLOW_ADVISORY',
      reasonCode: 'advisory_prerequisites_satisfied',
      evaluatedAtEpochMs: now
    });
    if (audit !== 'PERSISTED') return decision('VETO', 'audit_not_persisted');
    return decision('ALLOW_ADVISORY', 'advisory_prerequisites_satisfied');
  } catch {
    // No exception from a trust boundary may become an allowed effect.
    return decision('VETO', 'trusted_binding_dependency_failure');
  }
}
