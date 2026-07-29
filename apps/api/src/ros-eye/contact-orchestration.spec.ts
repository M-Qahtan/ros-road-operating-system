import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
  ContactOrchestrationService,
  type ContactAuditEvent,
  type ContactChannelPort,
  type ContactOutboxMessage,
  type ContactRuntimeRepositoryPort,
  type ContactRuntimeTransaction,
  type ContactScope,
  type ContactSessionRecord
} from './contact-orchestration.js';

const scopedKey = (value: ContactScope) => `${value.tenantId}|${value.caseId}|${value.sessionId}`;
const outboxKey = (value: ContactScope & { messageId: string }) => `${scopedKey(value)}|${value.messageId}`;

class MemoryRepository implements ContactRuntimeRepositoryPort, ContactRuntimeTransaction {
  readonly sessions = new Map<string, ContactSessionRecord>();
  readonly inbox = new Set<string>();
  readonly audits = new Map<string, ContactAuditEvent>();
  readonly outbox = new Map<string, ContactOutboxMessage>();

  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> { return work(this); }
  async getSessionForUpdate(scope: ContactScope) { return this.sessions.get(scopedKey(scope)) ?? null; }
  async insertSession(session: ContactSessionRecord) { const key = scopedKey(session); if (this.sessions.has(key)) throw new Error('duplicate'); this.sessions.set(key, session); }
  async updateSession(session: ContactSessionRecord, expectedVersion: number) { const key = scopedKey(session); const current = this.sessions.get(key); if (!current || current.version !== expectedVersion) return 'CONFLICT' as const; this.sessions.set(key, session); return 'UPDATED' as const; }
  async insertInboxIfAbsent(scope: ContactScope, key: string) { const scoped = `${scopedKey(scope)}|${key}`; if (this.inbox.has(scoped)) return 'EXISTS' as const; this.inbox.add(scoped); return 'INSERTED' as const; }
  async insertAuditIfAbsent(event: ContactAuditEvent) { const key = `${scopedKey(event)}|${event.eventId}`; if (this.audits.has(key)) return 'EXISTS' as const; this.audits.set(key, event); return 'INSERTED' as const; }
  async insertOutboxIfAbsent(message: ContactOutboxMessage) { const key = outboxKey(message); if (this.outbox.has(key)) return 'EXISTS' as const; this.outbox.set(key, message); return 'INSERTED' as const; }
  async cancelPendingAutomation(scope: ContactScope, occurredAt: string) { for (const [key, message] of this.outbox) if (scopedKey(message) === scopedKey(scope) && message.deliveredAt === null) this.outbox.set(key, { ...message, cancelledAt: occurredAt, leaseOwner: null, leaseExpiresAt: null }); }

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
  async markOutboxDelivered(input: ContactScope & { messageId: string; workerId: string; deliveredAt: string }) {
    const key = outboxKey(input); const current = this.outbox.get(key);
    if (!current || current.leaseOwner !== input.workerId) return 'CONFLICT' as const;
    if (current.cancelledAt !== null) return 'CANCELLED' as const;
    this.outbox.set(key, { ...current, deliveredAt: input.deliveredAt, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null }); return 'UPDATED' as const;
  }
  async markOutboxRetry(input: ContactScope & { messageId: string; workerId: string; availableAt: string; errorCode: string }) {
    const key = outboxKey(input); const current = this.outbox.get(key);
    if (!current || current.leaseOwner !== input.workerId) return 'CONFLICT' as const;
    if (current.cancelledAt !== null) return 'CANCELLED' as const;
    this.outbox.set(key, { ...current, availableAt: input.availableAt, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: input.errorCode }); return 'UPDATED' as const;
  }
  async releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }) { const key = outboxKey(input); const current = this.outbox.get(key); if (current?.leaseOwner === input.workerId) this.outbox.set(key, { ...current, leaseOwner: null, leaseExpiresAt: null }); }
}

const ids = { async create(namespace: string, material: string) { return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`; } };
const sentKeys: string[] = [];
const channel: ContactChannelPort = { async send(input) { sentKeys.push(input.idempotencyKey); return 'SENT'; } };
const scope = { tenantId: 'tenant-riyadh', caseId: 'case-001', sessionId: 'session-001' } as const;
function openInput(overrides: Record<string, unknown> = {}) { return { ...scope, language: 'ar' as const, traceId: 'trace-001', occurredAt: '2026-07-29T15:00:00.000Z', idempotencyKey: 'open-001', preferredChannel: 'IN_APP' as const, ...overrides }; }
function callback(kind: 'RESPONSE' | 'CONTRADICTORY' | 'DISCONNECTED' | 'CHANNEL_FAILURE' = 'RESPONSE', overrides: Record<string, unknown> = {}) { return { ...scope, callbackId: 'callback-001', traceId: 'trace-callback', occurredAt: '2026-07-29T15:00:05.000Z', idempotencyKey: 'callback-key', kind, ...overrides }; }

async function advanceToRetry(service: ContactOrchestrationService) { await service.runDue('worker-a', '2026-07-29T15:00:31.000Z'); await service.runDue('worker-a', '2026-07-29T15:00:47.000Z'); }

test('opening is scoped, transactional and contains no raw sensitive fields', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput()), 'APPLIED'); assert.equal(await service.open(openInput()), 'IDEMPOTENT');
  assert.equal(repo.sessions.size, 1); assert.equal(repo.outbox.size, 1); assert.equal(repo.audits.size, 1);
  const serialized = JSON.stringify([...repo.sessions.values(), ...repo.audits.values(), ...repo.outbox.values()]);
  for (const forbidden of ['phoneNumber', 'medicalNarrative', 'replayToken', 'latitude', 'longitude', 'rawBody']) assert.equal(serialized.includes(forbidden), false);
});

test('restart preserves NO_RESPONSE and does not duplicate logical retry', async () => {
  const repo = new MemoryRepository(); const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput());
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  assert.equal((await restarted.runDue('worker-a', '2026-07-29T15:00:31.000Z'))[0]?.disposition, 'APPLIED');
  assert.equal(repo.sessions.get(scopedKey(scope))?.state, 'NO_RESPONSE');
  assert.deepEqual(await restarted.runDue('worker-b', '2026-07-29T15:00:31.000Z'), []);
  assert.equal((await restarted.runDue('worker-b', '2026-07-29T15:00:47.000Z'))[0]?.disposition, 'APPLIED');
  assert.equal([...repo.outbox.values()].filter((message) => message.attempt === 2).length, 1);
});

test('callbacks and takeover fail closed across tenant or case scope', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const original = repo.sessions.get(scopedKey(scope));
  assert.equal(await service.handleCallback(callback('RESPONSE', { tenantId: 'tenant-other' })), 'HUMAN_REVIEW');
  assert.equal(await service.operatorTakeover({ ...scope, caseId: 'case-other', operatorId: 'operator-001', authenticatedTenantId: 'tenant-riyadh', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:10.000Z', idempotencyKey: 'takeover-001', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION }), 'HUMAN_REVIEW');
  assert.equal(repo.sessions.get(scopedKey(scope))?.version, original?.version);
  assert.equal(repo.sessions.get(scopedKey(scope))?.automationSuppressed, false);
});

test('same session id may exist in another tenant without inbox, audit or outbox collision', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput()), 'APPLIED');
  assert.equal(await service.open(openInput({ tenantId: 'tenant-jeddah', caseId: 'case-002', traceId: 'trace-002' })), 'APPLIED');
  assert.equal(repo.sessions.size, 2); assert.equal(repo.outbox.size, 2); assert.equal(repo.audits.size, 2);
});

test('authorized operator takeover atomically cancels pending outbox and suppresses automation', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const result = await service.operatorTakeover({ ...scope, operatorId: 'operator-001', authenticatedTenantId: 'tenant-riyadh', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:10.000Z', idempotencyKey: 'takeover-001', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION });
  assert.equal(result, 'APPLIED'); assert.equal(repo.sessions.get(scopedKey(scope))?.automationSuppressed, true);
  assert.equal([...repo.outbox.values()][0]?.cancelledAt, '2026-07-29T15:00:10.000Z');
  assert.deepEqual(await service.runDue('worker-a', '2026-07-29T16:00:00.000Z'), []);
});

test('outbox claim, send and durable acknowledgement survive restart', async () => {
  sentKeys.length = 0;
  const repo = new MemoryRepository(); const first = new ContactOrchestrationService(repo, channel, ids); await first.open(openInput());
  const delivered = await first.runOutbox('outbox-worker-a', '2026-07-29T15:00:01.000Z');
  assert.equal(delivered[0]?.disposition, 'DELIVERED'); assert.equal(sentKeys.length, 1);
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  assert.deepEqual(await restarted.runOutbox('outbox-worker-b', '2026-07-29T15:01:00.000Z'), []);
  assert.equal([...repo.outbox.values()][0]?.deliveredAt, '2026-07-29T15:00:01.000Z');
});

test('two outbox workers have exactly one claimant and stable provider idempotency key', async () => {
  sentKeys.length = 0;
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const results = await Promise.all([service.runOutbox('outbox-worker-a', '2026-07-29T15:00:01.000Z'), service.runOutbox('outbox-worker-b', '2026-07-29T15:00:01.000Z')]);
  assert.equal(results.flat().filter((entry) => entry.disposition === 'DELIVERED').length, 1); assert.equal(sentKeys.length, 1);
  assert.match(sentKeys[0] ?? '', /^tenant-riyadh\|case-001\|session-001\|/);
});

test('expired outbox lease is reclaimed and unavailable provider uses bounded durable retry', async () => {
  const repo = new MemoryRepository(); const unavailable: ContactChannelPort = { async send() { return 'UNAVAILABLE'; } }; const service = new ContactOrchestrationService(repo, unavailable, ids); await service.open(openInput());
  await repo.claimDueOutbox({ workerId: 'crashed-worker', now: '2026-07-29T15:00:01.000Z', leaseMs: 1_000, limit: 1 });
  assert.deepEqual(await service.runOutbox('recovery-worker', '2026-07-29T15:00:01.500Z'), []);
  const retried = await service.runOutbox('recovery-worker', '2026-07-29T15:00:02.001Z');
  assert.equal(retried[0]?.disposition, 'RETRY');
  const message = [...repo.outbox.values()][0]; assert.equal(message?.lastErrorCode, 'channel_unavailable'); assert.equal(message?.leaseOwner, null);
});

test('takeover racing a claimed message fences durable acknowledgement', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const [claimed] = await repo.claimDueOutbox({ workerId: 'outbox-worker-a', now: '2026-07-29T15:00:01.000Z', leaseMs: 30_000, limit: 1 });
  assert.ok(claimed);
  await service.operatorTakeover({ ...scope, operatorId: 'operator-001', authenticatedTenantId: 'tenant-riyadh', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:02.000Z', idempotencyKey: 'takeover-001', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION });
  const marked = await repo.markOutboxDelivered({ ...scope, messageId: claimed.messageId, workerId: 'outbox-worker-a', deliveredAt: '2026-07-29T15:00:03.000Z' });
  assert.notEqual(marked, 'UPDATED'); assert.notEqual([...repo.outbox.values()][0]?.deliveredAt, '2026-07-29T15:00:03.000Z');
});

test('bounded retries escalate and never silently complete', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  await advanceToRetry(service); await service.runDue('worker-a', '2026-07-29T15:01:18.000Z'); await service.runDue('worker-a', '2026-07-29T15:01:34.000Z'); await service.runDue('worker-a', '2026-07-29T15:02:05.000Z');
  const final = await service.runDue('worker-a', '2026-07-29T15:02:21.000Z');
  assert.equal(final[0]?.disposition, 'ESCALATED'); assert.equal(repo.sessions.get(scopedKey(scope))?.state, 'ESCALATED');
});
