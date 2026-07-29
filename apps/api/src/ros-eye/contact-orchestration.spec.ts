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
  readonly deliveryReservations = new Map<string, { token: string; deadlineAt: string }>();
  crashAfterProviderSendOnce = false;

  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> { return work(this); }
  async getSessionForUpdate(scope: ContactScope) { return this.sessions.get(scopedKey(scope)) ?? null; }
  async insertSession(session: ContactSessionRecord) { const key = scopedKey(session); if (this.sessions.has(key)) throw new Error('duplicate'); this.sessions.set(key, session); }
  async updateSession(session: ContactSessionRecord, expectedVersion: number) { const key = scopedKey(session); const current = this.sessions.get(key); if (!current || current.version !== expectedVersion) return 'CONFLICT' as const; this.sessions.set(key, session); return 'UPDATED' as const; }
  async insertInboxIfAbsent(scope: ContactScope, key: string) { const scoped = `${scopedKey(scope)}|${key}`; if (this.inbox.has(scoped)) return 'EXISTS' as const; this.inbox.add(scoped); return 'INSERTED' as const; }
  async insertAuditIfAbsent(event: ContactAuditEvent) { const key = `${scopedKey(event)}|${event.eventId}`; if (this.audits.has(key)) return 'EXISTS' as const; this.audits.set(key, event); return 'INSERTED' as const; }
  async insertOutboxIfAbsent(message: ContactOutboxMessage) { const key = outboxKey(message); if (this.outbox.has(key)) return 'EXISTS' as const; this.outbox.set(key, message); return 'INSERTED' as const; }
  async cancelPendingAutomation(scope: ContactScope, occurredAt: string) {
    for (const [key, message] of this.outbox) {
      if (scopedKey(message) !== scopedKey(scope) || message.deliveredAt !== null || message.cancelledAt !== null) continue;
      this.outbox.set(key, { ...message, cancelledAt: occurredAt, leaseOwner: null, leaseExpiresAt: null });
      this.deliveryReservations.delete(key);
    }
  }

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
      const reservation = this.deliveryReservations.get(key);
      const reservationExpired = reservation !== undefined && Date.parse(reservation.deadlineAt) <= Date.parse(input.now);
      if (reservation !== undefined && !reservationExpired) continue;
      if (reservationExpired) this.deliveryReservations.delete(key);
      const leaseActive = message.leaseExpiresAt !== null && Date.parse(message.leaseExpiresAt) > Date.parse(input.now);
      if ((leaseActive && !reservationExpired) || message.deliveredAt !== null || message.cancelledAt !== null || Date.parse(message.availableAt) > Date.parse(input.now)) continue;
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
    this.deliveryReservations.set(key, { token: input.deliveryToken, deadlineAt: input.deliveryDeadlineAt });
    const result = await deliver(current);
    if (this.crashAfterProviderSendOnce) { this.crashAfterProviderSendOnce = false; throw new Error('simulated crash after provider send'); }
    const fenced = this.outbox.get(key); const reservation = this.deliveryReservations.get(key);
    if (!fenced || fenced.cancelledAt !== null) return 'CANCELLED';
    if (fenced.leaseOwner !== input.workerId || reservation?.token !== input.deliveryToken) return 'CONFLICT';
    this.deliveryReservations.delete(key);
    if (result === 'SENT') { this.outbox.set(key, { ...fenced, deliveredAt: input.now, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null }); return 'DELIVERED'; }
    this.outbox.set(key, { ...fenced, availableAt: input.retryAvailableAt, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: input.errorCode }); return 'RETRY';
  }

  async releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }) {
    const key = outboxKey(input); const current = this.outbox.get(key); const reservation = this.deliveryReservations.get(key);
    if (current?.leaseOwner === input.workerId && reservation === undefined) this.outbox.set(key, { ...current, leaseOwner: null, leaseExpiresAt: null });
  }
}

const ids = { async create(namespace: string, material: string) { return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`; } };
const providerInvocations: string[] = [];
const providerLogicalDeliveries = new Set<string>();
const channel: ContactChannelPort = { async send(input) { providerInvocations.push(input.idempotencyKey); providerLogicalDeliveries.add(input.idempotencyKey); return 'SENT'; } };
const scope = { tenantId: 'tenant-riyadh', caseId: 'case-001', sessionId: 'session-001' } as const;

function openInput(overrides: Partial<OpenContactInput> = {}): OpenContactInput { return { ...scope, language: 'ar', traceId: 'trace-001', occurredAt: '2026-07-29T15:00:00.000Z', idempotencyKey: 'open-001', preferredChannel: 'IN_APP', ...overrides }; }
function callback(kind: ContactCallbackKind, overrides: Partial<CallbackInput> = {}): CallbackInput { return { ...scope, authenticatedTenantId: 'tenant-riyadh', authenticatedCaseId: 'case-001', callbackId: `callback-${kind.toLowerCase()}`, traceId: `trace-${kind.toLowerCase()}`, occurredAt: '2026-07-29T15:00:05.000Z', idempotencyKey: `key-${kind.toLowerCase()}`, kind, ...overrides }; }
function takeover(overrides: Partial<OperatorTakeoverInput> = {}): OperatorTakeoverInput { return { ...scope, operatorId: 'operator-001', authenticatedTenantId: 'tenant-riyadh', authenticatedCaseId: 'case-001', authorizedRole: 'OPERATOR', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:20.000Z', idempotencyKey: 'takeover-001', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION, ...overrides }; }
function session(repo: MemoryRepository): ContactSessionRecord { const value = repo.sessions.get(scopedKey(scope)); assert.ok(value); return value; }
function activeMessages(repo: MemoryRepository): ContactOutboxMessage[] { return [...repo.outbox.values()].filter((message) => message.cancelledAt === null && message.deliveredAt === null); }
function resetProvider(): void { providerInvocations.length = 0; providerLogicalDeliveries.clear(); }

async function reachAwaitingResponse(service: ContactOrchestrationService, repo: MemoryRepository): Promise<void> {
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED')), 'APPLIED');
  assert.equal(await service.handleCallback(callback('LANGUAGE_SELECTED', { callbackId: 'callback-language', occurredAt: '2026-07-29T15:00:10.000Z', selectedLanguage: 'ar' })), 'APPLIED');
  assert.equal((await service.runDue('protocol-worker', '2026-07-29T15:00:10.001Z'))[0]?.disposition, 'APPLIED');
  assert.equal(session(repo).state, 'AWAITING_RESPONSE');
}

async function driveUntilEscalated(service: ContactOrchestrationService, repo: MemoryRepository): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const current = session(repo); if (current.state === 'ESCALATED') return;
    assert.notEqual(current.nextActionAt, null);
    await service.runDue(`retry-worker-${index}`, new Date(Date.parse(current.nextActionAt ?? '') + 1).toISOString());
  }
  assert.fail('contact runtime did not reach ESCALATED within bounded transitions');
}

test('protocol begins with consent, requires language choice, and emits no raw sensitive data', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput({ language: 'UNKNOWN' })), 'APPLIED'); assert.equal(await service.open(openInput({ language: 'UNKNOWN' })), 'IDEMPOTENT');
  assert.equal(session(repo).state, 'CONSENT_PENDING'); assert.equal(activeMessages(repo)[0]?.promptId, 'contact.consent');
  assert.equal(await service.handleCallback(callback('CONSENT_GRANTED')), 'APPLIED'); assert.equal(session(repo).state, 'LANGUAGE_SELECTION'); assert.equal(activeMessages(repo)[0]?.promptId, 'contact.language');
  assert.equal(await service.handleCallback(callback('LANGUAGE_SELECTED', { callbackId: 'callback-language', occurredAt: '2026-07-29T15:00:10.000Z', selectedLanguage: 'en' })), 'APPLIED');
  assert.equal(session(repo).state, 'CONTACTING'); assert.equal(session(repo).language, 'en'); assert.equal(activeMessages(repo).length, 0);
  await service.runDue('protocol-worker', '2026-07-29T15:00:10.001Z'); assert.equal(session(repo).state, 'AWAITING_RESPONSE'); assert.equal(activeMessages(repo)[0]?.promptId, 'contact.response');
  const serialized = JSON.stringify([...repo.sessions.values(), ...repo.audits.values(), ...repo.outbox.values()]);
  for (const forbidden of ['phoneNumber', 'medicalNarrative', 'replayToken', 'latitude', 'longitude', 'rawBody']) assert.equal(serialized.includes(forbidden), false);
});

test('refusal, out-of-order callbacks, duplicates, and automatic identity confirmation fail closed', async () => {
  const refusedRepo = new MemoryRepository(); const refused = new ContactOrchestrationService(refusedRepo, channel, ids); await refused.open(openInput());
  assert.equal(await refused.handleCallback(callback('CONSENT_DECLINED')), 'HUMAN_REVIEW'); assert.equal(session(refusedRepo).state, 'HUMAN_REVIEW');
  const invalidRepo = new MemoryRepository(); const invalid = new ContactOrchestrationService(invalidRepo, channel, ids); await invalid.open(openInput());
  assert.equal(await invalid.handleCallback(callback('RESPONSE')), 'HUMAN_REVIEW'); assert.equal(session(invalidRepo).state, 'HUMAN_REVIEW');
  const duplicateRepo = new MemoryRepository(); const duplicate = new ContactOrchestrationService(duplicateRepo, channel, ids); await duplicate.open(openInput());
  const first = callback('CONSENT_GRANTED', { callbackId: 'stable-callback' }); assert.equal(await duplicate.handleCallback(first), 'APPLIED'); const version = session(duplicateRepo).version;
  assert.equal(await duplicate.handleCallback({ ...first, idempotencyKey: 'rebound-key' }), 'IDEMPOTENT'); assert.equal(session(duplicateRepo).version, version);
  const identityRepo = new MemoryRepository(); const identity = new ContactOrchestrationService(identityRepo, channel, ids); await identity.open(openInput()); await reachAwaitingResponse(identity, identityRepo);
  const before = session(identityRepo).version; assert.equal(await identity.handleCallback(callback('RESPONSE', { callbackId: 'callback-confirm', identityConfidence: 'CONFIRMED' as never })), 'HUMAN_REVIEW');
  assert.equal(session(identityRepo).version, before); assert.notEqual(session(identityRepo).identityConfidence, 'CONFIRMED');
});

test('restart preserves deadlines, retries through approved states, and escalates without completion', async () => {
  const repo = new MemoryRepository(); const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput()); await reachAwaitingResponse(first, repo);
  const restarted = new ContactOrchestrationService(repo, channel, ids); await restarted.runDue('worker-a', '2026-07-29T15:00:41.000Z'); assert.equal(session(repo).state, 'NO_RESPONSE');
  await driveUntilEscalated(restarted, repo); assert.equal(session(repo).state, 'ESCALATED'); assert.equal([...repo.audits.values()].some((event) => event.state === 'COMPLETED'), false);
  assert.equal([...repo.outbox.values()].filter((message) => message.promptId === 'contact.response').length, 3);
});

test('tenant/case scope and human takeover authority suppress automation atomically', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  const inboxBefore = repo.inbox.size; const originalVersion = session(repo).version;
  assert.equal(await service.handleCallback(callback('RESPONSE', { authenticatedTenantId: 'tenant-other' })), 'HUMAN_REVIEW'); assert.equal(await service.operatorTakeover(takeover({ authenticatedCaseId: 'case-other' })), 'HUMAN_REVIEW');
  assert.equal(repo.inbox.size, inboxBefore); assert.equal(session(repo).version, originalVersion);
  assert.equal(await service.operatorTakeover(takeover({ authorizedRole: 'SAFETY_LEAD' })), 'APPLIED'); assert.equal(session(repo).automationSuppressed, true); assert.equal(activeMessages(repo).length, 0);
  assert.equal([...repo.audits.values()].find((event) => event.eventType === 'OPERATOR_TAKEOVER')?.authorizedByRole, 'SAFETY_LEAD');
});

test('outbox acknowledgement, crash recovery, concurrent claim, and retry preserve logical idempotency', async () => {
  resetProvider(); const deliveredRepo = new MemoryRepository(); const delivered = new ContactOrchestrationService(deliveredRepo, channel, ids); await delivered.open(openInput());
  assert.equal((await delivered.runOutbox('worker-a', '2026-07-29T15:00:01.000Z'))[0]?.disposition, 'DELIVERED'); assert.deepEqual(await delivered.runOutbox('worker-b', '2026-07-29T15:01:00.000Z'), []);
  resetProvider(); const crashRepo = new MemoryRepository(); crashRepo.crashAfterProviderSendOnce = true; const crashing = new ContactOrchestrationService(crashRepo, channel, ids); await crashing.open(openInput());
  await assert.rejects(crashing.runOutbox('worker-a', '2026-07-29T15:00:01.000Z')); assert.equal(providerLogicalDeliveries.size, 1); assert.deepEqual(await crashing.runOutbox('worker-b', '2026-07-29T15:00:05.999Z'), []);
  assert.equal((await crashing.runOutbox('worker-b', '2026-07-29T15:00:06.001Z'))[0]?.disposition, 'DELIVERED'); assert.equal(providerInvocations.length, 2); assert.equal(providerLogicalDeliveries.size, 1); assert.equal(providerInvocations[0], providerInvocations[1]);
  resetProvider(); const concurrentRepo = new MemoryRepository(); const concurrent = new ContactOrchestrationService(concurrentRepo, channel, ids); await concurrent.open(openInput());
  const results = await Promise.all([concurrent.runOutbox('worker-a', '2026-07-29T15:00:01.000Z'), concurrent.runOutbox('worker-b', '2026-07-29T15:00:01.000Z')]);
  assert.equal(results.flat().filter((entry) => entry.disposition === 'DELIVERED').length, 1); assert.equal(providerInvocations.length, 1); assert.match(providerInvocations[0] ?? '', /^ros-eye\.contact-runtime\.v6\|tenant-riyadh\|case-001\|session-001\|/);
});

test('provider promise that never resolves is aborted at the enforceable deadline', async () => {
  const repo = new MemoryRepository(); const observedSignals: AbortSignal[] = [];
  const hung: ContactChannelPort = { async send(input) { observedSignals.push(input.signal); return new Promise<'UNAVAILABLE'>((resolve) => input.signal.addEventListener('abort', () => resolve('UNAVAILABLE'), { once: true })); } };
  const service = new ContactOrchestrationService(repo, hung, ids, { outboxLeaseMs: 100, deliveryTimeoutMs: 10 }); await service.open(openInput());
  const started = Date.now(); const result = await service.runOutbox('hung-worker', '2026-07-29T15:00:01.000Z');
  assert.equal(result[0]?.disposition, 'RETRY'); assert.ok(Date.now() - started < 250); assert.equal(observedSignals[0]?.aborted, true); assert.equal([...repo.outbox.values()][0]?.lastErrorCode, 'channel_delivery_failed_or_timed_out');
});

test('operator takeover completes while provider is hung and invalidates later acknowledgement', async () => {
  const repo = new MemoryRepository(); let startedResolve!: () => void; const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const hung: ContactChannelPort = { async send(input) { startedResolve(); return new Promise<'UNAVAILABLE'>((resolve) => input.signal.addEventListener('abort', () => resolve('UNAVAILABLE'), { once: true })); } };
  const service = new ContactOrchestrationService(repo, hung, ids, { outboxLeaseMs: 200, deliveryTimeoutMs: 30 }); await service.open(openInput()); await reachAwaitingResponse(service, repo);
  const running = service.runOutbox('hung-worker', '2026-07-29T15:00:11.000Z'); await started; const takeoverStarted = Date.now();
  assert.equal(await service.operatorTakeover(takeover({ occurredAt: '2026-07-29T15:00:12.000Z' })), 'APPLIED'); assert.ok(Date.now() - takeoverStarted < 100); assert.equal((await running)[0]?.disposition, 'CANCELLED'); assert.equal(activeMessages(repo).length, 0);
});

test('PostgreSQL contracts use composite claims, short token reservations, and deadline-fenced finalization', () => {
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueSessions, /FOR UPDATE SKIP LOCKED/); assert.match(POSTGRES_CONTACT_RUNTIME_SQL.claimDueOutbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.reserveOutboxDelivery, /delivery_token = \$7/); assert.doesNotMatch(POSTGRES_CONTACT_RUNTIME_SQL.reserveOutboxDelivery, /FOR UPDATE/);
  assert.match(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxDelivered, /delivery_token = \$6/); assert.match(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxDelivered, /delivery_deadline_at >= clock_timestamp\(\)/); assert.match(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxRetry, /cancelled_at IS NULL/);
});
