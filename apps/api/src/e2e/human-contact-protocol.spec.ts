import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS,
  HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS,
  consumeHumanContactReply,
  decideHumanContactTransition,
  validateHumanContactReply,
  type HumanContactReplyConsumeRequest,
  type HumanContactReplyRegistryPort,
  type HumanContactSessionContract
} from '@ros/contracts';

const session: HumanContactSessionContract = {
  sessionId: 'contact-session-001',
  caseId: 'contact-case-001',
  state: 'AWAITING_RESPONSE',
  version: 3,
  protocolVersion: 'ros-eye.contact.v1',
  promptPolicyVersion: 'ros-eye.contact-prompts.v1',
  accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
  language: 'ar',
  identityConfidence: 'PARTIAL',
  activeChannel: 'IN_APP_CHAT',
  attemptCount: 1,
  responseDeadlineAt: '2026-07-29T13:00:30.000Z',
  lastInteractionAt: '2026-07-29T13:00:00.000Z',
  assignedOperatorId: null,
  accessibility: {
    screenReaderRequired: true,
    handsFreeRequired: false,
    largeControlsRequired: true,
    simpleLanguageRequired: true,
    visualAlternativeRequired: true,
    audioAlternativeRequired: true
  }
};

const context = {
  actorId: 'system-contact-orchestrator',
  actorRoles: ['SYSTEM'] as const,
  occurredAt: '2026-07-29T13:00:00.000Z',
  reason: 'deterministic contact test',
  traceId: 'contact-trace-001',
  channelHealthy: true,
  accessibilitySatisfied: true,
  expectedVersion: 3
};

function reply(idempotencyKey = 'reply-key-001') {
  return {
    replyId: 'reply-001',
    sessionId: session.sessionId,
    promptId: 'contact.response',
    promptVersion: 1,
    idempotencyKey,
    receivedAt: '2026-07-29T13:00:10.000Z',
    selectedOptions: ['YES']
  };
}

const digester = { async digest(value: string) { return createHash('sha256').update(value).digest('hex'); } };

class AtomicReplyRegistry implements HumanContactReplyRegistryPort {
  private readonly keys = new Set<string>();
  unavailable = false;
  async consume(request: HumanContactReplyConsumeRequest) {
    if (this.unavailable) return 'UNAVAILABLE' as const;
    if (this.keys.has(request.idempotencyKeyDigest)) return 'DUPLICATE' as const;
    this.keys.add(request.idempotencyKeyDigest);
    return 'CONSUMED' as const;
  }
}

test('Arabic-first prompts are governance placeholders with structured options and accessibility metadata', () => {
  assert.ok(HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS.length >= 5);
  for (const prompt of HUMAN_CONTACT_ARABIC_PROMPT_PLACEHOLDERS) {
    assert.equal(prompt.locale, 'ar');
    assert.equal(prompt.governanceStatus, 'PLACEHOLDER_NOT_APPROVED');
    assert.ok(prompt.allowedReplyOptions.length > 0);
    assert.equal(prompt.accessibility.screenReaderRequired, true);
    assert.equal(prompt.accessibility.visualAlternativeRequired, true);
    assert.equal(prompt.accessibility.audioAlternativeRequired, true);
    assert.equal(prompt.userFacingText.includes('تشخيص'), false);
    assert.equal(prompt.userFacingText.includes('علاج'), false);
  }
});

test('awaiting response receives an explicit deterministic deadline', () => {
  const result = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', context);
  assert.equal(result.allowed, true);
  assert.equal(result.deadlineAt, '2026-07-29T13:00:30.000Z');
});

test('silence and disconnect require human action and bounded retry timing', () => {
  for (const requested of ['NO_RESPONSE', 'DISCONNECTED'] as const) {
    const result = decideHumanContactTransition(session, requested, context);
    assert.equal(result.allowed, true);
    assert.equal(result.requiresHumanAction, true);
    assert.equal(result.deadlineAt, '2026-07-29T13:00:15.000Z');
  }
});

test('retry exhaustion escalates instead of creating a notification storm', () => {
  const result = decideHumanContactTransition({ ...session, state: 'NO_RESPONSE', attemptCount: HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS }, 'CONTACTING', context);
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'ESCALATED');
  assert.equal(result.reasonCode, 'retry_limit_exhausted');
});

test('channel or accessibility failure fails toward human review', () => {
  const channelFailure = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', { ...context, channelHealthy: false });
  assert.equal(channelFailure.allowed, false);
  assert.equal(channelFailure.nextState, 'HUMAN_REVIEW');
  assert.equal(channelFailure.reasonCode, 'channel_unavailable');

  const accessibilityFailure = decideHumanContactTransition({ ...session, state: 'CONTACTING' }, 'AWAITING_RESPONSE', { ...context, accessibilitySatisfied: false });
  assert.equal(accessibilityFailure.allowed, false);
  assert.equal(accessibilityFailure.nextState, 'HUMAN_REVIEW');
  assert.equal(accessibilityFailure.reasonCode, 'accessibility_path_unavailable');
});

test('auditor and simulated channel cannot execute conversation transitions', () => {
  for (const actorRoles of [['AUDITOR'], ['SIMULATED_CHANNEL']] as const) {
    const result = decideHumanContactTransition(session, 'RESPONSE_CONFIRMED', { ...context, actorRoles });
    assert.equal(result.allowed, false);
    assert.equal(result.reasonCode, 'actor_role_not_authorized');
  }
});

test('completion is blocked until identity confidence is confirmed', () => {
  const blocked = decideHumanContactTransition({ ...session, state: 'RESPONSE_CONFIRMED' }, 'COMPLETED', context);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nextState, 'HUMAN_REVIEW');
  assert.equal(blocked.reasonCode, 'identity_not_confirmed');

  const allowed = decideHumanContactTransition({ ...session, state: 'RESPONSE_CONFIRMED', identityConfidence: 'CONFIRMED' }, 'COMPLETED', context);
  assert.equal(allowed.allowed, true);
});

test('stale session version fails closed', () => {
  const result = decideHumanContactTransition(session, 'RESPONSE_CONFIRMED', { ...context, expectedVersion: 2 });
  assert.equal(result.allowed, false);
  assert.equal(result.nextState, 'HUMAN_REVIEW');
});

test('free text and unknown fields are quarantined', () => {
  const result = validateHumanContactReply({ ...reply(), freeText: 'أشعر بألم شديد' });
  assert.equal(result.valid, false);
  assert.equal(result.disposition, 'QUARANTINE');
  assert.equal(result.reasonCode, 'free_text_or_unknown_field_prohibited');
});

test('contradictory structured reply goes to human review', () => {
  const result = validateHumanContactReply({ ...reply(), selectedOptions: ['YES', 'NO'] });
  assert.equal(result.valid, false);
  assert.equal(result.disposition, 'HUMAN_REVIEW');
  assert.equal(result.reasonCode, 'contradictory_reply');
});

test('duplicate reply is atomically rejected and concurrent attempts have one winner', async () => {
  const registry = new AtomicReplyRegistry();
  const first = await consumeHumanContactReply(reply(), registry, digester);
  const second = await consumeHumanContactReply(reply(), registry, digester);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reasonCode, 'duplicate_reply');

  const concurrentRegistry = new AtomicReplyRegistry();
  const results = await Promise.all([
    consumeHumanContactReply(reply('reply-key-002'), concurrentRegistry, digester),
    consumeHumanContactReply(reply('reply-key-002'), concurrentRegistry, digester)
  ]);
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(results.filter((result) => result.reasonCode === 'duplicate_reply').length, 1);
});

test('reply registry unavailable or throwing never processes a reply', async () => {
  const unavailable = new AtomicReplyRegistry();
  unavailable.unavailable = true;
  const first = await consumeHumanContactReply(reply(), unavailable, digester);
  assert.equal(first.accepted, false);
  assert.equal(first.disposition, 'HUMAN_REVIEW');

  const throwing: HumanContactReplyRegistryPort = { async consume() { throw new Error('timeout'); } };
  const second = await consumeHumanContactReply(reply(), throwing, digester);
  assert.equal(second.accepted, false);
  assert.equal(second.reasonCode, 'reply_registry_unavailable');
});

test('operator takeover is explicit and auditable', () => {
  const result = decideHumanContactTransition(session, 'OPERATOR_TAKEOVER', { ...context, actorId: 'operator-001', actorRoles: ['OPERATOR'] });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresHumanAction, true);
  assert.equal(result.auditAction, 'contact.operator_takeover');
});
