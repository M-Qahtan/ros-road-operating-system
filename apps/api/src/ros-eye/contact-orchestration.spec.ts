import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ContactOrchestrationService,
  deliverOutbox,
  type ContactAuditEvent,
  type ContactChannelPort,
  type ContactOutboxMessage,
  type ContactRuntimeRepositoryPort,
  type ContactRuntimeTransaction,
  type ContactSessionRecord
} from './contact-orchestration.js';

class MemoryRepository implements ContactRuntimeRepositoryPort, ContactRuntimeTransaction {
  readonly sessions = new Map<string, ContactSessionRecord>();
  readonly inbox = new Set<string>();
  readonly audits = new Map<string, ContactAuditEvent>();
  readonly outbox = new Map<string, ContactOutboxMessage>();
  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> { return work(this); }
  async getSessionForUpdate(id: string) { return this.sessions.get(id) ?? null; }
  async insertSession(session: ContactSessionRecord) { if (this.sessions.has(session.sessionId)) throw new Error('duplicate'); this.sessions.set(session.sessionId, session); }
  async updateSession(session: ContactSessionRecord, expectedVersion: number) { const current = this.sessions.get(session.sessionId); if (!current || current.version !== expectedVersion) return 'CONFLICT' as const; this.sessions.set(session.sessionId, session); return 'UPDATED' as const; }
  async insertInboxIfAbsent(key: string) { if (this.inbox.has(key)) return 'EXISTS' as const; this.inbox.add(key); return 'INSERTED' as const; }
  async insertAuditIfAbsent(event: ContactAuditEvent) { if (this.audits.has(event.eventId)) return 'EXISTS' as const; this.audits.set(event.eventId, event); return 'INSERTED' as const; }
  async insertOutboxIfAbsent(message: ContactOutboxMessage) { if (this.outbox.has(message.messageId)) return 'EXISTS' as const; this.outbox.set(message.messageId, message); return 'INSERTED' as const; }
  async cancelPendingAutomation(sessionId: string) { for (const [id, msg] of this.outbox) if (msg.sessionId === sessionId) this.outbox.delete(id); }
  async claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }) { const result: ContactSessionRecord[] = []; for (const session of this.sessions.values()) { if (result.length >= input.limit) break; if (session.automationSuppressed || session.nextActionAt === null || Date.parse(session.nextActionAt) > Date.parse(input.now)) continue; const leased = { ...session, leaseOwner: input.workerId, leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString() }; this.sessions.set(session.sessionId, leased); result.push(leased); } return result; }
  async releaseLease(sessionId: string, workerId: string) { const current = this.sessions.get(sessionId); if (current?.leaseOwner === workerId) this.sessions.set(sessionId, { ...current, leaseOwner: null, leaseExpiresAt: null }); }
}

const ids = { async create(namespace: string, material: string) { return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`; } };
const channel: ContactChannelPort = { async send() { return 'SENT'; } };
function openInput() { return { tenantId: 'tenant-riyadh', sessionId: 'session-001', caseId: 'case-001', language: 'ar' as const, traceId: 'trace-001', occurredAt: '2026-07-29T15:00:00.000Z', idempotencyKey: 'open-001', preferredChannel: 'IN_APP' as const }; }

test('opening is transactional and idempotent with no raw sensitive body', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids);
  assert.equal(await service.open(openInput()), 'APPLIED');
  assert.equal(await service.open(openInput()), 'IDEMPOTENT');
  assert.equal(repo.sessions.size, 1); assert.equal(repo.outbox.size, 1); assert.equal(repo.audits.size, 1);
  const serialized = JSON.stringify([...repo.sessions.values(), ...repo.audits.values(), ...repo.outbox.values()]);
  for (const forbidden of ['phoneNumber', 'medicalNarrative', 'replayToken', 'latitude', 'longitude', 'rawBody']) assert.equal(serialized.includes(forbidden), false);
});

test('restart resumes durable deadline without duplicating attempts', async () => {
  const repo = new MemoryRepository();
  const firstProcess = new ContactOrchestrationService(repo, channel, ids);
  await firstProcess.open(openInput());
  const restarted = new ContactOrchestrationService(repo, channel, ids);
  const dueAt = '2026-07-29T15:00:31.000Z';
  assert.deepEqual(await restarted.runDue('worker-a', dueAt), [{ sessionId: 'session-001', disposition: 'APPLIED' }]);
  assert.equal(repo.sessions.get('session-001')?.attemptCount, 2);
  assert.deepEqual(await restarted.runDue('worker-b', dueAt), []);
  assert.equal(repo.sessions.get('session-001')?.attemptCount, 2);
});

test('bounded retries escalate and never silently complete', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  await service.runDue('worker-a', '2026-07-29T15:00:31.000Z');
  await service.runDue('worker-a', '2026-07-29T15:01:02.000Z');
  const final = await service.runDue('worker-a', '2026-07-29T15:01:33.000Z');
  assert.equal(final[0]?.disposition, 'ESCALATED');
  assert.equal(repo.sessions.get('session-001')?.state, 'ESCALATED');
  assert.notEqual(repo.sessions.get('session-001')?.state, 'COMPLETED');
});

test('operator takeover atomically suppresses pending automation', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  assert.equal(await service.operatorTakeover({ sessionId: 'session-001', operatorId: 'operator-001', traceId: 'trace-takeover', occurredAt: '2026-07-29T15:00:10.000Z', idempotencyKey: 'takeover-001' }), 'APPLIED');
  const session = repo.sessions.get('session-001'); assert.equal(session?.automationSuppressed, true); assert.equal(session?.state, 'OPERATOR_TAKEOVER'); assert.equal(repo.outbox.size, 0);
  assert.deepEqual(await service.runDue('worker-a', '2026-07-29T16:00:00.000Z'), []);
});

test('duplicate callback is exactly once and contradiction fails to human review', async () => {
  const repo = new MemoryRepository(); const service = new ContactOrchestrationService(repo, channel, ids); await service.open(openInput());
  const callback = { sessionId: 'session-001', traceId: 'trace-callback', occurredAt: '2026-07-29T15:00:05.000Z', idempotencyKey: 'callback-001', kind: 'CONTRADICTORY' as const };
  assert.equal(await service.handleCallback(callback), 'HUMAN_REVIEW');
  const version = repo.sessions.get('session-001')?.version;
  assert.equal(await service.handleCallback(callback), 'IDEMPOTENT');
  assert.equal(repo.sessions.get('session-001')?.version, version);
  assert.equal(repo.sessions.get('session-001')?.state, 'HUMAN_REVIEW');
});

test('outbox delivery is vendor-neutral and reports retry on dependency outage', async () => {
  const message: ContactOutboxMessage = { messageId: 'message-001', sessionId: 'session-001', channel: 'SMS_SIM', promptId: 'contact.response', idempotencyKey: 'delivery-001', availableAt: '2026-07-29T15:00:00.000Z', attempt: 3 };
  assert.equal(await deliverOutbox(message, { async send() { return 'UNAVAILABLE'; } }), 'RETRY');
  assert.equal(await deliverOutbox(message, channel), 'DELIVERED');
});
