export type HumanSafetyCaseState = 'UNKNOWN' | 'CONTACT_PENDING' | 'CONTACTING' | 'RESPONDED' | 'NO_RESPONSE' | 'UNREACHABLE' | 'HUMAN_REVIEW' | 'ESCALATED' | 'TRANSFERRED' | 'MONITORED' | 'RESOLVED';
export type HumanSafetyActorRole = 'SYSTEM' | 'OPERATOR' | 'SUPERVISOR' | 'SAFETY_LEAD' | 'AUDITOR' | 'SIMULATED_CHANNEL';
export type HumanSafetyChannel = 'IN_APP_CHAT' | 'IN_APP_VOICE' | 'PUSH' | 'SMS_SIMULATION' | 'TELEPHONY_SIMULATION' | 'OPERATOR';
export type HumanSafetyAuthority = 'OPEN_CASE' | 'START_CONTACT' | 'UPDATE_CONTACT_OUTCOME' | 'RECORD_STRUCTURED_INDICATOR' | 'ESCALATE' | 'TAKE_OVER_CONTACT' | 'TRANSFER' | 'MONITOR' | 'AUTHORIZE_HIGH_RISK_RESOLUTION' | 'RESOLVE';

export const HUMAN_SAFETY_AUTHORITY_POLICY_VERSION = 'ros-eye.authority.v3' as const;
export const HUMAN_SAFETY_UNCERTAINTY_POLICY_VERSION = 'ros-eye.uncertainty-resolution.v1' as const;
export const HUMAN_SAFETY_REPLAY_POLICY_VERSION = 'ros-eye.replay.v2' as const;
export const HUMAN_SAFETY_TEMPORAL_POLICY_VERSION = 'ros-eye.signal-time.v1' as const;
export const HUMAN_SAFETY_REPLAY_TTL_MS = 15 * 60 * 1000;
export const HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const HUMAN_SAFETY_MAX_SIGNAL_AGE_MS = 30 * 60 * 1000;

export const HUMAN_SAFETY_ROLE_AUTHORITIES: Readonly<Record<HumanSafetyActorRole, readonly HumanSafetyAuthority[]>> = Object.freeze({
  SYSTEM: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'ESCALATE'],
  OPERATOR: ['START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'RESOLVE'],
  SUPERVISOR: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'RESOLVE'],
  SAFETY_LEAD: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'RESOLVE'],
  AUDITOR: [],
  SIMULATED_CHANNEL: []
});

const ROLE_PRIORITY: readonly HumanSafetyActorRole[] = ['SAFETY_LEAD', 'SUPERVISOR', 'OPERATOR', 'SYSTEM', 'AUDITOR', 'SIMULATED_CHANNEL'];
export type HumanSafetyReactivationCause = 'LATE_HIGH_RISK_SIGNAL' | 'CONTRADICTORY_INDICATOR' | 'EVIDENCE_CORRECTION' | 'DEPENDENCY_RECOVERY_FINDING';
export type SafetyIndicatorCode = 'PERSON_RESPONDED' | 'PERSON_NOT_RESPONDING' | 'COMMUNICATION_INTERRUPTED' | 'HELP_REQUESTED' | 'POSSIBLE_IMMEDIATE_DANGER' | 'LOCATION_UNCERTAIN' | 'MULTIPLE_PEOPLE_REPORTED' | 'CONTRADICTORY_RESPONSE' | 'ACCESSIBILITY_SUPPORT_REQUIRED';
const SAFETY_INDICATOR_CODES = new Set<SafetyIndicatorCode>(['PERSON_RESPONDED', 'PERSON_NOT_RESPONDING', 'COMMUNICATION_INTERRUPTED', 'HELP_REQUESTED', 'POSSIBLE_IMMEDIATE_DANGER', 'LOCATION_UNCERTAIN', 'MULTIPLE_PEOPLE_REPORTED', 'CONTRADICTORY_RESPONSE', 'ACCESSIBILITY_SUPPORT_REQUIRED']);

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

export interface HumanSafetyUncertaintyResolutionAuthorization {
  readonly caseId: string;
  readonly decision: 'ALLOW_MONITORING';
  readonly actorId: string;
  readonly role: 'SUPERVISOR' | 'SAFETY_LEAD';
  readonly reasonCode: 'AMBIGUITY_RESOLVED' | 'CONFLICT_RESOLVED' | 'MISSING_EVIDENCE_DISPOSITIONED';
  readonly policyVersion: typeof HUMAN_SAFETY_UNCERTAINTY_POLICY_VERSION;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly caseVersion: number;
  readonly severityAssessmentVersion: number;
  readonly evidenceRevision: number;
  readonly indicatorRevision: number;
  readonly resolvedEvidenceQuality: 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING';
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
  readonly uncertaintyResolutionAuthorization?: HumanSafetyUncertaintyResolutionAuthorization;
  readonly reactivationCause?: HumanSafetyReactivationCause;
}

export interface HumanSafetyTransitionDecision {
  readonly allowed: boolean;
  readonly nextState: HumanSafetyCaseState;
  readonly auditAction: string;
  readonly requiredAuthority: HumanSafetyAuthority | null;
  readonly evaluatedAuthority: HumanSafetyAuthority | null;
  readonly authorizedByRole: HumanSafetyActorRole | null;
  readonly authorityPolicyVersion: typeof HUMAN_SAFETY_AUTHORITY_POLICY_VERSION;
  readonly failureBehavior: 'REJECT' | 'HUMAN_REVIEW' | 'ESCALATE';
  readonly reasonCode: string;
}

export type HumanSafetyDataClassification = 'OPERATIONAL' | 'SENSITIVE_RESTRICTED';
export type HumanSafetyRetentionClass = 'SAFETY_CASE_METADATA' | 'SHORT_LIVED_SIGNAL_METADATA' | 'SIMULATION_ONLY';
export type HumanSafetySignalPayload =
  | { readonly kind: 'PHONE_MOTION'; readonly accelerationMagnitude: number; readonly impactDetected: boolean }
  | { readonly kind: 'VEHICLE_EVENT'; readonly eventCode: 'IMPACT' | 'AIRBAG' | 'HARD_BRAKE' | 'ROLLOVER'; readonly confidence: number }
  | { readonly kind: 'PERSON_REPORT'; readonly indicatorCodes: readonly SafetyIndicatorCode[] }
  | { readonly kind: 'OPERATOR_OBSERVATION'; readonly indicatorCodes: readonly SafetyIndicatorCode[] }
  | { readonly kind: 'INFRASTRUCTURE_METADATA'; readonly sensorType: 'CAMERA_METADATA' | 'ROAD_SENSOR'; readonly confidence: number }
  | { readonly kind: 'SIMULATION_FIXTURE'; readonly fixtureId: string };

export interface HumanSafetySignalEnvelope {
  readonly signalId: string;
  readonly schemaVersion: 'ros-eye.signal.v1';
  readonly purposePolicyVersion: 'ros-eye.purpose.v1';
  readonly dataClassification: HumanSafetyDataClassification;
  readonly retentionClass: HumanSafetyRetentionClass;
  readonly sourceType: 'PHONE' | 'VEHICLE' | 'PERSON' | 'OPERATOR' | 'INFRASTRUCTURE' | 'SIMULATION';
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly consentBasis: 'EXPLICIT' | 'EMERGENCY_SAFETY_REVIEW' | 'OPERATOR_ENTERED' | 'SIMULATION';
  readonly integrity: { readonly replayToken: string; readonly signatureStatus: 'VERIFIED' | 'UNVERIFIED' | 'INVALID'; readonly clockSkewMs: number };
  readonly location: { readonly latitude: number; readonly longitude: number; readonly accuracyMeters: number; readonly classification: 'PRECISE_RESTRICTED' } | null;
  readonly payload: HumanSafetySignalPayload;
}

export interface HumanSafetySignalValidationDecision {
  readonly accepted: boolean;
  readonly disposition: 'ACCEPT' | 'QUARANTINE' | 'HUMAN_REVIEW';
  readonly reasonCode: string;
}
export type ReplayNonceConsumeResult = 'CONSUMED' | 'DUPLICATE' | 'EXPIRED' | 'UNAVAILABLE';
export interface ReplayNonceConsumeRequest {
  readonly policyVersion: typeof HUMAN_SAFETY_REPLAY_POLICY_VERSION;
  readonly nonceDigest: string;
  readonly scopeDigest: string;
  readonly expiresAt: string;
}
export interface ReplayNonceRegistryPort {
  /**
   * Atomically consumes nonceDigest as the global uniqueness key for its TTL.
   * scopeDigest is audit context only and must never weaken nonce uniqueness.
   */
  consume(request: ReplayNonceConsumeRequest): Promise<ReplayNonceConsumeResult>;
}
export interface ReplayTokenDigesterPort { digest(value: string): Promise<string> }
export interface HumanSafetySignalAcceptancePorts { readonly replayRegistry: ReplayNonceRegistryPort; readonly tokenDigester: ReplayTokenDigesterPort }
export interface HumanSafetySignalAcceptanceDecision extends HumanSafetySignalValidationDecision {
  readonly replayPolicyVersion: typeof HUMAN_SAFETY_REPLAY_POLICY_VERSION;
  readonly temporalPolicyVersion: typeof HUMAN_SAFETY_TEMPORAL_POLICY_VERSION;
  readonly replayScopeDigest: string | null;
  readonly replayConsumeResult: ReplayNonceConsumeResult | 'NOT_ATTEMPTED';
  readonly replayExpiresAt: string | null;
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
  readonly authorityPolicyVersion: typeof HUMAN_SAFETY_AUTHORITY_POLICY_VERSION;
  readonly evaluatedAuthority: HumanSafetyAuthority | null;
}

export const HUMAN_SAFETY_ALLOWED_TRANSITIONS: Readonly<Record<HumanSafetyCaseState, readonly HumanSafetyCaseState[]>> = Object.freeze({
  UNKNOWN: ['CONTACT_PENDING', 'HUMAN_REVIEW', 'ESCALATED'], CONTACT_PENDING: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'], CONTACTING: ['RESPONDED', 'NO_RESPONSE', 'UNREACHABLE', 'HUMAN_REVIEW', 'ESCALATED'], RESPONDED: ['HUMAN_REVIEW', 'ESCALATED', 'TRANSFERRED', 'MONITORED'], NO_RESPONSE: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'], UNREACHABLE: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'], HUMAN_REVIEW: ['ESCALATED', 'TRANSFERRED', 'MONITORED'], ESCALATED: ['TRANSFERRED', 'MONITORED'], TRANSFERRED: ['MONITORED'], MONITORED: ['HUMAN_REVIEW', 'ESCALATED', 'RESOLVED'], RESOLVED: ['HUMAN_REVIEW', 'ESCALATED']
});

const TRANSITION_AUTHORITIES: Readonly<Record<string, HumanSafetyAuthority>> = Object.freeze({
  'UNKNOWN->CONTACT_PENDING': 'OPEN_CASE', 'UNKNOWN->HUMAN_REVIEW': 'ESCALATE', 'UNKNOWN->ESCALATED': 'ESCALATE', 'CONTACT_PENDING->CONTACTING': 'START_CONTACT', 'CONTACT_PENDING->HUMAN_REVIEW': 'ESCALATE', 'CONTACT_PENDING->ESCALATED': 'ESCALATE', 'CONTACTING->RESPONDED': 'UPDATE_CONTACT_OUTCOME', 'CONTACTING->NO_RESPONSE': 'UPDATE_CONTACT_OUTCOME', 'CONTACTING->UNREACHABLE': 'UPDATE_CONTACT_OUTCOME', 'CONTACTING->HUMAN_REVIEW': 'ESCALATE', 'CONTACTING->ESCALATED': 'ESCALATE', 'RESPONDED->HUMAN_REVIEW': 'ESCALATE', 'RESPONDED->ESCALATED': 'ESCALATE', 'RESPONDED->TRANSFERRED': 'TRANSFER', 'RESPONDED->MONITORED': 'MONITOR', 'NO_RESPONSE->CONTACTING': 'START_CONTACT', 'NO_RESPONSE->HUMAN_REVIEW': 'ESCALATE', 'NO_RESPONSE->ESCALATED': 'ESCALATE', 'UNREACHABLE->CONTACTING': 'START_CONTACT', 'UNREACHABLE->HUMAN_REVIEW': 'ESCALATE', 'UNREACHABLE->ESCALATED': 'ESCALATE', 'HUMAN_REVIEW->ESCALATED': 'ESCALATE', 'HUMAN_REVIEW->TRANSFERRED': 'TRANSFER', 'HUMAN_REVIEW->MONITORED': 'MONITOR', 'ESCALATED->TRANSFERRED': 'TRANSFER', 'ESCALATED->MONITORED': 'MONITOR', 'TRANSFERRED->MONITORED': 'MONITOR', 'MONITORED->HUMAN_REVIEW': 'ESCALATE', 'MONITORED->ESCALATED': 'ESCALATE', 'MONITORED->RESOLVED': 'RESOLVE', 'RESOLVED->HUMAN_REVIEW': 'ESCALATE', 'RESOLVED->ESCALATED': 'ESCALATE'
});

const HIGH_RISK = new Set(['S3', 'S4']);
const UNRESOLVED_EVIDENCE = new Set(['AMBIGUOUS', 'CONFLICTING', 'MISSING']);
const DEESCALATING_TO_MONITORED = new Set(['HUMAN_REVIEW', 'ESCALATED', 'TRANSFERRED']);
const REACTIVATION_CAUSES = new Set<HumanSafetyReactivationCause>(['LATE_HIGH_RISK_SIGNAL', 'CONTRADICTORY_INDICATOR', 'EVIDENCE_CORRECTION', 'DEPENDENCY_RECOVERY_FINDING']);

export function decideHumanSafetyTransition(current: Pick<HumanSafetyCaseContract, 'id' | 'state' | 'severity' | 'version' | 'severityAssessmentVersion' | 'evidenceRevision' | 'indicatorRevision' | 'highRiskResolutionAuthorization'>, requestedState: HumanSafetyCaseState, context: HumanSafetyTransitionContext): HumanSafetyTransitionDecision {
  if (!nonEmpty(context.actorId) || !nonEmpty(context.reason) || !nonEmpty(context.traceId) || parseTimestamp(context.occurredAt) === null) return decision(false, 'HUMAN_REVIEW', 'human_safety.invalid_transition_context', null, null, null, 'HUMAN_REVIEW', 'invalid_transition_context');
  if (!HUMAN_SAFETY_ALLOWED_TRANSITIONS[current.state].includes(requestedState)) return decision(false, current.state, 'human_safety.transition_rejected', null, null, null, 'REJECT', 'invalid_transition');
  const requiredAuthority = authorityForTransition(current.state, requestedState);
  if (requiredAuthority === null) return decision(false, current.state, 'human_safety.authority_policy_missing', null, null, null, 'REJECT', 'transition_authority_undefined');
  const authorizedByRole = authorizedRole(context.actorRoles, requiredAuthority);
  if (authorizedByRole === null) return decision(false, current.state, 'human_safety.authority_rejected', requiredAuthority, requiredAuthority, null, 'REJECT', 'actor_not_authorized');

  if (current.state === 'RESOLVED') {
    const cause = context.reactivationCause;
    if (cause === undefined || !REACTIVATION_CAUSES.has(cause)) return decision(false, current.state, 'human_safety.reactivation_rejected', requiredAuthority, requiredAuthority, authorizedByRole, 'REJECT', 'reactivation_cause_required');
    return decision(true, requestedState, requestedState === 'ESCALATED' ? 'human_safety.resolved_case_escalated' : 'human_safety.resolved_case_reopened_for_review', requiredAuthority, requiredAuthority, authorizedByRole, requestedState === 'ESCALATED' ? 'ESCALATE' : 'HUMAN_REVIEW', `reactivated_${cause.toLowerCase()}_prior_authorization_invalidated`);
  }
  if (context.connectivity === 'LOST' && !['HUMAN_REVIEW', 'ESCALATED'].includes(requestedState)) return decision(false, 'ESCALATED', 'human_safety.connectivity_loss_escalated', 'ESCALATE', 'ESCALATE', authorizedRole(context.actorRoles, 'ESCALATE'), 'ESCALATE', 'connectivity_lost');
  if (requestedState === 'RESOLVED' && !context.dependenciesHealthy) return decision(false, 'ESCALATED', 'human_safety.dependency_resolution_blocked', requiredAuthority, requiredAuthority, authorizedByRole, 'ESCALATE', 'dependencies_unhealthy');

  const deEscalating = requestedState === 'MONITORED' && DEESCALATING_TO_MONITORED.has(current.state);
  if (deEscalating && !context.dependenciesHealthy) return decision(false, current.state === 'ESCALATED' ? 'ESCALATED' : 'HUMAN_REVIEW', 'human_safety.dependency_deescalation_blocked', requiredAuthority, requiredAuthority, authorizedByRole, current.state === 'ESCALATED' ? 'ESCALATE' : 'HUMAN_REVIEW', 'dependencies_unhealthy');
  if (deEscalating && UNRESOLVED_EVIDENCE.has(context.evidenceQuality) && !validUncertaintyResolution(current, context)) return decision(false, current.state === 'ESCALATED' ? 'ESCALATED' : 'HUMAN_REVIEW', 'human_safety.uncertainty_deescalation_blocked', requiredAuthority, requiredAuthority, authorizedByRole, current.state === 'ESCALATED' ? 'ESCALATE' : 'HUMAN_REVIEW', 'unresolved_evidence_requires_versioned_authorization');
  if (UNRESOLVED_EVIDENCE.has(context.evidenceQuality) && requestedState === 'RESOLVED') return decision(false, 'HUMAN_REVIEW', 'human_safety.ambiguous_resolution_blocked', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'AUTHORIZE_HIGH_RISK_RESOLUTION', authorizedRole(context.actorRoles, 'AUTHORIZE_HIGH_RISK_RESOLUTION'), 'HUMAN_REVIEW', 'evidence_not_trusted');

  if (requestedState === 'RESOLVED' && HIGH_RISK.has(current.severity)) {
    const authorization = current.highRiskResolutionAuthorization;
    const occurredAt = parseTimestamp(context.occurredAt);
    const authorizedAt = authorization === null ? null : parseTimestamp(authorization.authorizedAt);
    const expiresAt = authorization === null ? null : parseTimestamp(authorization.expiresAt);
    const chronologyValid = authorization !== null && authorizedAt !== null && expiresAt !== null && occurredAt !== null && authorizedAt <= occurredAt && occurredAt < expiresAt && authorizedAt < expiresAt;
    const fresh = authorization !== null && authorization.caseId === current.id && authorization.decision === 'RESOLVE' && authorization.caseVersion === current.version && authorization.severityAssessmentVersion === current.severityAssessmentVersion && authorization.evidenceRevision === current.evidenceRevision && authorization.indicatorRevision === current.indicatorRevision && authorization.connectivity === context.connectivity && authorization.dependenciesHealthy === context.dependenciesHealthy && authorization.actorId === context.actorId && context.actorRoles.includes(authorization.role) && chronologyValid;
    const resolutionRole = authorizedRole(context.actorRoles, 'RESOLVE');
    const authorizationRole = authorizedRole(context.actorRoles, 'AUTHORIZE_HIGH_RISK_RESOLUTION');
    if (!fresh || resolutionRole === null || authorizationRole === null || authorizationRole !== authorization?.role) return decision(false, 'HUMAN_REVIEW', 'human_safety.high_risk_resolution_rejected', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'AUTHORIZE_HIGH_RISK_RESOLUTION', authorizationRole, 'HUMAN_REVIEW', authorization === null ? 'human_authority_required' : 'stale_or_invalid_authorization');
    return decision(true, 'RESOLVED', 'human_safety.transitioned.resolved', requiredAuthority, requiredAuthority, resolutionRole, 'REJECT', 'approved');
  }
  return decision(true, requestedState, `human_safety.transitioned.${requestedState.toLowerCase()}`, requiredAuthority, requiredAuthority, authorizedByRole, 'REJECT', 'approved');
}

export function validateHumanSafetySignalEnvelope(input: unknown): HumanSafetySignalValidationDecision {
  if (!isRecord(input)) return signalDecision(false, 'QUARANTINE', 'invalid_envelope');
  const envelopeKeys = new Set(['signalId', 'schemaVersion', 'purposePolicyVersion', 'dataClassification', 'retentionClass', 'sourceType', 'sourceId', 'occurredAt', 'receivedAt', 'consentBasis', 'integrity', 'location', 'payload']);
  if (Object.keys(input).some((key) => !envelopeKeys.has(key))) return signalDecision(false, 'QUARANTINE', 'unknown_envelope_field');
  if (input.schemaVersion !== 'ros-eye.signal.v1' || input.purposePolicyVersion !== 'ros-eye.purpose.v1') return signalDecision(false, 'QUARANTINE', 'unsupported_policy_or_schema');
  if (!validIdentifier(input.signalId) || !validIdentifier(input.sourceId)) return signalDecision(false, 'QUARANTINE', 'invalid_identifier');
  const occurredAt = typeof input.occurredAt === 'string' ? parseTimestamp(input.occurredAt) : null;
  const receivedAt = typeof input.receivedAt === 'string' ? parseTimestamp(input.receivedAt) : null;
  if (occurredAt === null || receivedAt === null || occurredAt > receivedAt) return signalDecision(false, 'QUARANTINE', 'invalid_signal_chronology');
  if (!isRecord(input.integrity) || Object.keys(input.integrity).some((key) => !['replayToken', 'signatureStatus', 'clockSkewMs'].includes(key)) || !nonEmpty(input.integrity.replayToken) || !finiteNumber(input.integrity.clockSkewMs)) return signalDecision(false, 'QUARANTINE', 'invalid_integrity_metadata');
  if (!['VERIFIED', 'UNVERIFIED', 'INVALID'].includes(String(input.integrity.signatureStatus))) return signalDecision(false, 'QUARANTINE', 'invalid_integrity_metadata');
  if (input.integrity.signatureStatus === 'INVALID') return signalDecision(false, 'QUARANTINE', 'invalid_signature');
  if (input.integrity.signatureStatus !== 'VERIFIED') return signalDecision(false, 'HUMAN_REVIEW', 'signature_unverified');
  if (Math.abs(input.integrity.clockSkewMs) > HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS) return signalDecision(false, 'HUMAN_REVIEW', 'clock_skew_exceeded');
  if (!validLocation(input.location)) return signalDecision(false, 'QUARANTINE', 'invalid_location');
  if (!isRecord(input.payload) || typeof input.payload.kind !== 'string') return signalDecision(false, 'QUARANTINE', 'invalid_payload');
  if (!payloadMatchesSource(input.sourceType, input.payload.kind)) return signalDecision(false, 'HUMAN_REVIEW', 'source_payload_mismatch');
  const allowedPayloadKeys = payloadKeys(input.payload.kind);
  if (allowedPayloadKeys === null || Object.keys(input.payload).some((key) => !allowedPayloadKeys.has(key))) return signalDecision(false, 'QUARANTINE', 'unknown_or_sensitive_payload_field');
  if (!validPayload(input.payload)) return signalDecision(false, 'QUARANTINE', 'invalid_payload_value');
  if (!validPurposeBoundary(input)) return signalDecision(false, 'QUARANTINE', 'purpose_classification_mismatch');
  return signalDecision(false, 'HUMAN_REVIEW', 'structurally_valid_replay_check_required');
}

export async function acceptHumanSafetySignalEnvelope(input: unknown, ports: HumanSafetySignalAcceptancePorts, evaluatedAt: string): Promise<HumanSafetySignalAcceptanceDecision> {
  const structural = validateHumanSafetySignalEnvelope(input);
  if (structural.reasonCode !== 'structurally_valid_replay_check_required' || !isHumanSafetySignalEnvelope(input)) return acceptanceDecision(structural, null, 'NOT_ATTEMPTED', null);
  const evaluatedAtMs = parseTimestamp(evaluatedAt);
  const occurredAtMs = parseTimestamp(input.occurredAt);
  const receivedAtMs = parseTimestamp(input.receivedAt);
  if (evaluatedAtMs === null || occurredAtMs === null || receivedAtMs === null) return acceptanceDecision(signalDecision(false, 'QUARANTINE', 'invalid_acceptance_time'), null, 'NOT_ATTEMPTED', null);

  const latestTrustedSenderTimeMs = evaluatedAtMs + HUMAN_SAFETY_ALLOWED_CLOCK_SKEW_MS;
  if (receivedAtMs > latestTrustedSenderTimeMs || occurredAtMs > latestTrustedSenderTimeMs) {
    return acceptanceDecision(signalDecision(false, 'QUARANTINE', 'signal_timestamp_in_future'), null, 'NOT_ATTEMPTED', null);
  }
  if (evaluatedAtMs - occurredAtMs > HUMAN_SAFETY_MAX_SIGNAL_AGE_MS) {
    return acceptanceDecision(signalDecision(false, 'HUMAN_REVIEW', 'stale_signal_requires_human_review'), null, 'NOT_ATTEMPTED', null);
  }

  const trustedReplayBaseMs = Math.min(receivedAtMs, evaluatedAtMs);
  const expiresAtMs = trustedReplayBaseMs + HUMAN_SAFETY_REPLAY_TTL_MS;
  const replayExpiresAt = new Date(expiresAtMs).toISOString();
  if (evaluatedAtMs >= expiresAtMs) return acceptanceDecision(signalDecision(false, 'QUARANTINE', 'replay_token_expired'), null, 'EXPIRED', replayExpiresAt);

  try {
    const nonceDigest = await ports.tokenDigester.digest(input.integrity.replayToken);
    if (!validDigest(nonceDigest)) return acceptanceDecision(signalDecision(false, 'QUARANTINE', 'invalid_replay_token_digest'), null, 'UNAVAILABLE', replayExpiresAt);
    const scopeMaterial = [HUMAN_SAFETY_REPLAY_POLICY_VERSION, input.sourceId, input.signalId, input.schemaVersion, input.purposePolicyVersion, String(HUMAN_SAFETY_REPLAY_TTL_MS)].join('|');
    const scopeDigest = await ports.tokenDigester.digest(scopeMaterial);
    if (!validDigest(scopeDigest)) return acceptanceDecision(signalDecision(false, 'QUARANTINE', 'invalid_replay_scope_digest'), null, 'UNAVAILABLE', replayExpiresAt);
    const consumeResult = await ports.replayRegistry.consume({ policyVersion: HUMAN_SAFETY_REPLAY_POLICY_VERSION, nonceDigest, scopeDigest, expiresAt: replayExpiresAt });
    if (consumeResult !== 'CONSUMED') {
      const reasonCode = consumeResult === 'DUPLICATE' ? 'replay_detected' : consumeResult === 'EXPIRED' ? 'replay_token_expired' : 'replay_registry_unavailable';
      return acceptanceDecision(signalDecision(false, consumeResult === 'UNAVAILABLE' ? 'HUMAN_REVIEW' : 'QUARANTINE', reasonCode), scopeDigest, consumeResult, replayExpiresAt);
    }
    return acceptanceDecision(signalDecision(true, 'ACCEPT', 'accepted_after_atomic_replay_consume'), scopeDigest, consumeResult, replayExpiresAt);
  } catch {
    return acceptanceDecision(signalDecision(false, 'HUMAN_REVIEW', 'replay_registry_unavailable'), null, 'UNAVAILABLE', replayExpiresAt);
  }
}

function validUncertaintyResolution(current: Pick<HumanSafetyCaseContract, 'id' | 'version' | 'severityAssessmentVersion' | 'evidenceRevision' | 'indicatorRevision'>, context: HumanSafetyTransitionContext): boolean {
  const authorization = context.uncertaintyResolutionAuthorization;
  if (authorization === undefined) return false;
  const occurredAt = parseTimestamp(context.occurredAt), authorizedAt = parseTimestamp(authorization.authorizedAt), expiresAt = parseTimestamp(authorization.expiresAt);
  return occurredAt !== null && authorizedAt !== null && expiresAt !== null && authorizedAt <= occurredAt && occurredAt < expiresAt && authorizedAt < expiresAt && authorization.caseId === current.id && authorization.decision === 'ALLOW_MONITORING' && authorization.actorId === context.actorId && context.actorRoles.includes(authorization.role) && authorizedRole(context.actorRoles, 'MONITOR') !== null && authorization.policyVersion === HUMAN_SAFETY_UNCERTAINTY_POLICY_VERSION && authorization.caseVersion === current.version && authorization.severityAssessmentVersion === current.severityAssessmentVersion && authorization.evidenceRevision === current.evidenceRevision && authorization.indicatorRevision === current.indicatorRevision && authorization.resolvedEvidenceQuality === context.evidenceQuality;
}
function authorityForTransition(current: HumanSafetyCaseState, requested: HumanSafetyCaseState): HumanSafetyAuthority | null { return TRANSITION_AUTHORITIES[`${current}->${requested}`] ?? null }
function authorizedRole(roles: readonly HumanSafetyActorRole[], authority: HumanSafetyAuthority): HumanSafetyActorRole | null { for (const role of ROLE_PRIORITY) if (roles.includes(role) && HUMAN_SAFETY_ROLE_AUTHORITIES[role].includes(authority)) return role; return null }
function payloadMatchesSource(sourceType: unknown, kind: string): boolean { return (sourceType === 'PHONE' && kind === 'PHONE_MOTION') || (sourceType === 'VEHICLE' && kind === 'VEHICLE_EVENT') || (sourceType === 'PERSON' && kind === 'PERSON_REPORT') || (sourceType === 'OPERATOR' && kind === 'OPERATOR_OBSERVATION') || (sourceType === 'INFRASTRUCTURE' && kind === 'INFRASTRUCTURE_METADATA') || (sourceType === 'SIMULATION' && kind === 'SIMULATION_FIXTURE') }
function payloadKeys(kind: string): ReadonlySet<string> | null { const keys: Record<string, readonly string[]> = { PHONE_MOTION: ['kind', 'accelerationMagnitude', 'impactDetected'], VEHICLE_EVENT: ['kind', 'eventCode', 'confidence'], PERSON_REPORT: ['kind', 'indicatorCodes'], OPERATOR_OBSERVATION: ['kind', 'indicatorCodes'], INFRASTRUCTURE_METADATA: ['kind', 'sensorType', 'confidence'], SIMULATION_FIXTURE: ['kind', 'fixtureId'] }; return keys[kind] === undefined ? null : new Set(keys[kind]) }
function validPayload(payload: Record<string, unknown>): boolean { if (payload.kind === 'PHONE_MOTION') return finiteNumber(payload.accelerationMagnitude) && payload.accelerationMagnitude >= 0 && typeof payload.impactDetected === 'boolean'; if (payload.kind === 'VEHICLE_EVENT') return ['IMPACT', 'AIRBAG', 'HARD_BRAKE', 'ROLLOVER'].includes(String(payload.eventCode)) && probability(payload.confidence); if (payload.kind === 'PERSON_REPORT' || payload.kind === 'OPERATOR_OBSERVATION') return validIndicatorCodes(payload.indicatorCodes); if (payload.kind === 'INFRASTRUCTURE_METADATA') return ['CAMERA_METADATA', 'ROAD_SENSOR'].includes(String(payload.sensorType)) && probability(payload.confidence); if (payload.kind === 'SIMULATION_FIXTURE') return validIdentifier(payload.fixtureId); return false }
function validIndicatorCodes(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every((code) => typeof code === 'string' && SAFETY_INDICATOR_CODES.has(code as SafetyIndicatorCode)) }
function validLocation(value: unknown): boolean { if (value === null) return true; if (!isRecord(value)) return false; const allowed = new Set(['latitude', 'longitude', 'accuracyMeters', 'classification']); return Object.keys(value).every((key) => allowed.has(key)) && finiteNumber(value.latitude) && value.latitude >= -90 && value.latitude <= 90 && finiteNumber(value.longitude) && value.longitude >= -180 && value.longitude <= 180 && finiteNumber(value.accuracyMeters) && value.accuracyMeters > 0 && value.accuracyMeters <= 100_000 && value.classification === 'PRECISE_RESTRICTED' }
function validPurposeBoundary(input: Record<string, unknown>): boolean { if (input.sourceType === 'SIMULATION') return input.consentBasis === 'SIMULATION' && input.retentionClass === 'SIMULATION_ONLY' && input.dataClassification === 'OPERATIONAL' && input.location === null; if (input.sourceType === 'OPERATOR') return input.consentBasis === 'OPERATOR_ENTERED' && input.retentionClass === 'SHORT_LIVED_SIGNAL_METADATA' && input.dataClassification === 'SENSITIVE_RESTRICTED'; return ['EXPLICIT', 'EMERGENCY_SAFETY_REVIEW'].includes(String(input.consentBasis)) && input.retentionClass === 'SHORT_LIVED_SIGNAL_METADATA' && input.dataClassification === 'SENSITIVE_RESTRICTED' }
function isHumanSafetySignalEnvelope(value: unknown): value is HumanSafetySignalEnvelope { return isRecord(value) && isRecord(value.integrity) && typeof value.signalId === 'string' && typeof value.sourceId === 'string' && typeof value.occurredAt === 'string' && typeof value.receivedAt === 'string' && typeof value.integrity.replayToken === 'string' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function probability(value: unknown): boolean { return finiteNumber(value) && value >= 0 && value <= 1 }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function validIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value) }
function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) }
function parseTimestamp(value: string): number | null { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null }
function signalDecision(accepted: boolean, disposition: HumanSafetySignalValidationDecision['disposition'], reasonCode: string): HumanSafetySignalValidationDecision { return { accepted, disposition, reasonCode } }
function acceptanceDecision(structural: HumanSafetySignalValidationDecision, replayScopeDigest: string | null, replayConsumeResult: HumanSafetySignalAcceptanceDecision['replayConsumeResult'], replayExpiresAt: string | null): HumanSafetySignalAcceptanceDecision {
  return {
    ...structural,
    replayPolicyVersion: HUMAN_SAFETY_REPLAY_POLICY_VERSION,
    temporalPolicyVersion: HUMAN_SAFETY_TEMPORAL_POLICY_VERSION,
    replayScopeDigest,
    replayConsumeResult,
    replayExpiresAt
  };
}
function decision(allowed: boolean, nextState: HumanSafetyCaseState, auditAction: string, requiredAuthority: HumanSafetyAuthority | null, evaluatedAuthority: HumanSafetyAuthority | null, authorizedByRole: HumanSafetyActorRole | null, failureBehavior: HumanSafetyTransitionDecision['failureBehavior'], reasonCode: string): HumanSafetyTransitionDecision { return { allowed, nextState, auditAction, requiredAuthority, evaluatedAuthority, authorizedByRole, authorityPolicyVersion: HUMAN_SAFETY_AUTHORITY_POLICY_VERSION, failureBehavior, reasonCode } }
