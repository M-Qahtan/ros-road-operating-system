import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS,
  HUMAN_CONTACT_AUTHORITY_POLICY_VERSION,
  HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS,
  HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION,
  HUMAN_CONTACT_REPLY_TIME_POLICY_VERSION,
  consumeHumanContactReply,
  decideHumanContactTransition,
  validateHumanContactReply,
  type HumanContactReplyConsumeRequest,
  type HumanContactReplyRegistryPort,
  type HumanContactSessionContract
} from '@ros/contracts';

const session: HumanContactSessionContract = {
  sessionId: 'contact-session-001', caseId: 'contact-case-001', state: 'AWAITING_RESPONSE', version: 3,
  protocolVersion: 'ros-eye.contact.v1', promptPolicyVersion: 'ros-eye.contact-prompts.v1', accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
  language: 'ar', identityConfidence: 'PARTIAL', activeChannel: 'IN_APP_CHAT', attemptCount: 1,
  responseDeadlineAt: '2026-07-29T13:00:30.000Z', lastInteractionAt: '2026-07-29T13:00:00.000Z', assignedOperatorId: null,
  accessibility: { screenReaderRequired: true, handsFreeRequired: false, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true }
};

const context = {
  actorId: 'system-contact-orchestrator', actorRoles: ['SYSTEM'] as const, occurredAt: '2026-07-29T13:00:00.000Z',
  reason: 'deterministic contact test', traceId: 'contact-trace-001', channelHealthy: true, accessibilitySatisfied: true, expectedVersion: 3
};
const evaluatedAt = '2026-07-29T13:00:12.000Z';

function reply(idempotencyKey = 'reply-key-001', replyId = 'reply-001') {
  return { replyId, sessionId: session.sessionId, promptId: 'contact.response', promptVersion: 1, idempotencyKey, receivedAt: '2026-07-29T13:00:10.000Z', selectedOptions: ['YES'] };
}
const digester = { async digest(value: string) { return createHash('sha256').update(value).digest('hex'); } };

class AtomicReplyRegistry implements HumanContactReplyRegistryPort {
  private readonly replies = new Set<string>();
  unavailable = false;
  requests: HumanContactReplyConsumeRequest[] = [];
  async consume(request: HumanContactReplyConsumeRequest) {
    this.requests.push(request);
    if (this.unavailable) return 'UNAVAILABLE' as const;
    if (this.replies.has(request.replyDigest)) return 'DUPLICATE' as const;
    this.replies.add(request.replyDigest);
    return 'CONSUMED' as const;
  }
}

test('Arabic-first prompts remain unapproved structured accessibility placeholders', () => {
  assert.ok(HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS.length >= 5);
  for (const prompt of HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS) {
    assert.equal(prompt.locale, 'ar'); assert.equal(prompt.governanceStatus, 'PLACEHOLDER_NOT_APPROVED'); assert.ok(prompt.allowedReplyOptions.length > 0);
    assert.equal(prompt.accessibility.screenReaderRequired, true); assert.equal(prompt.accessibility.visualAlternativeRequired, true); assert.equal(prompt.accessibility.audioAlternativeRequired, true);
    assert.equal(prompt.userFacingText.includes('تشخيص'), false); assert.equal(prompt.userFacingText.includes('علاج'), false);
  }
});

test('awaiting response receives an explicit deterministic deadline and authority evidence', () => {
  const result = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', context);
  assert.equal(result.allowed, true); assert.equal(result.deadlineAt, '2026-07-29T13:00:30.000Z');
  assert.equal(result.requiredAuthority, 'START_CONTACT'); assert.equal(result.authorizedByRole, 'SYSTEM'); assert.equal(result.authorityPolicyVersion, HUMAN_CONTACT_AUTHORITY_POLICY_VERSION);
});

test('silence and disconnect require human action and bounded retry timing', () => {
  for (const requested of ['NO_RESPONSE', 'DISCONNECTED'] as const) {
    const result = decideHumanContactTransition(session, requested, context);
    assert.equal(result.allowed, true); assert.equal(result.requiresHumanAction, true); assert.equal(result.deadlineAt, '2026-07-29T13:00:15.000Z');
  }
});

test('retry exhaustion escalates instead of creating a notification storm', () => {
  const result = decideHumanContactTransition({ ...session, state: 'NO_RESPONSE', attemptCount: HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS }, 'CONTACTING', context);
  assert.equal(result.allowed, false); assert.equal(result.nextState, 'ESCALATED'); assert.equal(result.reasonCode, 'retry_limit_exhausted');
});

test('channel or accessibility failure fails toward human review', () => {
  const channelFailure = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', { ...context, channelHealthy: false });
  assert.equal(channelFailure.allowed, false); assert.equal(channelFailure.nextState, 'HUMAN_REVIEW'); assert.equal(channelFailure.reasonCode, 'channel_unavailable');
  const accessibilityFailure = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', { ...context, accessibilitySatisfied: false });
  assert.equal(accessibilityFailure.allowed, false); assert.equal(accessibilityFailure.nextState, 'HUMAN_REVIEW'); assert.equal(accessibilityFailure.reasonCode, 'accessibility_path_unavailable');
});

test('system, auditor and simulated channel cannot take over or complete human-controlled contact', () => {
  for (const actorRoles of [['SYSTEM'], ['AUDITOR'], ['SIMULATED_CHANNEL']] as const) {
    const takeover = decideHumanContactTransition(session, 'OPERATOR_TAKEOVER', { ...context, actorRoles });
    assert.equal(takeover.allowed, false); assert.equal(takeover.reasonCode, 'actor_role_not_authorized'); assert.equal(takeover.requiredAuthority, 'TAKE_OVER_CONTACT');
    const complete = decideHumanContactTransition({ ...session, state: 'RESPONSE_CONFIRMED', identityConfidence: 'CONFIRMED' }, 'COMPLETED', { ...context, actorRoles });
    assert.equal(complete.allowed, false); assert.equal(complete.reasonCode, 'actor_role_not_authorized'); assert.equal(complete.requiredAuthority, 'COMPLETE_CONTACT');
  }
});

test('multi-role authorization chooses the strongest deterministic human role', () => {
  const result = decideHumanContactTransition(session, 'OPERATOR_TAKEOVER', { ...context, actorId: 'human-001', actorRoles: ['OPERATOR', 'SUPERVISOR'] });
  assert.equal(result.allowed, true); assert.equal(result.authorizedByRole, 'SUPERVISOR'); assert.equal(result.requiredAuthority, 'TAKE_OVER_CONTACT');
});

test('completion is blocked until identity is confirmed and remains human-authorized', () => {
  const human = { ...context, actorId: 'operator-001', actorRoles: ['OPERATOR'] as const };
  const blocked = decideHumanContactTransition({ ...session, state: 'RESPONSE_CONFIRMED' }, 'COMPLETED', human);
  assert.equal(blocked.allowed, false); assert.equal(blocked.nextState, 'HUMAN_REVIEW'); assert.equal(blocked.reasonCode, 'identity_not_confirmed');
  const allowed = decideHumanContactTransition({ ...session, state: 'RESPONSE_CONFIRMED', identityConfidence: 'CONFIRMED' }, 'COMPLETED', human);
  assert.equal(allowed.allowed, true); assert.equal(allowed.authorizedByRole, 'OPERATOR');
});

test('stale session version fails closed', () => {
  const result = decideHumanContactTransition(session, 'RESPONSE_CONFIRMED', { ...context, expectedVersion: 2 });
  assert.equal(result.allowed, false); assert.equal(result.nextState, 'HUMAN_REVIEW');
});

test('free text and contradictory structured replies fail closed', () => {
  const freeText = validateHumanContactReply({ ...reply(), freeText: 'أشعر بألم شديد' });
  assert.equal(freeText.valid, false); assert.equal(freeText.disposition, 'QUARANTINE'); assert.equal(freeText.reasonCode, 'free_text_or_unknown_field_prohibited');
  const contradictory = validateHumanContactReply({ ...reply(), selectedOptions: ['YES', 'NO'] });
  assert.equal(contradictory.valid, false); assert.equal(contradictory.disposition, 'HUMAN_REVIEW'); assert.equal(contradictory.reasonCode, 'contradictory_reply');
});

test('same reply id is globally rejected across idempotency keys and concurrent rebinding has one winner', async () => {
  const registry = new AtomicReplyRegistry();
  const first = await consumeHumanContactReply(reply('reply-key-001'), registry, digester, evaluatedAt);
  const rebound = await consumeHumanContactReply(reply('reply-key-002'), registry, digester, evaluatedAt);
  assert.equal(first.accepted, true); assert.equal(rebound.accepted, false); assert.equal(rebound.reasonCode, 'duplicate_reply');
  assert.notEqual(registry.requests[0]?.scopeDigest, registry.requests[1]?.scopeDigest);
  assert.equal(registry.requests[0]?.replyDigest, registry.requests[1]?.replyDigest);

  const concurrentRegistry = new AtomicReplyRegistry();
  const results = await Promise.all([
    consumeHumanContactReply(reply('reply-key-a'), concurrentRegistry, digester, evaluatedAt),
    consumeHumanContactReply(reply('reply-key-b'), concurrentRegistry, digester, evaluatedAt)
  ]);
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(results.filter((result) => result.reasonCode === 'duplicate_reply').length, 1);
});

test('different replies remain independently admissible', async () => {
  const registry = new AtomicReplyRegistry();
  const first = await consumeHumanContactReply(reply('reply-key-001', 'reply-001'), registry, digester, evaluatedAt);
  const second = await consumeHumanContactReply(reply('reply-key-001', 'reply-002'), registry, digester, evaluatedAt);
  assert.equal(first.accepted, true); assert.equal(second.accepted, true);
});

test('trusted evaluation time rejects future and stale replies before registry consume', async () => {
  const futureRegistry = new AtomicReplyRegistry();
  const future = await consumeHumanContactReply({ ...reply(), receivedAt: '2026-07-29T13:06:00.001Z' }, futureRegistry, digester, '2026-07-29T13:00:00.000Z');
  assert.equal(future.accepted, false); assert.equal(future.reasonCode, 'reply_received_in_future'); assert.equal(futureRegistry.requests.length, 0);

  const staleRegistry = new AtomicReplyRegistry();
  const stale = await consumeHumanContactReply({ ...reply(), receivedAt: '2026-07-28T12:59:59.999Z' }, staleRegistry, digester, '2026-07-29T13:00:00.000Z');
  assert.equal(stale.accepted, false); assert.equal(stale.reasonCode, 'reply_too_old'); assert.equal(staleRegistry.requests.length, 0);
});

test('future sender time cannot extend registry expiry and policy versions are audited', async () => {
  const registry = new AtomicReplyRegistry();
  const result = await consumeHumanContactReply({ ...reply(), receivedAt: '2026-07-29T13:04:59.000Z' }, registry, digester, '2026-07-29T13:00:00.000Z');
  assert.equal(result.accepted, true);
  assert.equal(registry.requests[0]?.expiresAt, '2026-07-30T13:00:00.000Z');
  assert.equal(result.replayPolicyVersion, HUMAN_CONTACT_REPLY_REPLAY_POLICY_VERSION);
  assert.equal(result.timePolicyVersion, HUMAN_CONTACT_REPLY_TIME_POLICY_VERSION);
  assert.match(result.replyDigest ?? '', /^[a-f0-9]{64}$/); assert.match(result.scopeDigest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(registry.requests[0]).includes('reply-key-001'), false);
});

test('reply registry unavailable or throwing never processes a reply', async () => {
  const unavailable = new AtomicReplyRegistry(); unavailable.unavailable = true;
  const first = await consumeHumanContactReply(reply(), unavailable, digester, evaluatedAt);
  assert.equal(first.accepted, false); assert.equal(first.disposition, 'HUMAN_REVIEW');
  const throwing: HumanContactReplyRegistryPort = { async consume() { throw new Error('timeout'); } };
  const second = await consumeHumanContactReply(reply(), throwing, digester, evaluatedAt);
  assert.equal(second.accepted, false); assert.equal(second.reasonCode, 'reply_registry_unavailable');
});

test('operator takeover is explicit, human-authorized and auditable', () => {
  const result = decideHumanContactTransition(session, 'OPERATOR_TAKEOVER', { ...context, actorId: 'operator-001', actorRoles: ['OPERATOR'] });
  assert.equal(result.allowed, true); assert.equal(result.requiresHumanAction, true); assert.equal(result.auditAction, 'contact.operator_takeover');
  assert.equal(result.requiredAuthority, 'TAKE_OVER_CONTACT'); assert.equal(result.authorizedByRole, 'OPERATOR');
});
