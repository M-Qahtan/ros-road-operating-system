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
 * Independent fail-closed governance adapter between cognition/planning and outputs.
 *
 * This function does not mint, restore, or delegate authority. Even ALLOW_ADVISORY
 * only permits an advisory to continue toward the separately authorized human /
 * operations path. Physical or governmental action remains outside this contract.
 */
export function evaluateRosHeart(input: RosHeartEvaluationInput): RosHeartDecision {
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

  return decision('ALLOW_ADVISORY', 'advisory_prerequisites_satisfied');
}
