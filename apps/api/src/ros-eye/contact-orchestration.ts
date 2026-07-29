import {
  HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS,
  HUMAN_CONTACT_RESPONSE_DEADLINE_MS,
  HUMAN_CONTACT_RETRY_BASE_DELAY_MS,
  HUMAN_CONTACT_PROTOCOL_VERSION,
  type HumanContactSessionContract,
  type HumanContactState
} from '@ros/contracts';

export const CONTACT_RUNTIME_POLICY_VERSION = 'ros-eye.contact-runtime.v2' as const;
export type ContactChannel = 'IN_APP' | 'PUSH' | 'SMS_SIM' | 'TELEPHONY_SIM';
export type RuntimeDisposition = 'APPLIED' | 'IDEMPOTENT' | 'HUMAN_REVIEW' | 'ESCALATED' | 'CONFLICT';

export interface ContactSessionRecord extends HumanContactSessionContract {
  readonly tenantId: string;
  readonly automationSuppressed: boolean;
  readonly nextActionAt: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly updatedAt: string;
}

export interface ContactAuditEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly caseId: string;
  readonly eventType: string;
  readonly state: HumanContactState;
  readonly version: number;
  readonly actorType: 'SYSTEM' | 'OPERATOR';
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly runtimePolicyVersion: typeof CONTACT_RUNTIME_POLICY_VERSION;
}

export interface ContactOutboxMessage {
  readonly messageId: string;
  readonly sessionId: string;
  readonly channel: ContactChannel;
  readonly promptId: string;
  readonly idempotencyKey: string;
  readonly availableAt: string;
  readonly attempt: number;
}

export interface ContactRuntimeTransaction {
  getSessionForUpdate(sessionId: string): Promise<ContactSessionRecord | null>;
  insertSession(session: ContactSessionRecord): Promise<void>;
  updateSession(session: ContactSessionRecord, expectedVersion: number): Promise<'UPDATED' | 'CONFLICT'>;
  insertInboxIfAbsent(idempotencyKey: string): Promise<'INSERTED' | 'EXISTS'>;
  insertAuditIfAbsent(event: ContactAuditEvent): Promise<'INSERTED' | 'EXISTS'>;
  insertOutboxIfAbsent(message: ContactOutboxMessage): Promise<'INSERTED' | 'EXISTS'>;
  cancelPendingAutomation(sessionId: string, occurredAt: string): Promise<void>;
}

export interface ContactRuntimeRepositoryPort {
  transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T>;
  claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactSessionRecord[]>;
  releaseLease(sessionId: string, workerId: string): Promise<void>;
}

export interface ContactChannelPort {
  send(input: { sessionId: string; channel: ContactChannel; promptId: string; idempotencyKey: string }): Promise<'SENT' | 'UNAVAILABLE'>;
}

export interface RuntimeIdFactoryPort { create(namespace: string, material: string): Promise<string> }

export interface OpenContactInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly caseId: string;
  readonly language: 'ar' | 'en' | 'UNKNOWN';
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly preferredChannel: ContactChannel;
}

export interface CallbackInput {
  readonly callbackId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly kind: 'RESPONSE' | 'CONTRADICTORY' | 'DISCONNECTED' | 'CHANNEL_FAILURE';
}

export class ContactOrchestrationService {
  constructor(
    private readonly repository: ContactRuntimeRepositoryPort,
    private readonly channel: ContactChannelPort,
    private readonly ids: RuntimeIdFactoryPort
  ) {}

  async open(input: OpenContactInput): Promise<RuntimeDisposition> {
    if (!validId(input.tenantId) || !validId(input.sessionId) || !validId(input.caseId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return 'HUMAN_REVIEW';
    const inboxKey = `open|${input.tenantId}|${input.sessionId}|${input.idempotencyKey}`;
    return this.repository.transaction(async (tx) => {
      if ((await tx.insertInboxIfAbsent(inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      const existing = await tx.getSessionForUpdate(input.sessionId);
      if (existing !== null) return 'CONFLICT';
      const deadline = new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString();
      const session: ContactSessionRecord = {
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        caseId: input.caseId,
        state: 'AWAITING_RESPONSE',
        version: 1,
        protocolVersion: HUMAN_CONTACT_PROTOCOL_VERSION,
        promptPolicyVersion: 'ros-eye.contact-prompts.v1',
        accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
        language: input.language,
        identityConfidence: 'UNVERIFIED',
        activeChannel: input.preferredChannel === 'IN_APP' ? 'IN_APP_CHAT' : 'PUSH',
        attemptCount: 1,
        responseDeadlineAt: deadline,
        lastInteractionAt: input.occurredAt,
        assignedOperatorId: null,
        accessibility: { screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true },
        automationSuppressed: false,
        nextActionAt: deadline,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.occurredAt
      };
      await tx.insertSession(session);
      await tx.insertOutboxIfAbsent(await this.outbox(session, input.preferredChannel, 'contact.response', input.occurredAt));
      await tx.insertAuditIfAbsent(await this.audit(session, 'CONTACT_OPENED', 'contact_opened', input.traceId, input.occurredAt, 'SYSTEM'));
      return 'APPLIED';
    });
  }

  async handleCallback(input: CallbackInput): Promise<RuntimeDisposition> {
    if (!validId(input.callbackId) || !validId(input.sessionId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return 'HUMAN_REVIEW';
    const inboxKey = `callback|${input.sessionId}|${input.callbackId}`;
    return this.repository.transaction(async (tx) => {
      if ((await tx.insertInboxIfAbsent(inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      const current = await tx.getSessionForUpdate(input.sessionId);
      if (current === null) return 'HUMAN_REVIEW';
      if (current.automationSuppressed || current.state === 'OPERATOR_TAKEOVER' || current.state === 'ESCALATED' || current.state === 'COMPLETED') return 'IDEMPOTENT';

      const transition = callbackTransition(current.state, input.kind);
      if (transition === null) {
        const review: ContactSessionRecord = {
          ...current,
          state: 'HUMAN_REVIEW',
          version: current.version + 1,
          nextActionAt: null,
          responseDeadlineAt: null,
          updatedAt: input.occurredAt
        };
        if ((await tx.updateSession(review, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(review, 'CALLBACK_REJECTED', 'invalid_callback_transition', input.traceId, input.occurredAt, 'SYSTEM'));
        return 'HUMAN_REVIEW';
      }

      const next: ContactSessionRecord = {
        ...current,
        state: transition,
        version: current.version + 1,
        lastInteractionAt: input.occurredAt,
        nextActionAt: transition === 'DISCONNECTED'
          ? new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString()
          : null,
        responseDeadlineAt: null,
        updatedAt: input.occurredAt
      };
      if ((await tx.updateSession(next, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertAuditIfAbsent(await this.audit(next, `CALLBACK_${input.kind}`, input.kind.toLowerCase(), input.traceId, input.occurredAt, 'SYSTEM'));
      return transition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'APPLIED';
    });
  }

  async operatorTakeover(input: { sessionId: string; operatorId: string; traceId: string; occurredAt: string; idempotencyKey: string }): Promise<RuntimeDisposition> {
    if (!validId(input.sessionId) || !validId(input.operatorId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return 'HUMAN_REVIEW';
    const inboxKey = `takeover|${input.sessionId}|${input.operatorId}|${input.idempotencyKey}`;
    return this.repository.transaction(async (tx) => {
      if ((await tx.insertInboxIfAbsent(inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      const current = await tx.getSessionForUpdate(input.sessionId);
      if (current === null) return 'HUMAN_REVIEW';
      if (current.automationSuppressed && current.assignedOperatorId === input.operatorId) return 'IDEMPOTENT';
      const next: ContactSessionRecord = { ...current, state: 'OPERATOR_TAKEOVER', assignedOperatorId: input.operatorId, automationSuppressed: true, nextActionAt: null, responseDeadlineAt: null, leaseOwner: null, leaseExpiresAt: null, version: current.version + 1, updatedAt: input.occurredAt };
      await tx.cancelPendingAutomation(current.sessionId, input.occurredAt);
      if ((await tx.updateSession(next, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertAuditIfAbsent(await this.audit(next, 'OPERATOR_TAKEOVER', 'operator_takeover', input.traceId, input.occurredAt, 'OPERATOR'));
      return 'APPLIED';
    });
  }

  async runDue(workerId: string, now: string, limit = 50): Promise<ReadonlyArray<{ sessionId: string; disposition: RuntimeDisposition }>> {
    if (!validId(workerId) || !validTime(now) || !Number.isInteger(limit) || limit < 1 || limit > 500) return [];
    const claimed = await this.repository.claimDueSessions({ workerId, now, leaseMs: 30_000, limit });
    const results: Array<{ sessionId: string; disposition: RuntimeDisposition }> = [];
    for (const session of claimed) {
      try {
        const disposition = await this.processDue(session, workerId, now);
        results.push({ sessionId: session.sessionId, disposition });
      } finally {
        await this.repository.releaseLease(session.sessionId, workerId);
      }
    }
    return results;
  }

  private async processDue(claimed: ContactSessionRecord, workerId: string, now: string): Promise<RuntimeDisposition> {
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(claimed.sessionId);
      if (current === null || current.leaseOwner !== workerId || current.automationSuppressed) return 'IDEMPOTENT';
      if (current.nextActionAt === null || Date.parse(current.nextActionAt) > Date.parse(now)) return 'IDEMPOTENT';

      if (current.state === 'AWAITING_RESPONSE') {
        const noResponse: ContactSessionRecord = {
          ...current,
          state: 'NO_RESPONSE',
          responseDeadlineAt: null,
          nextActionAt: new Date(Date.parse(now) + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString(),
          version: current.version + 1,
          updatedAt: now
        };
        if ((await tx.updateSession(noResponse, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(noResponse, 'CONTACT_NO_RESPONSE', 'response_deadline_elapsed', `worker-${workerId}`, now, 'SYSTEM'));
        return 'APPLIED';
      }

      if (current.state !== 'NO_RESPONSE' && current.state !== 'DISCONNECTED') {
        const review: ContactSessionRecord = { ...current, state: 'HUMAN_REVIEW', nextActionAt: null, responseDeadlineAt: null, version: current.version + 1, updatedAt: now };
        if ((await tx.updateSession(review, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(review, 'CONTACT_TIMER_REJECTED', 'unexpected_due_state', `worker-${workerId}`, now, 'SYSTEM'));
        return 'HUMAN_REVIEW';
      }

      if (current.attemptCount >= HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS) {
        const escalated: ContactSessionRecord = { ...current, state: 'ESCALATED', nextActionAt: null, responseDeadlineAt: null, version: current.version + 1, updatedAt: now };
        if ((await tx.updateSession(escalated, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(escalated, 'CONTACT_ESCALATED', 'retry_limit_exhausted', `worker-${workerId}`, now, 'SYSTEM'));
        return 'ESCALATED';
      }

      const attempt = current.attemptCount + 1;
      const nextDeadline = new Date(Date.parse(now) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString();
      const retried: ContactSessionRecord = { ...current, state: 'AWAITING_RESPONSE', attemptCount: attempt, responseDeadlineAt: nextDeadline, nextActionAt: nextDeadline, version: current.version + 1, updatedAt: now };
      if ((await tx.updateSession(retried, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertOutboxIfAbsent(await this.outbox(retried, fallbackChannel(retried.activeChannel, attempt), 'contact.response', now));
      await tx.insertAuditIfAbsent(await this.audit(retried, 'CONTACT_RETRY_SCHEDULED', current.state === 'DISCONNECTED' ? 'channel_disconnected' : 'no_response_retry_due', `worker-${workerId}`, now, 'SYSTEM'));
      return 'APPLIED';
    });
  }

  private async outbox(session: ContactSessionRecord, channel: ContactChannel, promptId: string, availableAt: string): Promise<ContactOutboxMessage> {
    const key = `${session.sessionId}|${session.version}|${channel}|${promptId}`;
    return { messageId: await this.ids.create('contact-outbox', key), sessionId: session.sessionId, channel, promptId, idempotencyKey: key, availableAt, attempt: session.attemptCount };
  }

  private async audit(session: ContactSessionRecord, eventType: string, reasonCode: string, traceId: string, occurredAt: string, actorType: 'SYSTEM' | 'OPERATOR'): Promise<ContactAuditEvent> {
    return { eventId: await this.ids.create('contact-audit', `${session.sessionId}|${session.version}|${eventType}`), sessionId: session.sessionId, caseId: session.caseId, eventType, state: session.state, version: session.version, actorType, reasonCode, occurredAt, traceId, runtimePolicyVersion: CONTACT_RUNTIME_POLICY_VERSION };
  }
}

export async function deliverOutbox(message: ContactOutboxMessage, channel: ContactChannelPort): Promise<'DELIVERED' | 'RETRY'> {
  return (await channel.send({ sessionId: message.sessionId, channel: message.channel, promptId: message.promptId, idempotencyKey: message.idempotencyKey })) === 'SENT' ? 'DELIVERED' : 'RETRY';
}

function callbackTransition(current: HumanContactState, kind: CallbackInput['kind']): HumanContactState | null {
  if (kind === 'CONTRADICTORY' || kind === 'CHANNEL_FAILURE') return 'HUMAN_REVIEW';
  if (kind === 'DISCONNECTED') return current === 'AWAITING_RESPONSE' || current === 'PARTIAL_RESPONSE' ? 'DISCONNECTED' : null;
  if (kind === 'RESPONSE') return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE', 'DISCONNECTED', 'NO_RESPONSE'].includes(current) ? 'RESPONSE_CONFIRMED' : null;
  return null;
}

function fallbackChannel(active: HumanContactSessionContract['activeChannel'], attempt: number): ContactChannel {
  if (attempt <= 1) return active === 'IN_APP_CHAT' || active === 'IN_APP_VOICE' ? 'IN_APP' : 'PUSH';
  if (attempt === 2) return 'PUSH';
  return 'SMS_SIM';
}
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function validTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }
