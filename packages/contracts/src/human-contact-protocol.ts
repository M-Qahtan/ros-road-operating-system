import type { HumanSafetyActorRole, HumanSafetyChannel } from './human-safety.js';

export const HUMAN_CONTACT_PROTOCOL_VERSION = 'ros-eye.contact.v1' as const;
export const HUMAN_CONTACT_PROMPT_POLICY_VERSION = 'ros-eye.contact-prompts.v1' as const;
export const HUMAN_CONTACT_ACCESSIBILITY_POLICY_VERSION = 'ros-eye.accessibility.v1' as const;
export const HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS = 3;
export const HUMAN_CONTACT_RESPONSE_DEADLINE_MS = 30_000;
export const HUMAN_CONTACT_RETRY_BASE_DELAY_MS = 15_000;

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
export interface HumanContactReplyConsumeRequest { readonly sessionId: string; readonly idempotencyKeyDigest: string; readonly expiresAt: string }
export interface HumanContactReplyRegistryPort { consume(request: HumanContactReplyConsumeRequest): Promise<HumanContactReplyConsumeResult> }
export interface HumanContactDigestPort { digest(value: string): Promise<string> }
export interface HumanContactChannelPort {
  sendStructuredPrompt(session: HumanContactSessionContract, prompt: HumanContactPromptContract): Promise<'SENT' | 'UNAVAILABLE'>;
}
export interface HumanContactOperatorHandoffPort {
  requestTakeover(sessionId: string, caseId: string, reasonCode: string): Promise<'ACKNOWLEDGED' | 'UNAVAILABLE'>;
}

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

export function decideHumanContactTransition(current: HumanContactSessionContract, requestedState: HumanContactState, context: HumanContactTransitionContext): HumanContactTransitionDecision {
  const now = parseTime(context.occurredAt);
  if (now === null || context.expectedVersion !== current.version || !nonEmpty(context.actorId) || !nonEmpty(context.reason) || !nonEmpty(context.traceId)) return denied('HUMAN_REVIEW', 'invalid_or_stale_transition_context', true);
  if (!ALLOWED[current.state].includes(requestedState)) return denied(current.state, 'invalid_contact_transition', false);
  if (['AUDITOR', 'SIMULATED_CHANNEL'].some((role) => context.actorRoles.includes(role as HumanSafetyActorRole))) return denied(current.state, 'actor_role_not_authorized', false);
  if (!context.channelHealthy && !['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState)) return denied('HUMAN_REVIEW', 'channel_unavailable', true);
  if (!context.accessibilitySatisfied && !['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState)) return denied('HUMAN_REVIEW', 'accessibility_path_unavailable', true);
  if (requestedState === 'CONTACTING' && current.attemptCount >= HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS) return denied('ESCALATED', 'retry_limit_exhausted', true);
  if (requestedState === 'NO_RESPONSE' || requestedState === 'DISCONNECTED') return allowed(requestedState, `contact.${requestedState.toLowerCase()}`, new Date(now + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString(), true);
  if (requestedState === 'AWAITING_RESPONSE') return allowed(requestedState, 'contact.awaiting_response', new Date(now + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString(), false);
  if (requestedState === 'COMPLETED' && current.identityConfidence !== 'CONFIRMED') return denied('HUMAN_REVIEW', 'identity_not_confirmed', true);
  return allowed(requestedState, `contact.${requestedState.toLowerCase()}`, null, ['HUMAN_REVIEW', 'ESCALATED', 'OPERATOR_TAKEOVER'].includes(requestedState));
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

export async function consumeHumanContactReply(input: unknown, registry: HumanContactReplyRegistryPort, digester: HumanContactDigestPort): Promise<{ readonly accepted: boolean; readonly disposition: 'PROCESS' | 'QUARANTINE' | 'HUMAN_REVIEW'; readonly reasonCode: string; readonly consumeResult: HumanContactReplyConsumeResult | 'NOT_ATTEMPTED' }> {
  const structural = validateHumanContactReply(input);
  if (!structural.valid || !isReply(input)) return { accepted: false, ...structural, consumeResult: 'NOT_ATTEMPTED' };
  try {
    const digest = await digester.digest(`${HUMAN_CONTACT_PROTOCOL_VERSION}|${input.sessionId}|${input.idempotencyKey}`);
    if (!/^[a-f0-9]{64}$/i.test(digest)) return { accepted: false, disposition: 'QUARANTINE', reasonCode: 'invalid_idempotency_digest', consumeResult: 'UNAVAILABLE' };
    const result = await registry.consume({ sessionId: input.sessionId, idempotencyKeyDigest: digest, expiresAt: new Date(Date.parse(input.receivedAt) + 24 * 60 * 60 * 1000).toISOString() });
    if (result !== 'CONSUMED') return { accepted: false, disposition: result === 'DUPLICATE' ? 'QUARANTINE' : 'HUMAN_REVIEW', reasonCode: result === 'DUPLICATE' ? 'duplicate_reply' : 'reply_registry_unavailable', consumeResult: result };
    return { accepted: true, disposition: 'PROCESS', reasonCode: 'reply_consumed', consumeResult: result };
  } catch { return { accepted: false, disposition: 'HUMAN_REVIEW', reasonCode: 'reply_registry_unavailable', consumeResult: 'UNAVAILABLE' }; }
}

const REPLY_OPTIONS = new Set<HumanContactReplyOption>(['YES', 'NO', 'UNKNOWN', 'HELP_REQUESTED', 'CANNOT_SPEAK', 'ACCESSIBILITY_SUPPORT_REQUIRED']);
function prompt(promptId: string, version: number, purpose: HumanContactPromptPurpose, userFacingText: string, allowedReplyOptions: readonly HumanContactReplyOption[], escalationEffect: HumanContactPromptContract['escalationEffect']): HumanContactPromptContract { return { promptId, version, locale: 'ar', purpose, userFacingText, operatorFactCode: promptId.replaceAll('.', '_').toUpperCase(), allowedReplyOptions, dataClassification: purpose === 'REASSURANCE' ? 'OPERATIONAL' : 'SENSITIVE_RESTRICTED', retentionClass: 'GOVERNANCE_PLACEHOLDER', escalationEffect, governanceStatus: 'PLACEHOLDER_NOT_APPROVED', accessibility: { screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true } }; }
function allowed(nextState: HumanContactState, auditAction: string, deadlineAt: string | null, requiresHumanAction: boolean): HumanContactTransitionDecision { return { allowed: true, nextState, reasonCode: 'approved', auditAction, deadlineAt, requiresHumanAction }; }
function denied(nextState: HumanContactState, reasonCode: string, requiresHumanAction: boolean): HumanContactTransitionDecision { return { allowed: false, nextState, reasonCode, auditAction: `contact.rejected.${reasonCode}`, deadlineAt: null, requiresHumanAction }; }
function replyDecision(valid: boolean, disposition: 'PROCESS' | 'QUARANTINE' | 'HUMAN_REVIEW', reasonCode: string) { return { valid, disposition, reasonCode } as const; }
function parseTime(value: string): number | null { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validId(value: unknown): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isReply(value: unknown): value is HumanContactReplyEnvelope { return record(value) && typeof value.sessionId === 'string' && typeof value.idempotencyKey === 'string' && typeof value.receivedAt === 'string'; }
