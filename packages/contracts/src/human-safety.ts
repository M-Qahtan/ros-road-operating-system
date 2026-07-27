export type HumanSafetyCaseState =
  | 'UNKNOWN'
  | 'CONTACT_PENDING'
  | 'CONTACTING'
  | 'RESPONDED'
  | 'NO_RESPONSE'
  | 'UNREACHABLE'
  | 'HUMAN_REVIEW'
  | 'ESCALATED'
  | 'TRANSFERRED'
  | 'MONITORED'
  | 'RESOLVED';

export type HumanSafetyActorRole =
  | 'SYSTEM'
  | 'OPERATOR'
  | 'SUPERVISOR'
  | 'SAFETY_LEAD'
  | 'AUDITOR'
  | 'SIMULATED_CHANNEL';

export type HumanSafetyChannel =
  | 'IN_APP_CHAT'
  | 'IN_APP_VOICE'
  | 'PUSH'
  | 'SMS_SIMULATION'
  | 'TELEPHONY_SIMULATION'
  | 'OPERATOR';

export type HumanSafetyAuthority =
  | 'OPEN_CASE'
  | 'START_CONTACT'
  | 'RECORD_STRUCTURED_INDICATOR'
  | 'ESCALATE'
  | 'TAKE_OVER_CONTACT'
  | 'TRANSFER'
  | 'MONITOR'
  | 'AUTHORIZE_HIGH_RISK_RESOLUTION'
  | 'RESOLVE';

export type SafetyIndicatorCode =
  | 'PERSON_RESPONDED'
  | 'PERSON_NOT_RESPONDING'
  | 'COMMUNICATION_INTERRUPTED'
  | 'HELP_REQUESTED'
  | 'POSSIBLE_IMMEDIATE_DANGER'
  | 'LOCATION_UNCERTAIN'
  | 'MULTIPLE_PEOPLE_REPORTED'
  | 'CONTRADICTORY_RESPONSE'
  | 'ACCESSIBILITY_SUPPORT_REQUIRED';

export interface StructuredSafetyIndicator {
  readonly code: SafetyIndicatorCode;
  readonly observedAt: string;
  readonly source: 'PERSON' | 'DEVICE' | 'OPERATOR' | 'SIMULATION';
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
}

export interface HighRiskResolutionAuthorization {
  readonly caseId: string;
  readonly decision: 'RESOLVE';
  readonly actorId: string;
  readonly role: 'SUPERVISOR' | 'SAFETY_LEAD';
  readonly reason: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly caseVersion: number;
  readonly severityAssessmentVersion: number;
  readonly evidenceRevision: number;
  readonly indicatorRevision: number;
  readonly connectivity: 'HEALTHY' | 'DEGRADED' | 'LOST';
  readonly dependenciesHealthy: boolean;
}

export interface HumanSafetyCaseContract {
  readonly id: string;
  readonly roadEventId: string;
  readonly state: HumanSafetyCaseState;
  readonly severity: 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
  readonly version: number;
  readonly severityAssessmentVersion: number;
  readonly evidenceRevision: number;
  readonly indicatorRevision: number;
  readonly openedAt: string;
  readonly nextDeadlineAt: string | null;
  readonly activeChannel: HumanSafetyChannel | null;
  readonly assignedActorId: string | null;
  readonly indicators: readonly StructuredSafetyIndicator[];
  readonly highRiskResolutionAuthorization: HighRiskResolutionAuthorization | null;
}

export interface HumanSafetyTransitionContext {
  readonly actorId: string;
  readonly actorRoles: readonly HumanSafetyActorRole[];
  readonly reason: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly connectivity: 'HEALTHY' | 'DEGRADED' | 'LOST';
  readonly evidenceQuality: 'TRUSTED' | 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING';
  readonly dependenciesHealthy: boolean;
}

export interface HumanSafetyTransitionDecision {
  readonly allowed: boolean;
  readonly nextState: HumanSafetyCaseState;
  readonly auditAction: string;
  readonly requiredAuthority: HumanSafetyAuthority | null;
  readonly failureBehavior: 'REJECT' | 'HUMAN_REVIEW' | 'ESCALATE';
  readonly reasonCode: string;
}

export interface HumanSafetySignalEnvelope {
  readonly signalId: string;
  readonly schemaVersion: 'ros-eye.signal.v1';
  readonly sourceType: 'PHONE' | 'VEHICLE' | 'PERSON' | 'OPERATOR' | 'INFRASTRUCTURE' | 'SIMULATION';
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly consentBasis: 'EXPLICIT' | 'EMERGENCY_SAFETY_REVIEW' | 'OPERATOR_ENTERED' | 'SIMULATION';
  readonly integrity: {
    readonly replayToken: string;
    readonly signatureStatus: 'VERIFIED' | 'UNVERIFIED' | 'INVALID';
    readonly clockSkewMs: number;
  };
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracyMeters: number;
    readonly classification: 'PRECISE_RESTRICTED';
  } | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HumanSafetyAuditEvent {
  readonly eventId: string;
  readonly caseId: string;
  readonly action: string;
  readonly actorId: string;
  readonly actorRole: HumanSafetyActorRole;
  readonly reasonCode: string;
  readonly traceId: string;
  readonly caseVersion: number;
  readonly occurredAt: string;
}

export const HUMAN_SAFETY_ALLOWED_TRANSITIONS: Readonly<Record<HumanSafetyCaseState, readonly HumanSafetyCaseState[]>> = Object.freeze({
  UNKNOWN: ['CONTACT_PENDING', 'HUMAN_REVIEW', 'ESCALATED'],
  CONTACT_PENDING: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'],
  CONTACTING: ['RESPONDED', 'NO_RESPONSE', 'UNREACHABLE', 'HUMAN_REVIEW', 'ESCALATED'],
  RESPONDED: ['HUMAN_REVIEW', 'ESCALATED', 'TRANSFERRED', 'MONITORED'],
  NO_RESPONSE: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'],
  UNREACHABLE: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'],
  HUMAN_REVIEW: ['ESCALATED', 'TRANSFERRED', 'MONITORED'],
  ESCALATED: ['TRANSFERRED', 'MONITORED'],
  TRANSFERRED: ['MONITORED'],
  MONITORED: ['HUMAN_REVIEW', 'ESCALATED', 'RESOLVED'],
  RESOLVED: []
});

const HIGH_RISK = new Set(['S3', 'S4']);

export function decideHumanSafetyTransition(
  current: Pick<HumanSafetyCaseContract, 'id' | 'state' | 'severity' | 'version' | 'severityAssessmentVersion' | 'evidenceRevision' | 'indicatorRevision' | 'highRiskResolutionAuthorization'>,
  requestedState: HumanSafetyCaseState,
  context: HumanSafetyTransitionContext
): HumanSafetyTransitionDecision {
  const allowedTargets = HUMAN_SAFETY_ALLOWED_TRANSITIONS[current.state];
  if (!allowedTargets.includes(requestedState)) {
    return decision(false, current.state, 'human_safety.transition_rejected', null, 'REJECT', 'invalid_transition');
  }

  if (!context.dependenciesHealthy && requestedState === 'RESOLVED') {
    return decision(false, 'ESCALATED', 'human_safety.unsafe_resolution_blocked', 'ESCALATE', 'ESCALATE', 'dependency_unhealthy');
  }

  if (context.connectivity === 'LOST' && !['HUMAN_REVIEW', 'ESCALATED'].includes(requestedState)) {
    return decision(false, 'ESCALATED', 'human_safety.connectivity_loss_escalated', 'ESCALATE', 'ESCALATE', 'connectivity_lost');
  }

  if (['AMBIGUOUS', 'CONFLICTING', 'MISSING'].includes(context.evidenceQuality) && requestedState === 'RESOLVED') {
    return decision(false, 'HUMAN_REVIEW', 'human_safety.ambiguous_resolution_blocked', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'HUMAN_REVIEW', 'evidence_not_trusted');
  }

  if (requestedState === 'RESOLVED' && HIGH_RISK.has(current.severity)) {
    const authorization = current.highRiskResolutionAuthorization;
    const occurredAtMs = parseTimestamp(context.occurredAt);
    const authorizedAtMs = authorization === null ? null : parseTimestamp(authorization.authorizedAt);
    const expiresAtMs = authorization === null ? null : parseTimestamp(authorization.expiresAt);
    const authorizationChronologyValid = authorization !== null &&
      authorizedAtMs !== null &&
      expiresAtMs !== null &&
      occurredAtMs !== null &&
      authorizedAtMs <= occurredAtMs &&
      occurredAtMs < expiresAtMs &&
      authorizedAtMs < expiresAtMs;
    const authorizationFresh = authorization !== null &&
      authorization.caseId === current.id &&
      authorization.decision === 'RESOLVE' &&
      authorization.caseVersion === current.version &&
      authorization.severityAssessmentVersion === current.severityAssessmentVersion &&
      authorization.evidenceRevision === current.evidenceRevision &&
      authorization.indicatorRevision === current.indicatorRevision &&
      authorization.connectivity === context.connectivity &&
      authorization.dependenciesHealthy === context.dependenciesHealthy &&
      authorizationChronologyValid;
    const actorAuthorized = context.actorRoles.some((role) => role === 'SUPERVISOR' || role === 'SAFETY_LEAD');
    if (!authorizationFresh || !actorAuthorized) {
      return decision(false, 'HUMAN_REVIEW', 'human_safety.high_risk_resolution_rejected', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'HUMAN_REVIEW', authorization === null ? 'human_authority_required' : 'stale_or_invalid_authorization');
    }
  }

  return decision(true, requestedState, `human_safety.transitioned.${requestedState.toLowerCase()}`, null, 'REJECT', 'approved');
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decision(
  allowed: boolean,
  nextState: HumanSafetyCaseState,
  auditAction: string,
  requiredAuthority: HumanSafetyAuthority | null,
  failureBehavior: HumanSafetyTransitionDecision['failureBehavior'],
  reasonCode: string
): HumanSafetyTransitionDecision {
  return { allowed, nextState, auditAction, requiredAuthority, failureBehavior, reasonCode };
}
