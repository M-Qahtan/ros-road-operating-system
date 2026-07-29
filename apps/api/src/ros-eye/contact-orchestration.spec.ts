import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { POSTGRES_CONTACT_RUNTIME_SQL } from './contact-orchestration-postgres.js';
import {
  CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
  ContactOrchestrationService,
  type CallbackInput,
  type ContactAuditEvent,
  type ContactCallbackKind,
  type ContactChannelPort,
  type ContactOutboxMessage,
  type ContactRuntimeRepositoryPort,
  type ContactRuntimeTransaction,
  type ContactScope,
  type ContactSessionRecord,
  type OpenContactInput,
  type OperatorTakeoverInput,
  type OutboxDeliveryDisposition,
  type ProcessClaimedOutboxInput
} from './contact-orchestration.js';

const scopedKey = (value: ContactScope) => `${value.tenantId}|${value.caseId}|${value.sessionId}`;
const outboxKey = (value: ContactScope & { messageId: string }) => `${scopedKey(value)}|${value.messageId}`;

class MemoryRepository implements ContactRuntimeRepositoryPort, ContactRuntimeTransaction {
  readonly sessions = new Map<string, ContactSessionRecord>();
  readonly inbox = new Set<string>();
  readonly audits = new Map<string, ContactAuditEvent>();
  readonly outbox = new Map<string, ContactOutboxMessage>();
  crashAfterProviderSendOnce = false;

  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> { return work(this); }
  async getSessionForUpdate(scope: ContactScope) { return this.sessions.get(scopedKey(scope)) ?? null; }
  async insertSession(session: ContactSessionRecord) { const key = scopedKey(session); if (this.sessions.has(key)) throw new Error('duplicate'); this.sessions.set(key, session); }
  async updateSession(session: ContactSessionRecord, expectedVersion: number) { const key = scopedKey(session); const current = this.sessions.get(key); if (!current || current.version !== expectedVersion) return 'CONFLICT' as const; this.sessions.set(key, session); return 'UPDATED' as const; }
  async insertInboxIfAbsent(scope: ContactScope, key: string) { const scoped = `${scopedKey(scope)}|${key}`; if (this.inbox.has(scoped)) return 'EXISTS' as const; this.inbox.add(scoped); return 'INSERTED' as const; }
  async insertAuditIfAbsent(event: ContactAuditEvent) { const key = `${scopedKey(event)}|${event.eventId}`; if (this.audits.has(key)) return 'EXISTS' as const; this.audits.set(key, event); return 'INSERTED' as const; }
  async insertOutboxIfAbsent(message: ContactOutboxMessage) { const key = outboxKey(message); if (this.outbox.has(key)) return 'EXISTS' as const; this.outbox.set(key, message); return 'INSERTED' as const; }
  async cancelPendingAutomation(scope: ContactScope, occurredAt: string) { for (const [key, message] of this.outbox) if (scopedKey(message) === scopedKey(scope) && message.deliveredAt === null && message.cancelledAt === null) this.outbox.set(key, { ...message, cancelledAt: occurredAt, leaseOwner: null, leaseExpiresAt: null }); }

  async claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }) {
    const result: ContactSessionRecord[] = [];
    for (const [key, session] of this.sessions) {
      if (result.length >= input.limit) break;
      const leaseActive = session.leaseExpiresAt !== null && Date.parse(session.leaseExpiresAt) > Date.parse(input.now);
      if (leaseActive || session.automationSuppressed || session.nextActionAt === null || Date.parse(session.nextActionAt) > Date.parse(input.now)) continue;
      const leased = { ...session, leaseOwner: input.workerId, leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString() };
      this.sessions.set(key, leased); result.push(leased);
    }
    return result;
  }
  async releaseLease(scope: ContactScope, workerId: string) { const key = scopedKey(scope); const current = this.sessions.get(key); if (current?.leaseOwner === workerId) this.sessions.set(key, { ...current, leaseOwner: null, leaseExpiresAt: null }); }

  async claimDueOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number }) {
    const result: ContactOutboxMessage[] = [];
    for (const [key, message] of this.outbox) {
      if (result.length >= input.limit) break;
      const leaseActive = message.leaseExpiresAt !== null && Date.parse(message.leaseExpiresAt) > Date.parse(input.now);
      if (leaseActive || message.deliveredAt !== null || message.cancelledAt !== null || Date.parse(message.availableAt) > Date.parse(input.now)) continue;
      const claimed = { ...message, leaseOwner: input.workerId, leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString() };
      this.outbox.set(key, claimed); result.push(claimed);
    }
    return result;
  }

  async processClaimedOutbox(input: ProcessClaimedOutboxInput, deliver: (message: ContactOutboxMessage) => Promise<'SENT' | 'UNAVAILABLE'>): Promise<OutboxDeliveryDisposition> {
    const key = outboxKey(input); const current = this.outbox.get(key);
    if (!current) return 'CONFLICT';
    if (current.cancelledAt !== null) return 'CANCELLED';
    if (current.deliveredAt !== null) return 'DELIVERED';
    if (current.leaseOwner !== input.workerId || current.leaseExpiresAt === null || Date.parse(current.leaseExpiresAt) <= Date.parse(input.now)) return 'CONFLICT';
    const result = await deliver(current);
    if (this.crashAfterProviderSendOnce) { this.crashAfterProviderSendOnce = false; throw new Error('simulated crash after provider send'); }
    const fenced = this.outbox.get(key);
    if (!fenced || fenced.cancelledAt !== null) return 'CANCELLED';
    if (fenced.leaseOwner !== input.workerId) return 'CONFLICT';
    if (result === 'SENT') {
      this.outbox.set(key, { ...fenced, deliveredAt: input.now, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null });
      return 'DELIVERED';
    }
    this.outbox.set(key, { ...fenced, availableAt: input.retryAvailableAt, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: input.errorCode });
    return 'RETRY';
  }

  async releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }) { const key = outboxKey(input); const current = this.outbox.get(key); if (current?.leaseOwner === input.workerId) this.outbox.set(key, { ...current, leaseOwner: null, leaseExpiresAt: null }); }
}

const ids = { async create(namespace: string, material: string) { return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`; } };
const providerInvocations: string[] = [];
const providerLogicalDeliveries = new Set<string>();
const channel: ContactChannelPort = { async send(input) { providerInvocations.push(input.idempotencyKey); providerLogicalDeliveries.add(input.idempotencyKey); return 'SENT'; } };
const scope = { tenantId: 'tenant-riyadh', caseId: 'case-001', sessionId: 'session-001' } as const;

function openInput(overrides: Partial<OpenContactInput> = {}): OpenContactInput {
  return { ...scope, language: 'ar', traceId: 'trace-001', occurredAt: '2026-07-29T15:00:00.000Z', idempotencyKey: 'open-001', preferredChannel: 'IN_APP', ...overrides };
}
function callback(kind: ContactCallbackKind, overrides: Partial<CallbackInput> = {}): CallbackInput {
  return { ...scope, authenticatedTenantId: 'tenant-riyadh', authenticatedCaseId: 'case-001', callbackId: `callback-${kind.toLowerCase()}`, traceId: `trace-${kind.toLowerCase()}`, occurredAt: '2026-07-29T15:00:05.000Z', idempotencyKey: `key-${kind.toLowerCase()}`, kind, ...overrides };
}
function takeover(overrides: Partial<OperatorTakeoverInput> = {}): OperatorTakeoverInput {
  return { ...scope, operatorId: 'operator-001', authenticatedTenantId: 'tenant-riyadh', authenticatedCaseId: 'case-001', authorizedRole: 'OPERATOR', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:20.000Z', idempotencyKey: 'takeover-001', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION, ...overrides };
}
function session(repo: MemoryRepository): ContactSessionRecord { const value = repo.sessions.get(scopedKey(scope)); assert.ok(value); return value; }
function activeMessages(repo: MemoryRepository): ContactOutboxMessage[] { return [...repo.outbox.values()].filter((message) => message.cancelledAt === null && message.deliveredAt === null); }
function resetProvider(): void { providerInvocations.length = 0; providerLogicalDeliveries.clear(); }

async function reachAwaitingResponse(service: ContactOrchestrationService, repo: MemoryRepository): Promise<void> {
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED')), 'APPLIED');
  assert.equal(session(repo).state, 'LANGUAGE_SELECTION');
  assert.equal(await service.handleCallback(callback('LANGUAGE_SELECTED', { callbackId: 'callback-language', occurredAt: '2026-07-29T15:00:10.000Z', selectedLanguage: 'ar' })), 'APPLIED');
  assert.equal(session(repo).state, 'CONTACTING');
  assert.equal((await service.runDue('protocol-worker', '2026-07-29T15:00:10.001Z'))[0]?.disposition, 'APPLIED');
  assert.equal(session(repo).state, 'AWAITING_RESPONSE');
}

async function driveUntilEscalated(service: ContactOrchestrationService, repo: MemoryRepository): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const current = session(repo);
    if (current.state === 'ESCALATED') return;
    assert.notEqual(current.nextActionAt, null);
    const now = new Date(Date.parse(current.nextActionAt ?? '') + 1).toISOString();
    await service.runDue(`retry-worker-${index}`, now);
  }
  assert.fail('contact runtime did not reach ESCALATED within bounded transitions');
}

test('opening begins with consent and contains no raw sensitive fields', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput()), 'APPLIED'); assert.equal(await service.open(openInput()), 'IDEMPOTENT');
  assert.equal(session(repo).state, 'CONSENT_PENDING');
  assert.equal(activeMessages(repo)[0]?.promptId, 'contact.consent');
  assert.equal(repo.sessions.size, 1); assert.equal(repo.outbox.size, 1); assert.equal(repo.audits.size, 1);
  const serialized = JSON.stringify([...repo.sessions.values(), ...repo.audits.values(), ...repo.outbox.values()]);
  for (const forbidden of ['phoneNumber', 'medicalNarrative', 'replayToken', 'latitude', 'longitude', 'rawBody']) assert.equal(serialized.includes(forbidden), false);
  assert.equal([...repo.audits.values()][0]?.authorizedByRole, 'SYSTEM');
});

test('protocol enforces consent then language selection then contacting before safety indicator prompt', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput({ language: 'UNKNOWN' }));
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED')), 'APPLIED');
  assert.equal(session(repo).state, 'LANGUAGE_SELECTION');
  assert.equal(activeMessages(repo)[0]?.promptId, 'contact.language');
  assert.equal(await service.handleCallback(callback('LANGUAGE_SELECTED', { callbackId: 'callback-language', occurredAt: '2026-07-29T15:00:10.000Z', selectedLanguage: 'en' })), 'APPLIED');
  assert.equal(session(repo).state, 'CONTACTING'); assert.equal(session(repo).language, 'en');
  assert.equal(activeMessages(repo).length, 0);
  await service.runDue('protocol-worker', '2026-07-29T15:00:10.001Z');
  assert.equal(session(repo).state, 'AWAITING_RESPONSE');
  assert.equal(activeMessages(repo)[0]?.promptId, 'contact.response');
  assert.deepEqual([...repo.audits.values()].map((event) => event.state), ['CONSENT_PENDING', 'LANGUAGE_SELECTION', 'CONTACTING', 'AWAITING_RESPONSE']);
});

test('consent refusal or missing language selection fails to human review without further automation', async () => {
  const refusedRepo = new MemoryRepository(); const refused = new ContactOrchestrationService(refusedRepo, channel, ids); await refused.open(openInput());
  assert.equal(await refused.handleCallback(callback('CONSENT_DECLINED')), 'HUMAN_REVIEW');
  assert.equal(session(refusedRepo).state, 'HUMAN_REVIEW'); assert.equal(activeMessages(refusedRepo).length, 0);

  const timeoutRepo = new MemoryRepository(); const timeout = new ContactOrchestrationService(timeoutRepo, channel, ids); await timeout.open(openInput());
  await timeout.handleCallback(callback('CONSENT_GRANTED'));
  const deadline = session(timeoutRepo).nextActionAt; assert.notEqual(deadline, null);
  const result = await timeout.runDue('language-worker', new Date(Date.parse(deadline ?? '') + 1).toISOString());
  assert.equal(result[0]?.disposition, 'HUMAN_REVIEW'); assert.equal(session(timeoutRepo).state, 'HUMAN_REVIEW');
});

test('direct safety response before consent is rejected and duplicate callback cannot rebind idempotency', async () => {
  const invalidRepo = new MemoryRepository(); const invalid = new ContactOrchestrationService(invalidRepo, channel, ids); await invalid.open(openInput());
  assert.equal(await invalid.handleCallback(callback('RESPONSE')), 'HUMAN_REVIEW'); assert.equal(session(invalidRepo).state, 'HUMAN_REVIEW');

  const duplicateRepo = new MemoryRepository(); const duplicate = new ContactOrchestrationService(duplicateRepo, channel, ids); await duplicate.open(openInput());
  const first = callback('CONSENT_GRANTED', { callbackId: 'stable-callback' });
  assert.equal(await duplicate.handleCallback(first), 'APPLIED'); const version = session(duplicateRepo).version;
  assert.equal(await duplicate.handleCallback({ ...first, idempotencyKey: 'rebound-key' }), 'IDEMPOTENT');
  assert.equal(session(duplicateRepo).version, version);
});

test('partial response preserves structured identity confidence and schedules follow-up', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  assert.equal(await service.handleCallback(callback('PARTIAL_RESPONSE', { callbackId: 'callback-partial', occurredAt: '2026-07-29T15:00:20.000Z', identityConfidence: 'PARTIAL' })), 'APPLIED');
  assert.equal(session(repo).state, 'PARTIAL_RESPONSE'); assert.equal(session(repo).identityConfidence, 'PARTIAL');
  const deadline = session(repo).nextActionAt; assert.notEqual(deadline, null);
  await service.runDue('partial-worker', new Date(Date.parse(deadline ?? '') + 1).toISOString());
  assert.equal(session(repo).state, 'AWAITING_RESPONSE'); assert.equal(activeMessages(repo)[0]?.promptId, 'contact.response');
});

test('automated callback cannot confirm identity', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  const before = session(repo).version;
  const result = await service.handleCallback(callback('RESPONSE', { callbackId: 'callback-confirm', identityConfidence: 'CONFIRMED' as never }));
  assert.equal(result, 'HUMAN_REVIEW'); assert.equal(session(repo).version, before); assert.notEqual(session(repo).identityConfidence, 'CONFIRMED');
});

test('restart preserves NO_RESPONSE and does not duplicate logical retry', async () => {
  const repo = new MemoryRepository(); const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput()); await reachAwaitingResponse(first, repo);
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  assert.equal((await restarted.runDue('worker-a', '2026-07-29T15:00:41.000Z'))[0]?.disposition, 'APPLIED');
  assert.equal(session(repo).state, 'NO_RESPONSE');
  assert.deepEqual(await restarted.runDue('worker-b', '2026-07-29T15:00:41.000Z'), []);
  assert.equal((await restarted.runDue('worker-b', '2026-07-29T15:00:57.000Z'))[0]?.disposition, 'APPLIED');
  assert.equal(session(repo).state, 'CONTACTING');
  assert.equal((await restarted.runDue('worker-c', '2026-07-29T15:00:57.001Z'))[0]?.disposition, 'APPLIED');
  assert.equal(session(repo).state, 'AWAITING_RESPONSE');
  assert.equal([...repo.outbox.values()].filter((message) => message.attempt === 2 && message.promptId === 'contact.response').length, 1);
});

test('callbacks and takeover fail closed across authenticated tenant or case scope without inbox mutation', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const inboxBefore = repo.inbox.size; const original = session(repo);
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED', { tenantId: 'tenant-other', authenticatedTenantId: 'tenant-other' })), 'HUMAN_REVIEW');
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED', { authenticatedTenantId: 'tenant-other' })), 'HUMAN_REVIEW');
  assert.equal(await service.operatorTakeover(takeover({ caseId: 'case-other', authenticatedCaseId: 'case-other' })), 'HUMAN_REVIEW');
  assert.equal(await service.operatorTakeover(takeover({ authenticatedCaseId: 'case-other' })), 'HUMAN_REVIEW');
  assert.equal(repo.inbox.size, inboxBefore);
  assert.equal(session(repo).version, original.version);
  assert.equal(session(repo).automationSuppressed, false);
});

test('same session id may exist in another tenant without inbox audit or outbox collision', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput()), 'APPLIED');
  assert.equal(await service.open(openInput({ tenantId: 'tenant-jeddah', caseId: 'case-002', traceId: 'trace-002' })), 'APPLIED');
  assert.equal(repo.sessions.size, 2); assert.equal(repo.outbox.size, 2); assert.equal(repo.audits.size, 2);
});

test('authorized operator takeover atomically cancels pending outbox and records human authority', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  assert.equal(await service.operatorTakeover(takeover({ authorizedRole: 'SAFETY_LEAD' })), 'APPLIED');
  assert.equal(session(repo).automationSuppressed, true);
  assert.equal(activeMessages(repo).length, 0);
  assert.equal([...repo.audits.values()].find((event) => event.eventType === 'OPERATOR_TAKEOVER')?.authorizedByRole, 'SAFETY_LEAD');
  assert.deepEqual(await service.runDue('worker-a', '2026-07-29T16:00:00.000Z'), []);
});

test('outbox claim send and durable acknowledgement survive restart', async () => {
  resetProvider();
  const repo = new MemoryRepository(); const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput());
  const delivered = await first.runOutbox('outbox-worker-a', '2026-07-29T15:00:01.000Z');
  assert.equal(delivered[0]?.disposition, 'DELIVERED'); assert.equal(providerInvocations.length, 1);
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  assert.deepEqual(await restarted.runOutbox('outbox-worker-b', '2026-07-29T15:01:00.000Z'), []);
  assert.equal([...repo.outbox.values()][0]?.deliveredAt, '2026-07-29T15:00:01.000Z');
});

test('crash after provider send before database acknowledgement repeats transport key but not logical delivery', async () => {
  resetProvider();
  const repo = new MemoryRepository(); repo.crashAfterProviderSendOnce = true;
  const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput());
  await assert.rejects(first.runOutbox('outbox-worker-a', '2026-07-29T15:00:01.000Z'));
  assert.equal(providerInvocations.length, 1); assert.equal(providerLogicalDeliveries.size, 1);
  assert.equal([...repo.outbox.values()][0]?.deliveredAt, null);
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  const recovered = await restarted.runOutbox('outbox-worker-b', '2026-07-29T15:00:02.000Z');
  assert.equal(recovered[0]?.disposition, 'DELIVERED');
  assert.equal(providerInvocations.length, 2); assert.equal(providerLogicalDeliveries.size, 1);
  assert.equal(providerInvocations[0], providerInvocations[1]);
});

test('two outbox workers have exactly one claimant and stable provider idempotency key', async () => {
  resetProvider();
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const results = await Promise.all([service.runOutbox('outbox-worker-a', '2026-07-29T15:00:01.000Z'), service.runOutbox('outbox-worker-b', '2026-07-29T15:00:01.000Z')]);
  assert.equal(results.flat().filter((entry) => entry.disposition === 'DELIVERED').length, 1); assert.equal(providerInvocations.length, 1);
  assert.match(providerInvocations[0] ?? '', /^ros-eye\.contact-runtime\.v5\|tenant-riyadh\|case-001\|session-001\|/);
});

test('expired outbox lease is reclaimed and unavailable provider uses bounded durable retry', async () => {
  const repo = new MemoryRepository(); const unavailable: ContactChannelPort = { async send() { return 'UNAVAILABLE'; } }; const service = new ContactOrchestrationService(repo, unavailable, ids); await service.open(openInput());
  await repo.claimDueOutbox({ workerId: 'crashed-worker', now: '2026-07-29T15:00:01.000Z', leaseMs: 1_000, limit: 1 });
  assert.deepEqual(await service.runOutbox('recovery-worker', '2026-07-29T15:00:01.500Z'), []);
  const retried = await service.runOutbox('recovery-worker', '2026-07-29T15:00:02.001Z');
  assert.equal(retried[0]?.disposition, 'RETRY');
  const message = [...repo.outbox.values()][0]; assert.equal(message?.lastErrorCode, 'channel_unavailable'); assert.equal(message?.leaseOwner, null);
  assert.equal(message?.availableAt, '2026-07-29T15:00:17.001Z');
});

test('takeover after claim but before delivery is fenced and cannot call provider', async () => {
  resetProvider();
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  const [claimed] = await repo.claimDueOutbox({ workerId: 'outbox-worker-a', now: '2026-07-29T15:00:11.000Z', leaseMs: 30_000, limit: 1 });
  assert.ok(claimed); assert.equal(claimed.promptId, 'contact.response');
  await service.operatorTakeover(takeover({ occurredAt: '2026-07-29T15:00:12.000Z' }));
  let calls = 0;
  const result = await repo.processClaimedOutbox({ ...scope, messageId: claimed.messageId, workerId: 'outbox-worker-a', now: '2026-07-29T15:00:13.000Z', retryAvailableAt: '2026-07-29T15:00:28.000Z', errorCode: 'channel_unavailable' }, async () => { calls += 1; return 'SENT'; });
  assert.notEqual(result, 'DELIVERED'); assert.equal(calls, 0); assert.equal(providerInvocations.length, 0);
});

test('PostgreSQL adapter SQL uses composite scope SKIP LOCKED claims and a pre-send row fence', () => {
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueSessions, /FOR UPDATE SKIP LOCKED/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueOutbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueSessions, /RETURNING session\.\*/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueOutbox, /RETURNING message\.\*/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.getClaimedOutboxForDelivery, /tenant_id = \$1 AND case_id = \$2 AND session_id = \$3/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.getClaimedOutboxForDelivery, /lease_owner = \$5/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.getClaimedOutboxForDelivery, /FOR UPDATE/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxDelivered, /cancelled_at IS NULL/);
});

test('bounded contact retries follow NO_RESPONSE to CONTACTING and escalate without silent completion', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  await driveUntilEscalated(service, repo);
  assert.equal(session(repo).state, 'ESCALATED');
  assert.equal([...repo.audits.values()].some((event) => event.state === 'COMPLETED'), false);
  assert.equal([...repo.outbox.values()].filter((message) => message.promptId === 'contact.response').length, 3);
});
