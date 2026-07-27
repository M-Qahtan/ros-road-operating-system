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
  | 'UPDATE_CONTACT_OUTCOME'
  | 'RECORD_STRUCTURED_INDICATOR'
  | 'ESCALATE'
  | 'TAKE_OVER_CONTACT'
  | 'TRANSFER'
  | 'MONITOR'
  | 'AUTHORIZE_HIGH_RISK_RESOLUTION'
  | 'RESOLVE';

export const HUMAN_SAFETY_AUTHORITY_POLICY_VERSION = 'ros-eye.authority.v2' as const;

export const HUMAN_SAFETY_ROLE_AUTHORITIES: Readonly<Record<HumanSafetyActorRole, readonly HumanSafetyAuthority[]>> = Object.freeze({
  SYSTEM: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'ESCALATE'],
  OPERATOR: ['START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'RESOLVE'],
  SUPERVISOR: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'RESOLVE'],
  SAFETY_LEAD: ['OPEN_CASE', 'START_CONTACT', 'UPDATE_CONTACT_OUTCOME', 'RECORD_STRUCTURED_INDICATOR', 'ESCALATE', 'TAKE_OVER_CONTACT', 'TRANSFER', 'MONITOR', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'RESOLVE'],
  AUDITOR: [],
  SIMULATED_CHANNEL: ['RECORD_STRUCTURED_INDICATOR']
});

export type HumanSafetyReactivationCause =
  | 'LATE_HIGH_RISK_SIGNAL'
  | 'CONTRADICTORY_INDICATOR'
  | 'EVIDENCE_CORRECTION'
  | 'DEPENDENCY_RECOVERY_FINDING';

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

const SAFETY_INDICATOR_CODES = new Set<SafetyIndicatorCode>([
  'PERSON_RESPONDED',
  'PERSON_NOT_RESPONDING',
  'COMMUNICATION_INTERRUPTED',
  'HELP_REQUESTED',
  'POSSIBLE_IMMEDIATE_DANGER',
  'LOCATION_UNCERTAIN',
  'MULTIPLE_PEOPLE_REPORTED',
  'CONTRADICTORY_RESPONSE',
  'ACCESSIBILITY_SUPPORT_REQUIRED'
]);

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
  readonly reactivationCause?: HumanSafetyReactivationCause;
}

export interface HumanSafetyTransitionDecision {
  readonly allowed: boolean;
  readonly nextState: HumanSafetyCaseState;
  readonly auditAction: string;
  readonly requiredAuthority: HumanSafetyAuthority | null;
  readonly evaluatedAuthority: HumanSafetyAuthority | null;
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
  readonly payload: HumanSafetySignalPayload;
}

export interface HumanSafetySignalValidationDecision {
  readonly accepted: boolean;
  readonly disposition: 'ACCEPT' | 'QUARANTINE' | 'HUMAN_REVIEW';
  readonly reasonCode: string;
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
  RESOLVED: ['HUMAN_REVIEW', 'ESCALATED']
});

const TRANSITION_AUTHORITIES: Readonly<Record<string, HumanSafetyAuthority>> = Object.freeze({
  'UNKNOWN->CONTACT_PENDING': 'OPEN_CASE',
  'UNKNOWN->HUMAN_REVIEW': 'ESCALATE',
  'UNKNOWN->ESCALATED': 'ESCALATE',
  'CONTACT_PENDING->CONTACTING': 'START_CONTACT',
  'CONTACT_PENDING->HUMAN_REVIEW': 'ESCALATE',
  'CONTACT_PENDING->ESCALATED': 'ESCALATE',
  'CONTACTING->RESPONDED': 'UPDATE_CONTACT_OUTCOME',
  'CONTACTING->NO_RESPONSE': 'UPDATE_CONTACT_OUTCOME',
  'CONTACTING->UNREACHABLE': 'UPDATE_CONTACT_OUTCOME',
  'CONTACTING->HUMAN_REVIEW': 'ESCALATE',
  'CONTACTING->ESCALATED': 'ESCALATE',
  'RESPONDED->HUMAN_REVIEW': 'ESCALATE',
  'RESPONDED->ESCALATED': 'ESCALATE',
  'RESPONDED->TRANSFERRED': 'TRANSFER',
  'RESPONDED->MONITORED': 'MONITOR',
  'NO_RESPONSE->CONTACTING': 'START_CONTACT',
  'NO_RESPONSE->HUMAN_REVIEW': 'ESCALATE',
  'NO_RESPONSE->ESCALATED': 'ESCALATE',
  'UNREACHABLE->CONTACTING': 'START_CONTACT',
  'UNREACHABLE->HUMAN_REVIEW': 'ESCALATE',
  'UNREACHABLE->ESCALATED': 'ESCALATE',
  'HUMAN_REVIEW->ESCALATED': 'ESCALATE',
  'HUMAN_REVIEW->TRANSFERRED': 'TRANSFER',
  'HUMAN_REVIEW->MONITORED': 'MONITOR',
  'ESCALATED->TRANSFERRED': 'TRANSFER',
  'ESCALATED->MONITORED': 'MONITOR',
  'TRANSFERRED->MONITORED': 'MONITOR',
  'MONITORED->HUMAN_REVIEW': 'ESCALATE',
  'MONITORED->ESCALATED': 'ESCALATE',
  'MONITORED->RESOLVED': 'RESOLVE',
  'RESOLVED->HUMAN_REVIEW': 'ESCALATE',
  'RESOLVED->ESCALATED': 'ESCALATE'
});

const HIGH_RISK = new Set(['S3', 'S4']);
const REACTIVATION_CAUSES = new Set<HumanSafetyReactivationCause>([
  'LATE_HIGH_RISK_SIGNAL',
  'CONTRADICTORY_INDICATOR',
  'EVIDENCE_CORRECTION',
  'DEPENDENCY_RECOVERY_FINDING'
]);

export function decideHumanSafetyTransition(
  current: Pick<HumanSafetyCaseContract, 'id' | 'state' | 'severity' | 'version' | 'severityAssessmentVersion' | 'evidenceRevision' | 'indicatorRevision' | 'highRiskResolutionAuthorization'>,
  requestedState: HumanSafetyCaseState,
  context: HumanSafetyTransitionContext
): HumanSafetyTransitionDecision {
  const allowedTargets = HUMAN_SAFETY_ALLOWED_TRANSITIONS[current.state];
  if (!allowedTargets.includes(requestedState)) {
    return decision(false, current.state, 'human_safety.transition_rejected', null, null, 'REJECT', 'invalid_transition');
  }

  const requiredAuthority = authorityForTransition(current.state, requestedState);
  if (requiredAuthority === null) {
    return decision(false, current.state, 'human_safety.authority_policy_missing', null, null, 'REJECT', 'transition_authority_undefined');
  }
  if (!actorHasAuthority(context.actorRoles, requiredAuthority)) {
    return decision(false, current.state, 'human_safety.authority_rejected', requiredAuthority, requiredAuthority, 'REJECT', 'actor_not_authorized');
  }

  if (current.state === 'RESOLVED') {
    const cause = context.reactivationCause;
    if (cause === undefined || !REACTIVATION_CAUSES.has(cause)) {
      return decision(false, current.state, 'human_safety.reactivation_rejected', requiredAuthority, requiredAuthority, 'REJECT', 'reactivation_cause_required');
    }
    return decision(
      true,
      requestedState,
      requestedState === 'ESCALATED' ? 'human_safety.resolved_case_escalated' : 'human_safety.resolved_case_reopened_for_review',
      requiredAuthority,
      requiredAuthority,
      requestedState === 'ESCALATED' ? 'ESCALATE' : 'HUMAN_REVIEW',
      `reactivated_${cause.toLowerCase()}`
    );
  }

  if (!context.dependenciesHealthy && requestedState === 'RESOLVED') {
    return decision(false, 'ESCALATED', 'human_safety.unsafe_resolution_blocked', 'ESCALATE', 'ESCALATE', 'ESCALATE', 'dependency_unhealthy');
  }
  if (context.connectivity === 'LOST' && !['HUMAN_REVIEW', 'ESCALATED'].includes(requestedState)) {
    return decision(false, 'ESCALATED', 'human_safety.connectivity_loss_escalated', 'ESCALATE', 'ESCALATE', 'ESCALATE', 'connectivity_lost');
  }
  if (['AMBIGUOUS', 'CONFLICTING', 'MISSING'].includes(context.evidenceQuality) && requestedState === 'RESOLVED') {
    return decision(false, 'HUMAN_REVIEW', 'human_safety.ambiguous_resolution_blocked', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'HUMAN_REVIEW', 'evidence_not_trusted');
  }

  if (requestedState === 'RESOLVED' && HIGH_RISK.has(current.severity)) {
    const authorization = current.highRiskResolutionAuthorization;
    const occurredAtMs = parseTimestamp(context.occurredAt);
    const authorizedAtMs = authorization === null ? null : parseTimestamp(authorization.authorizedAt);
    const expiresAtMs = authorization === null ? null : parseTimestamp(authorization.expiresAt);
    const authorizationChronologyValid = authorization !== null &&
      authorizedAtMs !== null && expiresAtMs !== null && occurredAtMs !== null &&
      authorizedAtMs <= occurredAtMs && occurredAtMs < expiresAtMs && authorizedAtMs < expiresAtMs;
    const authorizationFresh = authorization !== null &&
      authorization.caseId === current.id && authorization.decision === 'RESOLVE' &&
      authorization.caseVersion === current.version &&
      authorization.severityAssessmentVersion === current.severityAssessmentVersion &&
      authorization.evidenceRevision === current.evidenceRevision &&
      authorization.indicatorRevision === current.indicatorRevision &&
      authorization.connectivity === context.connectivity &&
      authorization.dependenciesHealthy === context.dependenciesHealthy &&
      authorization.actorId === context.actorId &&
      context.actorRoles.includes(authorization.role) &&
      authorizationChronologyValid;
    const actorAuthorized = actorHasAuthority(context.actorRoles, 'AUTHORIZE_HIGH_RISK_RESOLUTION') && actorHasAuthority(context.actorRoles, 'RESOLVE');
    if (!authorizationFresh || !actorAuthorized) {
      return decision(false, 'HUMAN_REVIEW', 'human_safety.high_risk_resolution_rejected', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'AUTHORIZE_HIGH_RISK_RESOLUTION', 'HUMAN_REVIEW', authorization === null ? 'human_authority_required' : 'stale_or_invalid_authorization');
    }
  }

  return decision(true, requestedState, `human_safety.transitioned.${requestedState.toLowerCase()}`, requiredAuthority, requiredAuthority, 'REJECT', 'approved');
}

export function validateHumanSafetySignalEnvelope(input: unknown): HumanSafetySignalValidationDecision {
  if (!isRecord(input)) return signalDecision(false, 'QUARANTINE', 'invalid_envelope');
  const allowedEnvelopeKeys = new Set(['signalId', 'schemaVersion', 'purposePolicyVersion', 'dataClassification', 'retentionClass', 'sourceType', 'sourceId', 'occurredAt', 'receivedAt', 'consentBasis', 'integrity', 'location', 'payload']);
  if (Object.keys(input).some((key) => !allowedEnvelopeKeys.has(key))) return signalDecision(false, 'QUARANTINE', 'unknown_envelope_field');
  if (input.schemaVersion !== 'ros-eye.signal.v1' || input.purposePolicyVersion !== 'ros-eye.purpose.v1') return signalDecision(false, 'QUARANTINE', 'unsupported_policy_or_schema');
  if (!nonEmpty(input.signalId) || !nonEmpty(input.sourceId)) return signalDecision(false, 'QUARANTINE', 'missing_identifier');

  const occurredAt = typeof input.occurredAt === 'string' ? parseTimestamp(input.occurredAt) : null;
  const receivedAt = typeof input.receivedAt === 'string' ? parseTimestamp(input.receivedAt) : null;
  if (occurredAt === null || receivedAt === null || occurredAt > receivedAt) return signalDecision(false, 'QUARANTINE', 'invalid_signal_chronology');

  if (!isRecord(input.integrity) || !nonEmpty(input.integrity.replayToken) || !finiteNumber(input.integrity.clockSkewMs)) {
    return signalDecision(false, 'QUARANTINE', 'invalid_integrity_metadata');
  }
  if (input.integrity.signatureStatus === 'INVALID') return signalDecision(false, 'QUARANTINE', 'invalid_signature');
  if (input.integrity.signatureStatus !== 'VERIFIED') return signalDecision(false, 'HUMAN_REVIEW', 'signature_unverified');
  if (Math.abs(input.integrity.clockSkewMs) > 300_000) return signalDecision(false, 'HUMAN_REVIEW', 'clock_skew_exceeded');

  if (!validLocation(input.location)) return signalDecision(false, 'QUARANTINE', 'invalid_location');
  if (!isRecord(input.payload) || typeof input.payload.kind !== 'string') return signalDecision(false, 'QUARANTINE', 'invalid_payload');
  if (!payloadMatchesSource(input.sourceType, input.payload.kind)) return signalDecision(false, 'HUMAN_REVIEW', 'source_payload_mismatch');
  const allowedPayloadKeys = payloadKeys(input.payload.kind);
  if (allowedPayloadKeys === null || Object.keys(input.payload).some((key) => !allowedPayloadKeys.has(key))) return signalDecision(false, 'QUARANTINE', 'unknown_or_sensitive_payload_field');
  if (!validPayload(input.payload)) return signalDecision(false, 'QUARANTINE', 'invalid_payload_value');
  if (!validPurposeBoundary(input)) return signalDecision(false, 'QUARANTINE', 'purpose_classification_mismatch');

  return signalDecision(true, 'ACCEPT', 'accepted');
}

function authorityForTransition(currentState: HumanSafetyCaseState, requestedState: HumanSafetyCaseState): HumanSafetyAuthority | null {
  return TRANSITION_AUTHORITIES[`${currentState}->${requestedState}`] ?? null;
}

function actorHasAuthority(roles: readonly HumanSafetyActorRole[], authority: HumanSafetyAuthority): boolean {
  return roles.some((role) => HUMAN_SAFETY_ROLE_AUTHORITIES[role].includes(authority));
}

function payloadMatchesSource(sourceType: unknown, kind: string): boolean {
  return (sourceType === 'PHONE' && kind === 'PHONE_MOTION') ||
    (sourceType === 'VEHICLE' && kind === 'VEHICLE_EVENT') ||
    (sourceType === 'PERSON' && kind === 'PERSON_REPORT') ||
    (sourceType === 'OPERATOR' && kind === 'OPERATOR_OBSERVATION') ||
    (sourceType === 'INFRASTRUCTURE' && kind === 'INFRASTRUCTURE_METADATA') ||
    (sourceType === 'SIMULATION' && kind === 'SIMULATION_FIXTURE');
}

function payloadKeys(kind: string): ReadonlySet<string> | null {
  const keys: Record<string, readonly string[]> = {
    PHONE_MOTION: ['kind', 'accelerationMagnitude', 'impactDetected'],
    VEHICLE_EVENT: ['kind', 'eventCode', 'confidence'],
    PERSON_REPORT: ['kind', 'indicatorCodes'],
    OPERATOR_OBSERVATION: ['kind', 'indicatorCodes'],
    INFRASTRUCTURE_METADATA: ['kind', 'sensorType', 'confidence'],
    SIMULATION_FIXTURE: ['kind', 'fixtureId']
  };
  return keys[kind] === undefined ? null : new Set(keys[kind]);
}

function validPayload(payload: Record<string, unknown>): boolean {
  if (payload.kind === 'PHONE_MOTION') return finiteNumber(payload.accelerationMagnitude) && payload.accelerationMagnitude >= 0 && typeof payload.impactDetected === 'boolean';
  if (payload.kind === 'VEHICLE_EVENT') return ['IMPACT', 'AIRBAG', 'HARD_BRAKE', 'ROLLOVER'].includes(String(payload.eventCode)) && probability(payload.confidence);
  if (payload.kind === 'PERSON_REPORT' || payload.kind === 'OPERATOR_OBSERVATION') return validIndicatorCodes(payload.indicatorCodes);
  if (payload.kind === 'INFRASTRUCTURE_METADATA') return ['CAMERA_METADATA', 'ROAD_SENSOR'].includes(String(payload.sensorType)) && probability(payload.confidence);
  if (payload.kind === 'SIMULATION_FIXTURE') return nonEmpty(payload.fixtureId);
  return false;
}

function validIndicatorCodes(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((code) => typeof code === 'string' && SAFETY_INDICATOR_CODES.has(code as SafetyIndicatorCode));
}

function validLocation(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const allowed = new Set(['latitude', 'longitude', 'accuracyMeters', 'classification']);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    finiteNumber(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    finiteNumber(value.longitude) && value.longitude >= -180 && value.longitude <= 180 &&
    finiteNumber(value.accuracyMeters) && value.accuracyMeters > 0 &&
    value.classification === 'PRECISE_RESTRICTED';
}

function validPurposeBoundary(input: Record<string, unknown>): boolean {
  if (input.sourceType === 'SIMULATION') {
    return input.consentBasis === 'SIMULATION' && input.retentionClass === 'SIMULATION_ONLY' && input.dataClassification === 'OPERATIONAL' && input.location === null;
  }
  if (input.sourceType === 'OPERATOR') {
    return input.consentBasis === 'OPERATOR_ENTERED' && input.retentionClass === 'SHORT_LIVED_SIGNAL_METADATA' && input.dataClassification === 'SENSITIVE_RESTRICTED';
  }
  return ['EXPLICIT', 'EMERGENCY_SAFETY_REVIEW'].includes(String(input.consentBasis)) &&
    input.retentionClass === 'SHORT_LIVED_SIGNAL_METADATA' &&
    input.dataClassification === 'SENSITIVE_RESTRICTED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function probability(value: unknown): boolean {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signalDecision(accepted: boolean, disposition: HumanSafetySignalValidationDecision['disposition'], reasonCode: string): HumanSafetySignalValidationDecision {
  return { accepted, disposition, reasonCode };
}

function decision(
  allowed: boolean,
  nextState: HumanSafetyCaseState,
  auditAction: string,
  requiredAuthority: HumanSafetyAuthority | null,
  evaluatedAuthority: HumanSafetyAuthority | null,
  failureBehavior: HumanSafetyTransitionDecision['failureBehavior'],
  reasonCode: string
): HumanSafetyTransitionDecision {
  return {
    allowed,
    nextState,
    auditAction,
    requiredAuthority,
    evaluatedAuthority,
    authorityPolicyVersion: HUMAN_SAFETY_AUTHORITY_POLICY_VERSION,
    failureBehavior,
    reasonCode
  };
}
