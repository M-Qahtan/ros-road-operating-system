import type { HumanSafetyActorRole, HumanSafetyChannel } from './human-safety.js';

export const HUMAN_CONTACT_PROTOCOL_VERSION = 'ros-eye.contact.v1' as const;
export const HUMAN_CONTACT_PROMPT_POLICY_VERSION = 'ros-eye.contact-prompts.v1' as const;
export const HUMAN_CONTACT_ACCESSIBILITY_POLICY_VERSION = 'ros-eye.accessibility.v1' as const;
export const HUMAN_CONTACT_AUTHORITY_POLICY_VERSION = 'ros-eye.contact-authority.v1' as const;
export const HUMAN_CONTACT_REPLY_TIME_POLICY_VERSION = 'ros-eye.contact-reply-time.v1' as const;
export const HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION = 'ros-eye.contact-reply-replay.v1' as const;
export const HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS = 3;
export const HUMAN_CONTACT_RESPONSE_DEADLINE_MS = 30_000;
export const HUMAN_CONTACT_RETRY_BASE_DELAY_MS = 15_000;
export const HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const HUMAN_CONTACT_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const HUMAN_CONTACT_REPLY_TTL_MS = 24 * 60 * 60 * 1000;

export type HumanContactState =
  | 'CREATED' | 'CONSENT_PENDING' | 'LANGUAGE_SELECTION' | 'CONTACTING'
  | 'AWAITING_RESPONSE' | 'PARTIAL_RESPONSE' | 'RESPONSE_CONFIRMED'
  | 'DISCONNECTED' | 'NO_RESPONSE' | 'UNREACHABLE' | 'OPERATOR_TAKEOVER'
  | 'HUMAN_REVIEW' | 'ESCALATED' | 'COMPLETED';

export type HumanContactLanguage = 'ar' | 'en' | 'UNKNOWN';
export type HumanContactIdentityConfidence = 'UNVERIFIED' | 'PARTIAL' | 'CONFIRMED';
export type HumanContactPromptPurpose = 'CONSENT' | 'LANGUAGE' | 'REASSURANCE' | 'SAFETY_INDICATOR' | 'ACCESSIBILITY' | 'HANDOFF_NOTICE';
export type HumanContactDataClassification = 'OPERATIONAL' | 'SENSITIVE_RESTRICTED';
export type HumanContactRetentionClass = 'SESSION_METADATA' | 'SHORT_LIVED_STRUCTURED_REPLY' | 'GOVERNANCE_PLACEHOLDER';
export type HumanContactReplyOption = 'YES' | 'NO' | 'UNKNOWN' | 'HELP_REQUESTED' | 'CANNOT_SPEAK' | 'ACCESSIBILITY_SUPPORT_REQUIRED';
export type HumanContactAuthority = 'START_CONTACT' | 'RECORD_RESPONSE' | 'RETRY_CONTACT' | 'ESCALATE_CONTACT' | 'TAKE_OVER_CONTACT' | 'COMPLETE_CONTACT';

export interface HumanContactAccessibilityProfile {
  readonly screenReaderRequired: boolean;
  readonly handsFreeRequired: boolean;
  readonly largeControlsRequired: boolean;
  readonly simpleLanguageRequired: boolean;
  readonly visualAlternativeRequired: boolean;
  readonly audioAlternativeRequired: boolean;
}

export interface HumanContactPromptContract {
  readonly promptId: string;
  readonly version: number;
  readonly locale: HumanContactLanguage;
  readonly purpose: HumanContactPromptPurpose;
  readonly userFacingText: string;
  readonly operatorFactCode: string;
  readonly allowedReplyOptions: readonly HumanContactReplyOption[];
  readonly dataClassification: HumanContactDataClassification;
  readonly retentionClass: HumanContactRetentionClass;
  readonly escalationEffect: 'NONE' | 'HUMAN_REVIEW' | 'ESCALATE';
  readonly governanceStatus: 'PLACEHOLDER_NOT_APPROVED';
  readonly accessibility: HumanContactAccessibilityProfile;
}

export const HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS: readonly HumanContactPromptContract[] = Object.freeze([
  prompt('contact.consent', 1, 'CONSENT', 'نحن هنا للاطمئنان على سلامتك. هل تسمح ببدء التحقق المختصر؟', ['YES', 'NO', 'UNKNOWN'], 'HUMAN_REVIEW'),
  prompt('contact.reassurance', 1, 'REASSURANCE', 'ابقَ في مكان آمن إن استطعت. سنطرح أسئلة قصيرة فقط لتحديد مستوى المساعدة البشرية المطلوبة.', ['YES', 'NO', 'UNKNOWN'], 'NONE'),
  prompt('contact.response', 1, 'SAFETY_INDICATOR', 'هل تستطيع الرد الآن؟', ['YES', 'NO', 'CANNOT_SPEAK', 'HELP_REQUESTED', 'UNKNOWN'], 'ESCALATE'),
  prompt('contact.accessibility', 1, 'ACCESSIBILITY', 'هل تحتاج طريقة أسهل للرد أو دعمًا لإمكانية الوصول؟', ['YES', 'NO', 'ACCESSIBILITY_SUPPORT_REQUIRED', 'UNKNOWN'], 'HUMAN_REVIEW'),
  prompt('contact.handoff', 1, 'HANDOFF_NOTICE', 'سيتم تحويل المحادثة إلى مشغل بشري. لا يعني ذلك ضمان وصول جهة طوارئ.', ['YES', 'UNKNOWN'], 'HUMAN_REVIEW')
]);

export interface HumanContactSessionContract {
  readonly sessionId: string;
  readonly caseId: string;
  readonly state: HumanContactState;
  readonly version: number;
  readonly protocolVersion: typeof HUMAN_CONTACT_PROTOCOL_VERSION;
  readonly promptPolicyVersion: typeof HUMAN_CONTACT_PROMPT_POLICY_VERSION;
  readonly accessibilityPolicyVersion: typeof HUMAN_CONTACT_ACCESSIBILITY_POLICY_VERSION;
  readonly language: HumanContactLanguage;
  readonly identityConfidence: HumanContactIdentityConfidence;
  readonly activeChannel: HumanSafetyChannel | null;
  readonly attemptCount: number;
  readonly responseDeadlineAt: string | null;
  readonly lastInteractionAt: string;
  readonly assignedOperatorId: string | null;
  readonly accessibility: HumanContactAccessibilityProfile;
}

export interface HumanContactTransitionContext {
  readonly actorId: string;
  readonly actorRoles: readonly HumanSafetyActorRole[];
  readonly occurredAt: string;
  readonly reason: string;
  readonly traceId: string;
  readonly channelHealthy: boolean;
  readonly accessibilitySatisfied: boolean;
  readonly expectedVersion: number;
}

export interface HumanContactTransitionDecision {
  readonly allowed: boolean;
  readonly nextState: HumanContactState;
  readonly reasonCode: string;
  readonly auditAction: string;
  readonly deadlineAt: string | null;
  readonly requiresHumanAction: boolean;
  readonly requiredAuthority: HumanContactAuthority | null;
  readonly authorizedByRole: HumanSafetyActorRole | null;
  readonly authorityPolicyVersion: typeof HUMAN_CONTACT_AUTHORITY_POLICY_VERSION;
}

export interface HumanContactReplyEnvelope {
  readonly replyId: string;
  readonly sessionId: string;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly idempotencyKey: string;
  readonly receivedAt: string;
  readonly selectedOptions: readonly HumanContactReplyOption[];
}

export type HumanContactReplyConsumeResult = 'CONSUMED' | 'DUPLICATE' | 'UNAVAILABLE';
export interface HumanContactReplyConsumeRequest {
  readonly policyVersion: typeof HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION;
  readonly replyDigest: string;
  readonly scopeDigest: string;
  readonly expiresAt: string;
}
export interface HumanContactReplyRegistryPort { consume(request: HumanContactReplyConsumeRequest): Promise<HumanContactReplyConsumeResult> }
export interface HumanContactDigestPort { digest(value: string): Promise<string> }
export interface HumanContactChannelPort {
  sendStructuredPrompt(session: HumanContactSessionContract, prompt: HumanContactPromptContract): Promise<'SENT' | 'UNAVAILABLE'>;
}
export interface HumanContactOperatorHandoffPort {
  requestTakeover(sessionId: string, caseId: string, reasonCode: string): Promise<'ACKNOWLEDGED' | 'UNAVAILABLE'>;
}

export interface HumanContactReplyAcceptanceDecision {
  readonly accepted: boolean;
  readonly disposition: 'PROCESS' | 'QUARANTINE' | 'HUMAN_REVIEW';
  readonly reasonCode: string;
  readonly consumeResult: HumanContactReplyConsumeResult | 'NOT_ATTEMPTED';
  readonly replayPolicyVersion: typeof HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION;
  readonly timePolicyVersion: typeof HUMAN_CONTACT_REPLY_TIME_POLICY_VERSION;
  readonly replyDigest: string | null;
  readonly scopeDigest: string | null;
}

export const HUMAN_CONTACT_ROLE_AUTHORITIES: Readonly<Record<HumanSafetyActorRole, readonly HumanContactAuthority[]>> = Object.freeze({
  SYSTEM: ['START_CONTACT', 'RECORD_RESPONSE', 'RETRY_CONTACT', 'ESCALATE_CONTACT'],
  OPERATOR: ['START_CONTACT', 'RECORD_RESPONSE', 'RETRY_CONTACT', 'ESCALATE_CONTACT', 'TAKE_OVER_CONTACT', 'COMPLETE_CONTACT'],
  SUPERVISOR: ['START_CONTACT', 'RECORD_RESPONSE', 'RETRY_CONTACT', 'ESCALATE_CONTACT', 'TAKE_OVER_CONTACT', 'COMPLETE_CONTACT'],
  SAFETY_LEAD: ['START_CONTACT', 'RECORD_RESPONSE', 'RETRY_CONTACT', 'ESCALATE_CONTACT', 'TAKE_OVER_CONTACT', 'COMPLETE_CONTACT'],
  AUDITOR: [],
  SIMULATED_CHANNEL: []
});

const ROLE_PRIORITY: readonly HumanSafetyActorRole[] = ['SAFETY_LEAD', 'SUPERVISOR', 'OPERATOR', 'SYSTEM', 'AUDITOR', 'SIMULATED_CHANNEL'];

const ALLOWED: Readonly<Record<HumanContactState, readonly HumanContactState[]>> = Object.freeze({
  CREATED: ['CONSENT_PENDING', 'HUMAN_REVIEW', 'ESCALATED'],
  CONSENT_PENDING: ['LANGUAGE_SELECTION', 'HUMAN_REVIEW', 'ESCALATED'],
  LANGUAGE_SELECTION: ['CONTACTING', 'HUMAN_REVIEW', 'ESCALATED'],
  CONTACTING: ['AWAITING_RESPONSE', 'HUMAN_REVIEW', 'ESCALATED'],
  AWAITING_RESPONSE: ['PARTIAL_RESPONSE', 'RESPONSE_CONFIRMED', 'DISCONNECTED', 'NO_RESPONSE', 'OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED'],
  PARTIAL_RESPONSE: ['AWAITING_RESPONSE', 'RESPONSE_CONFIRMED', 'DISCONNECTED', 'OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED'],
  RESPONSE_CONFIRMED: ['OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED', 'COMPLETED'],
  DISCONNECTED: ['CONTACTING', 'OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED'],
  NO_RESPONSE: ['CONTACTING', 'OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED'],
  UNREACHABLE: ['OPERATOR_TAKEOVER', 'HUMAN_REVIEW', 'ESCALATED'],
  OPERATOR_TAKEOVER: ['HUMAN_REVIEW', 'ESCALATED', 'COMPLETED'],
  HUMAN_REVIEW: ['OPERATOR_TAKEOVER', 'ESCALATED', 'COMPLETED'],
  ESCALATED: ['OPERATOR_TAKEOVER', 'HUMAN_REVIEW'],
  COMPLETED: ['HUMAN_REVIEW', 'ESCALATED']
});

const TRANSITION_AUTHORITIES: Readonly<Record<string, HumanContactAuthority>> = Object.freeze({
  'CREATED->CONSENT_PENDING': 'START_CONTACT', 'CREATED->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'CREATED->ESCALATED': 'ESCALATE_CONTACT',
  'CONSENT_PENDING->LANGUAGE_SELECTION': 'RECORD_RESPONSE', 'CONSENT_PENDING->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'CONSENT_PENDING->ESCALATED': 'ESCALATE_CONTACT',
  'LANGUAGE_SELECTION->CONTACTING': 'START_CONTACT', 'LANGUAGE_SELECTION->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'LANGUAGE_SELECTION->ESCALATED': 'ESCALATE_CONTACT',
  'CONTACTING->AWAITING_RESPONSE': 'START_CONTACT', 'CONTACTING->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'CONTACTING->ESCALATED': 'ESCALATE_CONTACT',
  'AWAITING_RESPONSE->PARTIAL_RESPONSE': 'RECORD_RESPONSE', 'AWAITING_RESPONSE->RESPONSE_CONFIRMED': 'RECORD_RESPONSE', 'AWAITING_RESPONSE->DISCONNECTED': 'RECORD_RESPONSE', 'AWAITING_RESPONSE->NO_RESPONSE': 'RECORD_RESPONSE', 'AWAITING_RESPONSE->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'AWAITING_RESPONSE->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'AWAITING_RESPONSE->ESCALATED': 'ESCALATE_CONTACT',
  'PARTIAL_RESPONSE->AWAITING_RESPONSE': 'RETRY_CONTACT', 'PARTIAL_RESPONSE->RESPONSE_CONFIRMED': 'RECORD_RESPONSE', 'PARTIAL_RESPONSE->DISCONNECTED': 'RECORD_RESPONSE', 'PARTIAL_RESPONSE->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'PARTIAL_RESPONSE->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'PARTIAL_RESPONSE->ESCALATED': 'ESCALATE_CONTACT',
  'RESPONSE_CONFIRMED->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'RESPONSE_CONFIRMED->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'RESPONSE_CONFIRMED->ESCALATED': 'ESCALATE_CONTACT', 'RESPONSE_CONFIRMED->COMPLETED': 'COMPLETE_CONTACT',
  'DISCONNECTED->CONTACTING': 'RETRY_CONTACT', 'DISCONNECTED->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'DISCONNECTED->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'DISCONNECTED->ESCALATED': 'ESCALATE_CONTACT',
  'NO_RESPONSE->CONTACTING': 'RETRY_CONTACT', 'NO_RESPONSE->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'NO_RESPONSE->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'NO_RESPONSE->ESCALATED': 'ESCALATE_CONTACT',
  'UNREACHABLE->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'UNREACHABLE->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'UNREACHABLE->ESCALATED': 'ESCALATE_CONTACT',
  'OPERATOR_TAKEOVER->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'OPERATOR_TAKEOVER->ESCALATED': 'ESCALATE_CONTACT', 'OPERATOR_TAKEOVER->COMPLETED': 'COMPLETE_CONTACT',
  'HUMAN_REVIEW->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'HUMAN_REVIEW->ESCALATED': 'ESCALATE_CONTACT', 'HUMAN_REVIEW->COMPLETED': 'COMPLETE_CONTACT',
  'ESCALATED->OPERATOR_TAKEOVER': 'TAKE_OVER_CONTACT', 'ESCALATED->HUMAN_REVIEW': 'ESCALATE_CONTACT',
  'COMPLETED->HUMAN_REVIEW': 'ESCALATE_CONTACT', 'COMPLETED->ESCALATED': 'ESCALATE_CONTACT'
});

export function decideHumanContactTransition(current: HumanContactSessionContract, requestedState: HumanContactState, context: HumanContactTransitionContext): HumanContactTransitionDecision {
  const now = parseTime(context.occurredAt);
  if (now === null || context.expectedVersion !== current.version || !nonEmpty(context.actorId) || !nonEmpty(context.reason) || !nonEmpty(context.traceId)) return denied('HUMAN_REVIEW', 'invalid_or_stale_transition_context', true, null, null);
  if (!ALLOWED[current.state].includes(requestedState)) return denied(current.state, 'invalid_contact_transition', false, null, null);
  const requiredAuthority = TRANSITION_AUTHORITIES[`${current.state}->${requestedState}`] ?? null;
  if (requiredAuthority === null) return denied(current.state, 'transition_authority_undefined', false, null, null);
  const authorizedByRole = authorizedRole(context.actorRoles, requiredAuthority);
  if (authorizedByRole === null) return denied(current.state, 'actor_role_not_authorized', false, requiredAuthority, null);
  if (!context.channelHealthy && !['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState)) return denied('HUMAN_REVIEW', 'channel_unavailable', true, requiredAuthority, authorizedByRole);
  if (!context.accessibilitySatisfied && !['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState)) return denied('HUMAN_REVIEW', 'accessibility_path_unavailable', true, requiredAuthority, authorizedByRole);
  if (requestedState === 'CONTACTING' && current.attemptCount >= HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS) return denied('ESCALATED', 'retry_limit_exhausted', true, requiredAuthority, authorizedByRole);
  if (requestedState === 'NO_RESPONSE' || requestedState === 'DISCONNECTED') return allowed(requestedState, `contact.${requestedState.toLowerCase()}`, new Date(now + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString(), true, requiredAuthority, authorizedByRole);
  if (requestedState === 'AWAITING_RESPONSE') return allowed(requestedState, 'contact.awaiting_response', new Date(now + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString(), false, requiredAuthority, authorizedByRole);
  if (requestedState === 'COMPLETED' && current.identityConfidence !== 'CONFIRMED') return denied('HUMAN_REVIEW', 'identity_not_confirmed', true, requiredAuthority, authorizedByRole);
  return allowed(requestedState, `contact.${requestedState.toLowerCase()}`, null, ['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState), requiredAuthority, authorizedByRole);
}

export function validateHumanContactReply(input: unknown): { readonly valid: boolean; readonly disposition: 'PROCESS' | 'QUARANTINE' | 'HUMAN_REVIEW'; readonly reasonCode: string } {
  if (!record(input)) return replyDecision(false, 'QUARANTINE', 'invalid_reply');
  const keys = new Set(['replyId', 'sessionId', 'promptId', 'promptVersion', 'idempotencyKey', 'receivedAt', 'selectedOptions']);
  if (Object.keys(input).some((key) => !keys.has(key))) return replyDecision(false, 'QUARANTINE', 'free_text_or_unknown_field_prohibited');
  if (![input.replyId, input.sessionId, input.promptId, input.idempotencyKey].every(validId) || !Number.isInteger(input.promptVersion) || Number(input.promptVersion) < 1 || parseTime(String(input.receivedAt)) === null) return replyDecision(false, 'QUARANTINE', 'invalid_reply_metadata');
  if (!Array.isArray(input.selectedOptions) || input.selectedOptions.length === 0 || new Set(input.selectedOptions).size !== input.selectedOptions.length || !input.selectedOptions.every((option) => REPLY_OPTIONS.has(String(option) as HumanContactReplyOption))) return replyDecision(false, 'QUARANTINE', 'invalid_structured_options');
  if (input.selectedOptions.includes('YES') && input.selectedOptions.includes('NO')) return replyDecision(false, 'HUMAN_REVIEW', 'contradictory_reply');
  return replyDecision(true, 'PROCESS', 'structured_reply_valid');
}

export async function consumeHumanContactReply(input: unknown, registry: HumanContactReplyRegistryPort, digester: HumanContactDigestPort, evaluatedAt: string): Promise<HumanContactReplyAcceptanceDecision> {
  const structural = validateHumanContactReply(input);
  if (!structural.valid || !isReply(input)) return acceptance(false, structural.disposition, structural.reasonCode, 'NOT_ATTEMPTED', null, null);
  const evaluatedAtMs = parseTime(evaluatedAt);
  const receivedAtMs = parseTime(input.receivedAt);
  if (evaluatedAtMs === null || receivedAtMs === null) return acceptance(false, 'QUARANTINE', 'invalid_acceptance_time', 'NOT_ATTEMPTED', null, null);
  if (receivedAtMs > evaluatedAtMs + HUMAN_CONTACT_REPLY_MAX_CLOCK_SKEW_MS) return acceptance(false, 'HUMAN_REVIEW', 'reply_received_in_future', 'NOT_ATTEMPTED', null, null);
  if (evaluatedAtMs - receivedAtMs > HUMAN_CONTACT_REPLY_MAX_AGE_MS) return acceptance(false, 'QUARANTINE', 'reply_too_old', 'NOT_ATTEMPTED', null, null);
  try {
    const replyDigest = await digester.digest(`${HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION}|${input.replyId}`);
    if (!validDigest(replyDigest)) return acceptance(false, 'QUARANTINE', 'invalid_reply_digest', 'UNAVAILABLE', null, null);
    const scopeDigest = await digester.digest(`${HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION}|${input.sessionId}|${input.promptId}|${input.promptVersion}|${input.idempotencyKey}`);
    if (!validDigest(scopeDigest)) return acceptance(false, 'QUARANTINE', 'invalid_reply_scope_digest', 'UNAVAILABLE', replyDigest, null);
    const expiresAtMs = Math.min(receivedAtMs, evaluatedAtMs) + HUMAN_CONTACT_REPLY_TTL_MS;
    const result = await registry.consume({ policyVersion: HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION, replyDigest, scopeDigest, expiresAt: new Date(expiresAtMs).toISOString() });
    if (result !== 'CONSUMED') return acceptance(false, result === 'DUPLICATE' ? 'QUARANTINE' : 'HUMAN_REVIEW', result === 'DUPLICATE' ? 'duplicate_reply' : 'reply_registry_unavailable', result, replyDigest, scopeDigest);
    return acceptance(true, 'PROCESS', 'reply_consumed', result, replyDigest, scopeDigest);
  } catch {
    return acceptance(false, 'HUMAN_REVIEW', 'reply_registry_unavailable', 'UNAVAILABLE', null, null);
  }
}

const REPLY_OPTIONS = new Set<HumanContactReplyOption>(['YES', 'NO', 'UNKNOWN', 'HELP_REQUESTED', 'CANNOT_SPEAK', 'ACCESSIBILITY_SUPPORT_REQUIRED']);
function authorizedRole(roles: readonly HumanSafetyActorRole[], authority: HumanContactAuthority): HumanSafetyActorRole | null { for (const role of ROLE_PRIORITY) if (roles.includes(role) && HUMAN_CONTACT_ROLE_AUTHORITIES[role].includes(authority)) return role; return null; }
function prompt(promptId: string, version: number, purpose: HumanContactPromptPurpose, userFacingText: string, allowedReplyOptions: readonly HumanContactReplyOption[], escalationEffect: HumanContactPromptContract['escalationEffect']): HumanContactPromptContract { return { promptId, version, locale: 'ar', purpose, userFacingText, operatorFactCode: promptId.replaceAll('.', '_').toUpperCase(), allowedReplyOptions, dataClassification: purpose === 'REASSURANCE' ? 'OPERATIONAL' : 'SENSITIVE_RESTRICTED', retentionClass: 'GOVERNANCE_PLACEHOLDER', escalationEffect, governanceStatus: 'PLACEHOLDER_NOT_APPROVED', accessibility: { screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true } }; }
function allowed(nextState: HumanContactState, auditAction: string, deadlineAt: string | null, requiresHumanAction: boolean, requiredAuthority: HumanContactAuthority, authorizedByRole: HumanSafetyActorRole): HumanContactTransitionDecision { return { allowed: true, nextState, reasonCode: 'approved', auditAction, deadlineAt, requiresHumanAction, requiredAuthority, authorizedByRole, authorityPolicyVersion: HUMAN_CONTACT_AUTHORITY_POLICY_VERSION }; }
function denied(nextState: HumanContactState, reasonCode: string, requiresHumanAction: boolean, requiredAuthority: HumanContactAuthority | null, authorizedByRole: HumanSafetyActorRole | null): HumanContactTransitionDecision { return { allowed: false, nextState, reasonCode, auditAction: `contact.rejected.${reasonCode}`, deadlineAt: null, requiresHumanAction, requiredAuthority, authorizedByRole, authorityPolicyVersion: HUMAN_CONTACT_AUTHORITY_POLICY_VERSION }; }
function acceptance(accepted: boolean, disposition: HumanContactReplyAcceptanceDecision['disposition'], reasonCode: string, consumeResult: HumanContactReplyAcceptanceDecision['consumeResult'], replyDigest: string | null, scopeDigest: string | null): HumanContactReplyAcceptanceDecision { return { accepted, disposition, reasonCode, consumeResult, replayPolicyVersion: HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION, timePolicyVersion: HUMAN_CONTACT_REPLY_TIME_POLICY_VERSION, replyDigest, scopeDigest }; }
function replyDecision(valid: boolean, disposition: 'PROCESS' | 'QUARANTINE' | 'HUMAN_REVIEW', reasonCode: string) { return { valid, disposition, reasonCode } as const; }
function parseTime(value: string): number | null { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isReply(value: unknown): value is HumanContactReplyEnvelope { return record(value) && typeof value.replyId === 'string' && typeof value.sessionId === 'string' && typeof value.promptId === 'string' && typeof value.promptVersion === 'number' && typeof value.idempotencyKey === 'string' && typeof value.receivedAt === 'string' && Array.isArray(value.selectedOptions); }
