import {
  HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS,
  HUMAN_CONTACT_PROTOCOL_VERSION,
  HUMAN_CONTACT_RESPONSE_DEADLINE_MS,
  HUMAN_CONTACT_RETRY_BASE_DELAY_MS,
  type HumanContactSessionContract,
  type HumanContactState
} from '@ros/contracts';

export const CONTACT_RUNTIME_POLICY_VERSION = 'ros-eye.contact-runtime.v4' as const;
export const CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION = 'ros-eye.contact-operator-authority.v1' as const;
export type ContactChannel = 'IN_APP' | 'PUSH' | 'SMS_SIM' | 'TELEPHONY_SIM';
export type ContactAuthorizedRole = 'SYSTEM' | 'OPERATOR' | 'SUPERVISOR' | 'SAFETY_LEAD';
export type RuntimeDisposition = 'APPLIED' | 'IDEMPOTENT' | 'HUMAN_REVIEW' | 'ESCALATED' | 'CONFLICT';
export type OutboxDeliveryDisposition = 'DELIVERED' | 'RETRY' | 'CANCELLED' | 'CONFLICT';

export interface ContactScope {
  readonly tenantId: string;
  readonly caseId: string;
  readonly sessionId: string;
}

export interface ContactSessionRecord extends HumanContactSessionContract {
  readonly tenantId: string;
  readonly automationSuppressed: boolean;
  readonly nextActionAt: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly updatedAt: string;
}

export interface ContactAuditEvent extends ContactScope {
  readonly eventId: string;
  readonly eventType: string;
  readonly state: HumanContactState;
  readonly version: number;
  readonly actorType: 'SYSTEM' | 'OPERATOR';
  readonly actorId: string;
  readonly authorizedByRole: ContactAuthorizedRole;
  readonly authorityPolicyVersion: typeof CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION;
  readonly reasonCode: string;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly runtimePolicyVersion: typeof CONTACT_RUNTIME_POLICY_VERSION;
}

export interface ContactOutboxMessage extends ContactScope {
  readonly messageId: string;
  readonly channel: ContactChannel;
  readonly promptId: string;
  readonly idempotencyKey: string;
  readonly availableAt: string;
  readonly attempt: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface ContactRuntimeTransaction {
  getSessionForUpdate(scope: ContactScope): Promise<ContactSessionRecord | null>;
  insertSession(session: ContactSessionRecord): Promise<void>;
  updateSession(session: ContactSessionRecord, expectedVersion: number): Promise<'UPDATED' | 'CONFLICT'>;
  insertInboxIfAbsent(scope: ContactScope, idempotencyKey: string): Promise<'INSERTED' | 'EXISTS'>;
  insertAuditIfAbsent(event: ContactAuditEvent): Promise<'INSERTED' | 'EXISTS'>;
  insertOutboxIfAbsent(message: ContactOutboxMessage): Promise<'INSERTED' | 'EXISTS'>;
  cancelPendingAutomation(scope: ContactScope, occurredAt: string): Promise<void>;
}

export interface ProcessClaimedOutboxInput extends ContactScope {
  readonly messageId: string;
  readonly workerId: string;
  readonly now: string;
  readonly retryAvailableAt: string;
  readonly errorCode: string;
}

export interface ContactRuntimeRepositoryPort {
  transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T>;
  claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactSessionRecord[]>;
  releaseLease(scope: ContactScope, workerId: string): Promise<void>;
  claimDueOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactOutboxMessage[]>;
  processClaimedOutbox(
    input: ProcessClaimedOutboxInput,
    deliver: (message: ContactOutboxMessage) => Promise<'SENT' | 'UNAVAILABLE'>
  ): Promise<OutboxDeliveryDisposition>;
  releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }): Promise<void>;
}

export interface ContactChannelPort {
  /**
   * Production adapters MUST enforce the supplied stable idempotency key. A
   * transport call may be repeated after a crash before database acknowledgement,
   * but it must not create a second logical contact delivery.
   */
  send(input: ContactScope & { channel: ContactChannel; promptId: string; idempotencyKey: string }): Promise<'SENT' | 'UNAVAILABLE'>;
}

export interface RuntimeIdFactoryPort { create(namespace: string, material: string): Promise<string> }

export interface OpenContactInput extends ContactScope {
  readonly language: 'ar' | 'en' | 'UNKNOWN';
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly preferredChannel: ContactChannel;
}

export interface CallbackInput extends ContactScope {
  readonly authenticatedTenantId: string;
  readonly authenticatedCaseId: string;
  readonly callbackId: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly kind: 'RESPONSE' | 'CONTRADICTORY' | 'DISCONNECTED' | 'CHANNEL_FAILURE';
}

export interface OperatorTakeoverInput extends ContactScope {
  readonly operatorId: string;
  readonly authenticatedTenantId: string;
  readonly authenticatedCaseId: string;
  readonly authorizedRole: Exclude<ContactAuthorizedRole, 'SYSTEM'>;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly authorityPolicyVersion: typeof CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION;
}

export class ContactOrchestrationService {
  constructor(
    private readonly repository: ContactRuntimeRepositoryPort,
    private readonly channel: ContactChannelPort,
    private readonly ids: RuntimeIdFactoryPort
  ) {}

  async open(input: OpenContactInput): Promise<RuntimeDisposition> {
    if (!validScope(input) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return 'HUMAN_REVIEW';
    const inboxKey = `open|${input.tenantId}|${input.caseId}|${input.sessionId}|${input.idempotencyKey}`;
    return this.repository.transaction(async (tx) => {
      if ((await tx.insertInboxIfAbsent(input, inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      if ((await tx.getSessionForUpdate(input)) !== null) return 'CONFLICT';
      const deadline = new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString();
      const session: ContactSessionRecord = {
        tenantId: input.tenantId, sessionId: input.sessionId, caseId: input.caseId,
        state: 'AWAITING_RESPONSE', version: 1, protocolVersion: HUMAN_CONTACT_PROTOCOL_VERSION,
        promptPolicyVersion: 'ros-eye.contact-prompts.v1', accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
        language: input.language, identityConfidence: 'UNVERIFIED',
        activeChannel: input.preferredChannel === 'IN_APP' ? 'IN_APP_CHAT' : 'PUSH', attemptCount: 1,
        responseDeadlineAt: deadline, lastInteractionAt: input.occurredAt, assignedOperatorId: null,
        accessibility: { screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true },
        automationSuppressed: false, nextActionAt: deadline, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.occurredAt
      };
      await tx.insertSession(session);
      await tx.insertOutboxIfAbsent(await this.outbox(session, input.preferredChannel, 'contact.response', input.occurredAt));
      await tx.insertAuditIfAbsent(await this.audit(session, 'CONTACT_OPENED', 'contact_opened', input.traceId, input.occurredAt, 'SYSTEM', 'runtime', 'SYSTEM'));
      return 'APPLIED';
    });
  }

  async handleCallback(input: CallbackInput): Promise<RuntimeDisposition> {
    if (!validScope(input) || input.authenticatedTenantId !== input.tenantId || input.authenticatedCaseId !== input.caseId || !validId(input.callbackId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return 'HUMAN_REVIEW';
    const inboxKey = `callback|${input.tenantId}|${input.caseId}|${input.sessionId}|${input.callbackId}`;
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(input);
      if (current === null) return 'HUMAN_REVIEW';
      if ((await tx.insertInboxIfAbsent(input, inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      if (current.automationSuppressed || ['OPERATOR_TAKEOVER', 'ESCALATED', 'COMPLETED'].includes(current.state)) return 'IDEMPOTENT';
      const transition = callbackTransition(current.state, input.kind);
      if (transition === null) return this.failToReview(tx, current, input.traceId, input.occurredAt, 'invalid_callback_transition');
      const next: ContactSessionRecord = {
        ...current, state: transition, version: current.version + 1, lastInteractionAt: input.occurredAt,
        nextActionAt: transition === 'DISCONNECTED' ? new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString() : null,
        responseDeadlineAt: null, updatedAt: input.occurredAt
      };
      if ((await tx.updateSession(next, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertAuditIfAbsent(await this.audit(next, `CALLBACK_${input.kind}`, input.kind.toLowerCase(), input.traceId, input.occurredAt, 'SYSTEM', 'callback', 'SYSTEM'));
      return transition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'APPLIED';
    });
  }

  async operatorTakeover(input: OperatorTakeoverInput): Promise<RuntimeDisposition> {
    if (!validScope(input) || input.authenticatedTenantId !== input.tenantId || input.authenticatedCaseId !== input.caseId || !humanOperatorRole(input.authorizedRole) || !validId(input.operatorId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt) || input.authorityPolicyVersion !== CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION) return 'HUMAN_REVIEW';
    const inboxKey = `takeover|${input.tenantId}|${input.caseId}|${input.sessionId}|${input.operatorId}|${input.idempotencyKey}`;
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(input);
      if (current === null) return 'HUMAN_REVIEW';
      if ((await tx.insertInboxIfAbsent(input, inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      if (current.automationSuppressed && current.assignedOperatorId === input.operatorId) return 'IDEMPOTENT';
      const next: ContactSessionRecord = { ...current, state: 'OPERATOR_TAKEOVER', assignedOperatorId: input.operatorId, automationSuppressed: true, nextActionAt: null, responseDeadlineAt: null, leaseOwner: null, leaseExpiresAt: null, version: current.version + 1, updatedAt: input.occurredAt };
      await tx.cancelPendingAutomation(input, input.occurredAt);
      if ((await tx.updateSession(next, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertAuditIfAbsent(await this.audit(next, 'OPERATOR_TAKEOVER', 'operator_takeover', input.traceId, input.occurredAt, 'OPERATOR', input.operatorId, input.authorizedRole));
      return 'APPLIED';
    });
  }

  async runDue(workerId: string, now: string, limit = 50): Promise<ReadonlyArray<ContactScope & { disposition: RuntimeDisposition }>> {
    if (!validId(workerId) || !validTime(now) || !Number.isInteger(limit) || limit < 1 || limit > 500) return [];
    const claimed = await this.repository.claimDueSessions({ workerId, now, leaseMs: 30_000, limit });
    const results: Array<ContactScope & { disposition: RuntimeDisposition }> = [];
    for (const session of claimed) {
      const scope = scopeOf(session);
      try { results.push({ ...scope, disposition: await this.processDue(session, workerId, now) }); }
      finally { await this.repository.releaseLease(scope, workerId); }
    }
    return results;
  }

  async runOutbox(workerId: string, now: string, limit = 50): Promise<ReadonlyArray<ContactScope & { messageId: string; disposition: OutboxDeliveryDisposition }>> {
    if (!validId(workerId) || !validTime(now) || !Number.isInteger(limit) || limit < 1 || limit > 500) return [];
    const claimed = await this.repository.claimDueOutbox({ workerId, now, leaseMs: 30_000, limit });
    const results: Array<ContactScope & { messageId: string; disposition: OutboxDeliveryDisposition }> = [];
    for (const message of claimed) {
      const scope = scopeOf(message);
      const retryAvailableAt = new Date(Date.parse(now) + boundedOutboxBackoff(message.attempt)).toISOString();
      let disposition: OutboxDeliveryDisposition = 'CONFLICT';
      try {
        disposition = await this.repository.processClaimedOutbox(
          { ...scope, messageId: message.messageId, workerId, now, retryAvailableAt, errorCode: 'channel_unavailable' },
          async (fresh) => {
            try {
              return await this.channel.send({ ...scopeOf(fresh), channel: fresh.channel, promptId: fresh.promptId, idempotencyKey: fresh.idempotencyKey });
            } catch {
              return 'UNAVAILABLE';
            }
          }
        );
      } finally {
        await this.repository.releaseOutboxLease({ ...scope, messageId: message.messageId, workerId });
      }
      results.push({ ...scope, messageId: message.messageId, disposition });
    }
    return results;
  }

  private async processDue(claimed: ContactSessionRecord, workerId: string, now: string): Promise<RuntimeDisposition> {
    const scope = scopeOf(claimed);
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(scope);
      if (current === null || current.leaseOwner !== workerId || current.automationSuppressed) return 'IDEMPOTENT';
      if (current.nextActionAt === null || Date.parse(current.nextActionAt) > Date.parse(now)) return 'IDEMPOTENT';
      if (current.state === 'AWAITING_RESPONSE') {
        const noResponse: ContactSessionRecord = { ...current, state: 'NO_RESPONSE', responseDeadlineAt: null, nextActionAt: new Date(Date.parse(now) + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString(), version: current.version + 1, updatedAt: now };
        if ((await tx.updateSession(noResponse, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(noResponse, 'CONTACT_NO_RESPONSE', 'response_deadline_elapsed', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'APPLIED';
      }
      if (current.state !== 'NO_RESPONSE' && current.state !== 'DISCONNECTED') return this.failToReview(tx, current, `worker-${workerId}`, now, 'unexpected_due_state');
      if (current.attemptCount >= HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS) {
        const escalated: ContactSessionRecord = { ...current, state: 'ESCALATED', nextActionAt: null, responseDeadlineAt: null, version: current.version + 1, updatedAt: now };
        if ((await tx.updateSession(escalated, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(escalated, 'CONTACT_ESCALATED', 'retry_limit_exhausted', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'ESCALATED';
      }
      const attempt = current.attemptCount + 1;
      const nextDeadline = new Date(Date.parse(now) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString();
      const retried: ContactSessionRecord = { ...current, state: 'AWAITING_RESPONSE', attemptCount: attempt, responseDeadlineAt: nextDeadline, nextActionAt: nextDeadline, version: current.version + 1, updatedAt: now };
      if ((await tx.updateSession(retried, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertOutboxIfAbsent(await this.outbox(retried, fallbackChannel(retried.activeChannel, attempt), 'contact.response', now));
      await tx.insertAuditIfAbsent(await this.audit(retried, 'CONTACT_RETRY_SCHEDULED', current.state === 'DISCONNECTED' ? 'channel_disconnected' : 'no_response_retry_due', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
      return 'APPLIED';
    });
  }

  private async failToReview(tx: ContactRuntimeTransaction, current: ContactSessionRecord, traceId: string, occurredAt: string, reasonCode: string): Promise<RuntimeDisposition> {
    const review: ContactSessionRecord = { ...current, state: 'HUMAN_REVIEW', nextActionAt: null, responseDeadlineAt: null, version: current.version + 1, updatedAt: occurredAt };
    if ((await tx.updateSession(review, current.version)) === 'CONFLICT') return 'CONFLICT';
    await tx.insertAuditIfAbsent(await this.audit(review, 'CONTACT_RUNTIME_REJECTED', reasonCode, traceId, occurredAt, 'SYSTEM', 'runtime', 'SYSTEM'));
    return 'HUMAN_REVIEW';
  }

  private async outbox(session: ContactSessionRecord, channel: ContactChannel, promptId: string, availableAt: string): Promise<ContactOutboxMessage> {
    const key = `${CONTACT_RUNTIME_POLICY_VERSION}|${session.tenantId}|${session.caseId}|${session.sessionId}|${session.version}|${channel}|${promptId}`;
    return { ...scopeOf(session), messageId: await this.ids.create('contact-outbox', key), channel, promptId, idempotencyKey: key, availableAt, attempt: session.attemptCount, leaseOwner: null, leaseExpiresAt: null, deliveredAt: null, cancelledAt: null, lastErrorCode: null };
  }

  private async audit(session: ContactSessionRecord, eventType: string, reasonCode: string, traceId: string, occurredAt: string, actorType: 'SYSTEM' | 'OPERATOR', actorId: string, authorizedByRole: ContactAuthorizedRole): Promise<ContactAuditEvent> {
    return { ...scopeOf(session), eventId: await this.ids.create('contact-audit', `${session.tenantId}|${session.caseId}|${session.sessionId}|${session.version}|${eventType}`), eventType, state: session.state, version: session.version, actorType, actorId, authorizedByRole, authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION, reasonCode, occurredAt, traceId, runtimePolicyVersion: CONTACT_RUNTIME_POLICY_VERSION };
  }
}

function callbackTransition(current: HumanContactState, kind: CallbackInput['kind']): HumanContactState | null {
  if (kind === 'CONTRADICTORY' || kind === 'CHANNEL_FAILURE') return 'HUMAN_REVIEW';
  if (kind === 'DISCONNECTED') return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE'].includes(current) ? 'DISCONNECTED' : null;
  if (kind === 'RESPONSE') return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE', 'DISCONNECTED', 'NO_RESPONSE'].includes(current) ? 'RESPONSE_CONFIRMED' : null;
  return null;
}
function fallbackChannel(active: HumanContactSessionContract['activeChannel'], attempt: number): ContactChannel { if (attempt <= 1) return active === 'IN_APP_CHAT' || active === 'IN_APP_VOICE' ? 'IN_APP' : 'PUSH'; if (attempt === 2) return 'PUSH'; return 'SMS_SIM'; }
function boundedOutboxBackoff(attempt: number): number { return Math.min(60_000, HUMAN_CONTACT_RETRY_BASE_DELAY_MS * Math.max(1, attempt)); }
function humanOperatorRole(role: ContactAuthorizedRole): role is Exclude<ContactAuthorizedRole, 'SYSTEM'> { return role === 'OPERATOR' || role === 'SUPERVISOR' || role === 'SAFETY_LEAD'; }
function scopeOf(value: ContactScope): ContactScope { return { tenantId: value.tenantId, caseId: value.caseId, sessionId: value.sessionId }; }
function validScope(value: ContactScope): boolean { return validId(value.tenantId) && validId(value.caseId) && validId(value.sessionId); }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function validTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }
