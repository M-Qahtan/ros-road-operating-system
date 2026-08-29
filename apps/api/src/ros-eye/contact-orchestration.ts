import {
  HUMAN_CONTACT_ACCESSIBILITY_POLICY_VERSION,
  HUMAN_CONTACT_AUTHORITY_POLICY_VERSION,
  HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS,
  HUMAN_CONTACT_PROMPT_POLICY_VERSION,
  HUMAN_CONTACT_PROTOCOL_VERSION,
  HUMAN_CONTACT_RESPONSE_DEADLINE_MS,
  HUMAN_CONTACT_RETRY_BASE_DELAY_MS,
  decideHumanContactTransition,
  type HumanContactIdentityConfidence,
  type HumanContactLanguage,
  type HumanContactSessionContract,
  type HumanContactState
} from '@ros/contracts';

export const CONTACT_RUNTIME_POLICY_VERSION = 'ros-eye.contact-runtime.v6' as const;
export const CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION = HUMAN_CONTACT_AUTHORITY_POLICY_VERSION;
export const CONTACT_OUTBOX_LEASE_MS = 30_000;
export const CONTACT_DELIVERY_TIMEOUT_MS = 5_000;
export type ContactChannel = 'IN_APP' | 'PUSH' | 'SMS_SIM' | 'TELEPHONY_SIM';
export type ContactAuthorizedRole = 'SYSTEM' | 'OPERATOR' | 'SUPERVISOR' | 'SAFETY_LEAD';
export type RuntimeDisposition = 'APPLIED' | 'IDEMPOTENT' | 'HUMAN_REVIEW' | 'ESCALATED' | 'CONFLICT';
export type OutboxDeliveryDisposition = 'DELIVERED' | 'RETRY' | 'CANCELLED' | 'CONFLICT';
export type ContactPromptId = 'contact.consent' | 'contact.language' | 'contact.response' | 'contact.accessibility' | 'contact.handoff';

export interface ContactScope {
  readonly tenantId: string;
  readonly caseId: string;
  readonly sessionId: string;
}

export interface ContactSessionRecord extends HumanContactSessionContract {
  readonly tenantId: string;
  readonly ownerActorId: string | null;
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
  readonly promptId: ContactPromptId;
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
  readonly deliveryToken: string;
  readonly deliveryDeadlineAt: string;
}

export interface ContactRuntimeRepositoryPort {
  transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T>;
  claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactSessionRecord[]>;
  releaseLease(scope: ContactScope, workerId: string): Promise<void>;
  claimDueOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactOutboxMessage[]>;
  /**
   * Implementations MUST commit a short delivery reservation before invoking
   * `deliver`, invoke it without an open database transaction/row lock, then
   * finalize only when the same delivery token remains live and uncancelled.
   */
  processClaimedOutbox(
    input: ProcessClaimedOutboxInput,
    deliver: (message: ContactOutboxMessage) => Promise<'SENT' | 'UNAVAILABLE'>
  ): Promise<OutboxDeliveryDisposition>;
  releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }): Promise<void>;
}

export interface ContactChannelPort {
  /**
   * Production adapters MUST enforce the stable idempotency key and honor both
   * the deadline and AbortSignal. A transport call may be repeated after a
   * crash, but it must not create a second logical contact delivery.
   */
  send(input: ContactScope & {
    channel: ContactChannel;
    promptId: ContactPromptId;
    idempotencyKey: string;
    deadlineAt: string;
    signal: AbortSignal;
  }): Promise<'SENT' | 'UNAVAILABLE'>;
}

export interface RuntimeIdFactoryPort { create(namespace: string, material: string): Promise<string> }

export interface ContactRuntimeOptions {
  readonly outboxLeaseMs: number;
  readonly deliveryTimeoutMs: number;
}

const DEFAULT_RUNTIME_OPTIONS: ContactRuntimeOptions = Object.freeze({
  outboxLeaseMs: CONTACT_OUTBOX_LEASE_MS,
  deliveryTimeoutMs: CONTACT_DELIVERY_TIMEOUT_MS
});

export interface OpenContactInput extends ContactScope {
  /** Trusted reporter subject copied from the parent RoadEvent; null for operational/legacy cases. */
  readonly ownerActorId: string | null;
  /** Device/operator locale hint only; explicit language selection is still required. */
  readonly language: HumanContactLanguage;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly preferredChannel: ContactChannel;
}

export type ContactCallbackKind =
  | 'CONSENT_GRANTED'
  | 'CONSENT_DECLINED'
  | 'LANGUAGE_SELECTED'
  | 'PARTIAL_RESPONSE'
  | 'RESPONSE'
  | 'CONTRADICTORY'
  | 'DISCONNECTED'
  | 'CHANNEL_FAILURE'
  | 'ACCESSIBILITY_UNAVAILABLE';

export interface CallbackInput extends ContactScope {
  /** Must equal the immutable session owner before callback replay lookup. */
  readonly ownerActorId: string | null;
  readonly authenticatedTenantId: string;
  readonly authenticatedCaseId: string;
  readonly callbackId: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly kind: ContactCallbackKind;
  readonly selectedLanguage?: Exclude<HumanContactLanguage, 'UNKNOWN'>;
  /** Automated callbacks may establish only partial confidence, never confirmation. */
  readonly identityConfidence?: Extract<HumanContactIdentityConfidence, 'UNVERIFIED' | 'PARTIAL'>;
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
  private readonly options: ContactRuntimeOptions;

  constructor(
    private readonly repository: ContactRuntimeRepositoryPort,
    private readonly channel: ContactChannelPort,
    private readonly ids: RuntimeIdFactoryPort,
    options: ContactRuntimeOptions = DEFAULT_RUNTIME_OPTIONS
  ) {
    if (!Number.isInteger(options.outboxLeaseMs) || options.outboxLeaseMs < 100) throw new Error('outboxLeaseMs must be an integer >= 100');
    if (!Number.isInteger(options.deliveryTimeoutMs) || options.deliveryTimeoutMs < 1) throw new Error('deliveryTimeoutMs must be a positive integer');
    if (options.deliveryTimeoutMs >= options.outboxLeaseMs) throw new Error('deliveryTimeoutMs must be shorter than outboxLeaseMs');
    this.options = Object.freeze({ ...options });
  }

  async open(input: OpenContactInput): Promise<RuntimeDisposition> {
    if (!validScope(input) || !validNullableOwnerActorId(input.ownerActorId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt) || !validLanguage(input.language)) return 'HUMAN_REVIEW';
    const inboxKey = `open|${input.tenantId}|${input.caseId}|${input.sessionId}|${input.idempotencyKey}`;
    return this.repository.transaction(async (tx) => {
      if ((await tx.insertInboxIfAbsent(input, inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      if ((await tx.getSessionForUpdate(input)) !== null) return 'CONFLICT';
      const deadline = new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString();
      const session: ContactSessionRecord = {
        tenantId: input.tenantId,
        ownerActorId: input.ownerActorId,
        sessionId: input.sessionId,
        caseId: input.caseId,
        state: 'CONSENT_PENDING',
        version: 1,
        protocolVersion: HUMAN_CONTACT_PROTOCOL_VERSION,
        promptPolicyVersion: HUMAN_CONTACT_PROMPT_POLICY_VERSION,
        accessibilityPolicyVersion: HUMAN_CONTACT_ACCESSIBILITY_POLICY_VERSION,
        language: input.language,
        identityConfidence: 'UNVERIFIED',
        activeChannel: toSafetyChannel(input.preferredChannel),
        attemptCount: 1,
        responseDeadlineAt: deadline,
        lastInteractionAt: input.occurredAt,
        assignedOperatorId: null,
        accessibility: {
          screenReaderRequired: true,
          handsFreeRequired: true,
          largeControlsRequired: true,
          simpleLanguageRequired: true,
          visualAlternativeRequired: true,
          audioAlternativeRequired: true
        },
        automationSuppressed: false,
        nextActionAt: deadline,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.occurredAt
      };
      await tx.insertSession(session);
      await tx.insertOutboxIfAbsent(await this.outbox(session, input.preferredChannel, 'contact.consent', input.occurredAt));
      await tx.insertAuditIfAbsent(await this.audit(session, 'CONTACT_CONSENT_PENDING', 'protocol_started_with_consent', input.traceId, input.occurredAt, 'SYSTEM', 'runtime', 'SYSTEM'));
      return 'APPLIED';
    });
  }

  async handleCallback(input: CallbackInput): Promise<RuntimeDisposition> {
    if (!validCallback(input)) return 'HUMAN_REVIEW';
    const inboxKey = `callback|${input.tenantId}|${input.caseId}|${input.sessionId}|${input.callbackId}`;
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(input);
      if (current === null) return 'HUMAN_REVIEW';
      if (current.ownerActorId !== input.ownerActorId) return 'HUMAN_REVIEW';
      if ((await tx.insertInboxIfAbsent(input, inboxKey)) === 'EXISTS') return 'IDEMPOTENT';
      if (current.automationSuppressed || ['OPERATOR_TAKEOVER', 'ESCALATED', 'COMPLETED'].includes(current.state)) return 'IDEMPOTENT';

      const requestedState = callbackRequestedState(current.state, input.kind);
      if (requestedState === null) return this.failToReview(tx, current, input.traceId, input.occurredAt, 'invalid_callback_transition');
      const decision = decideHumanContactTransition(current, requestedState, {
        actorId: 'callback',
        actorRoles: ['SYSTEM'],
        occurredAt: input.occurredAt,
        reason: input.kind.toLowerCase(),
        traceId: input.traceId,
        channelHealthy: input.kind !== 'CHANNEL_FAILURE',
        accessibilitySatisfied: input.kind !== 'ACCESSIBILITY_UNAVAILABLE',
        expectedVersion: current.version
      });
      if (!decision.allowed) return this.failToReview(tx, current, input.traceId, input.occurredAt, decision.reasonCode);

      await tx.cancelPendingAutomation(input, input.occurredAt);
      const next = this.callbackSession(current, input, decision.nextState, decision.deadlineAt);
      if ((await tx.updateSession(next, current.version)) === 'CONFLICT') return 'CONFLICT';

      if (input.kind === 'CONSENT_GRANTED') {
        await tx.insertOutboxIfAbsent(await this.outbox(next, channelFromSession(next), 'contact.language', input.occurredAt));
      }
      await tx.insertAuditIfAbsent(await this.audit(next, `CALLBACK_${input.kind}`, input.kind.toLowerCase(), input.traceId, input.occurredAt, 'SYSTEM', 'callback', 'SYSTEM'));
      return next.state === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'APPLIED';
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
      const decision = decideHumanContactTransition(current, 'OPERATOR_TAKEOVER', {
        actorId: input.operatorId,
        actorRoles: [input.authorizedRole],
        occurredAt: input.occurredAt,
        reason: 'operator_takeover',
        traceId: input.traceId,
        channelHealthy: true,
        accessibilitySatisfied: true,
        expectedVersion: current.version
      });
      if (!decision.allowed) return this.failToReview(tx, current, input.traceId, input.occurredAt, decision.reasonCode);
      const next: ContactSessionRecord = {
        ...current,
        state: 'OPERATOR_TAKEOVER',
        assignedOperatorId: input.operatorId,
        automationSuppressed: true,
        nextActionAt: null,
        responseDeadlineAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: current.version + 1,
        updatedAt: input.occurredAt
      };
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
    const claimed = await this.repository.claimDueOutbox({ workerId, now, leaseMs: this.options.outboxLeaseMs, limit });
    const results: Array<ContactScope & { messageId: string; disposition: OutboxDeliveryDisposition }> = [];
    for (const message of claimed) {
      const scope = scopeOf(message);
      const retryAvailableAt = new Date(Date.parse(now) + boundedOutboxBackoff(message.attempt)).toISOString();
      const deliveryDeadlineAt = new Date(Date.parse(now) + this.options.deliveryTimeoutMs).toISOString();
      const deliveryToken = await this.ids.create('contact-delivery', `${message.idempotencyKey}|${workerId}|${message.leaseExpiresAt ?? deliveryDeadlineAt}`);
      let disposition: OutboxDeliveryDisposition = 'CONFLICT';
      try {
        disposition = await this.repository.processClaimedOutbox(
          {
            ...scope,
            messageId: message.messageId,
            workerId,
            now,
            retryAvailableAt,
            errorCode: 'channel_delivery_failed_or_timed_out',
            deliveryToken,
            deliveryDeadlineAt
          },
          async (fresh) => this.sendWithDeadline(fresh, deliveryDeadlineAt)
        );
      } finally {
        await this.repository.releaseOutboxLease({ ...scope, messageId: message.messageId, workerId });
      }
      results.push({ ...scope, messageId: message.messageId, disposition });
    }
    return results;
  }

  private async sendWithDeadline(message: ContactOutboxMessage, deadlineAt: string): Promise<'SENT' | 'UNAVAILABLE'> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'UNAVAILABLE'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort('contact_delivery_deadline_exceeded');
        resolve('UNAVAILABLE');
      }, this.options.deliveryTimeoutMs);
    });
    const send = this.channel.send({
      ...scopeOf(message),
      channel: message.channel,
      promptId: message.promptId,
      idempotencyKey: message.idempotencyKey,
      deadlineAt,
      signal: controller.signal
    }).catch(() => 'UNAVAILABLE' as const);
    try {
      return await Promise.race([send, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  private async processDue(claimed: ContactSessionRecord, workerId: string, now: string): Promise<RuntimeDisposition> {
    const scope = scopeOf(claimed);
    return this.repository.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(scope);
      if (current === null || current.leaseOwner !== workerId || current.automationSuppressed) return 'IDEMPOTENT';
      if (current.nextActionAt === null || Date.parse(current.nextActionAt) > Date.parse(now)) return 'IDEMPOTENT';

      if (current.state === 'CONSENT_PENDING' || current.state === 'LANGUAGE_SELECTION') {
        return this.failToReview(tx, current, `worker-${workerId}`, now, current.state === 'CONSENT_PENDING' ? 'consent_deadline_elapsed' : 'language_selection_deadline_elapsed');
      }

      if (current.state === 'CONTACTING') {
        const decision = this.systemTransition(current, 'AWAITING_RESPONSE', workerId, now, 'contact_channel_ready');
        if (!decision.allowed) return this.failToReview(tx, current, `worker-${workerId}`, now, decision.reasonCode);
        const channel = fallbackChannel(current.activeChannel, current.attemptCount);
        const awaiting: ContactSessionRecord = {
          ...current,
          state: 'AWAITING_RESPONSE',
          activeChannel: toSafetyChannel(channel),
          responseDeadlineAt: decision.deadlineAt,
          nextActionAt: decision.deadlineAt,
          version: current.version + 1,
          updatedAt: now
        };
        if ((await tx.updateSession(awaiting, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertOutboxIfAbsent(await this.outbox(awaiting, channel, 'contact.response', now));
        await tx.insertAuditIfAbsent(await this.audit(awaiting, 'CONTACT_AWAITING_RESPONSE', 'contact_channel_ready', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'APPLIED';
      }

      if (current.state === 'AWAITING_RESPONSE') {
        const decision = this.systemTransition(current, 'NO_RESPONSE', workerId, now, 'response_deadline_elapsed');
        if (!decision.allowed) return this.failToReview(tx, current, `worker-${workerId}`, now, decision.reasonCode);
        const noResponse: ContactSessionRecord = {
          ...current,
          state: 'NO_RESPONSE',
          responseDeadlineAt: null,
          nextActionAt: decision.deadlineAt,
          version: current.version + 1,
          updatedAt: now
        };
        if ((await tx.updateSession(noResponse, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(noResponse, 'CONTACT_NO_RESPONSE', 'response_deadline_elapsed', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'APPLIED';
      }

      if (current.state === 'PARTIAL_RESPONSE') {
        const decision = this.systemTransition(current, 'AWAITING_RESPONSE', workerId, now, 'partial_response_followup_due');
        if (!decision.allowed) return this.failToReview(tx, current, `worker-${workerId}`, now, decision.reasonCode);
        const awaiting: ContactSessionRecord = {
          ...current,
          state: 'AWAITING_RESPONSE',
          responseDeadlineAt: decision.deadlineAt,
          nextActionAt: decision.deadlineAt,
          version: current.version + 1,
          updatedAt: now
        };
        if ((await tx.updateSession(awaiting, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertOutboxIfAbsent(await this.outbox(awaiting, channelFromSession(awaiting), 'contact.response', now));
        await tx.insertAuditIfAbsent(await this.audit(awaiting, 'CONTACT_PARTIAL_FOLLOWUP', 'partial_response_followup_due', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'APPLIED';
      }

      if (current.state !== 'NO_RESPONSE' && current.state !== 'DISCONNECTED') return this.failToReview(tx, current, `worker-${workerId}`, now, 'unexpected_due_state');
      if (current.attemptCount >= HUMAN_CONTACT_MAX_AUTOMATED_ATTEMPTS) {
        const decision = this.systemTransition(current, 'ESCALATED', workerId, now, 'retry_limit_exhausted');
        if (!decision.allowed) return this.failToReview(tx, current, `worker-${workerId}`, now, decision.reasonCode);
        const escalated: ContactSessionRecord = { ...current, state: 'ESCALATED', nextActionAt: null, responseDeadlineAt: null, version: current.version + 1, updatedAt: now };
        if ((await tx.updateSession(escalated, current.version)) === 'CONFLICT') return 'CONFLICT';
        await tx.insertAuditIfAbsent(await this.audit(escalated, 'CONTACT_ESCALATED', 'retry_limit_exhausted', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
        return 'ESCALATED';
      }

      const decision = this.systemTransition(current, 'CONTACTING', workerId, now, current.state === 'DISCONNECTED' ? 'channel_disconnected_retry' : 'no_response_retry_due');
      if (!decision.allowed) return this.failToReview(tx, current, `worker-${workerId}`, now, decision.reasonCode);
      const contacting: ContactSessionRecord = {
        ...current,
        state: 'CONTACTING',
        attemptCount: current.attemptCount + 1,
        responseDeadlineAt: null,
        nextActionAt: now,
        version: current.version + 1,
        updatedAt: now
      };
      if ((await tx.updateSession(contacting, current.version)) === 'CONFLICT') return 'CONFLICT';
      await tx.insertAuditIfAbsent(await this.audit(contacting, 'CONTACT_RETRY_CONTACTING', current.state === 'DISCONNECTED' ? 'channel_disconnected_retry' : 'no_response_retry_due', `worker-${workerId}`, now, 'SYSTEM', workerId, 'SYSTEM'));
      return 'APPLIED';
    });
  }

  private callbackSession(current: ContactSessionRecord, input: CallbackInput, state: HumanContactState, protocolDeadline: string | null): ContactSessionRecord {
    const followupDeadline = input.kind === 'PARTIAL_RESPONSE'
      ? new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RESPONSE_DEADLINE_MS).toISOString()
      : protocolDeadline;
    return {
      ...current,
      state,
      version: current.version + 1,
      language: input.kind === 'LANGUAGE_SELECTED' && input.selectedLanguage !== undefined ? input.selectedLanguage : current.language,
      identityConfidence: strongerIdentity(current.identityConfidence, input.identityConfidence),
      lastInteractionAt: input.occurredAt,
      nextActionAt: state === 'LANGUAGE_SELECTION' || state === 'PARTIAL_RESPONSE' || state === 'DISCONNECTED'
        ? (followupDeadline ?? new Date(Date.parse(input.occurredAt) + HUMAN_CONTACT_RETRY_BASE_DELAY_MS).toISOString())
        : state === 'CONTACTING'
          ? input.occurredAt
          : null,
      responseDeadlineAt: state === 'LANGUAGE_SELECTION' || state === 'PARTIAL_RESPONSE' ? followupDeadline : null,
      updatedAt: input.occurredAt
    };
  }

  private systemTransition(current: ContactSessionRecord, requestedState: HumanContactState, workerId: string, occurredAt: string, reason: string) {
    return decideHumanContactTransition(current, requestedState, {
      actorId: workerId,
      actorRoles: ['SYSTEM'],
      occurredAt,
      reason,
      traceId: `worker-${workerId}`,
      channelHealthy: true,
      accessibilitySatisfied: true,
      expectedVersion: current.version
    });
  }

  private async failToReview(tx: ContactRuntimeTransaction, current: ContactSessionRecord, traceId: string, occurredAt: string, reasonCode: string): Promise<RuntimeDisposition> {
    const decision = decideHumanContactTransition(current, 'HUMAN_REVIEW', {
      actorId: 'runtime',
      actorRoles: ['SYSTEM'],
      occurredAt,
      reason: reasonCode,
      traceId,
      channelHealthy: false,
      accessibilitySatisfied: false,
      expectedVersion: current.version
    });
    const review: ContactSessionRecord = {
      ...current,
      state: decision.allowed ? decision.nextState : 'HUMAN_REVIEW',
      nextActionAt: null,
      responseDeadlineAt: null,
      version: current.version + 1,
      updatedAt: occurredAt
    };
    await tx.cancelPendingAutomation(current, occurredAt);
    if ((await tx.updateSession(review, current.version)) === 'CONFLICT') return 'CONFLICT';
    await tx.insertAuditIfAbsent(await this.audit(review, 'CONTACT_RUNTIME_REJECTED', reasonCode, traceId, occurredAt, 'SYSTEM', 'runtime', 'SYSTEM'));
    return 'HUMAN_REVIEW';
  }

  private async outbox(session: ContactSessionRecord, channel: ContactChannel, promptId: ContactPromptId, availableAt: string): Promise<ContactOutboxMessage> {
    const key = `${CONTACT_RUNTIME_POLICY_VERSION}|${session.tenantId}|${session.caseId}|${session.sessionId}|${session.version}|${channel}|${promptId}`;
    return { ...scopeOf(session), messageId: await this.ids.create('contact-outbox', key), channel, promptId, idempotencyKey: key, availableAt, attempt: session.attemptCount, leaseOwner: null, leaseExpiresAt: null, deliveredAt: null, cancelledAt: null, lastErrorCode: null };
  }

  private async audit(session: ContactSessionRecord, eventType: string, reasonCode: string, traceId: string, occurredAt: string, actorType: 'SYSTEM' | 'OPERATOR', actorId: string, authorizedByRole: ContactAuthorizedRole): Promise<ContactAuditEvent> {
    return { ...scopeOf(session), eventId: await this.ids.create('contact-audit', `${session.tenantId}|${session.caseId}|${session.sessionId}|${session.version}|${eventType}`), eventType, state: session.state, version: session.version, actorType, actorId, authorizedByRole, authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION, reasonCode, occurredAt, traceId, runtimePolicyVersion: CONTACT_RUNTIME_POLICY_VERSION };
  }
}

function callbackRequestedState(current: HumanContactState, kind: ContactCallbackKind): HumanContactState | null {
  if (kind === 'CONSENT_GRANTED') return current === 'CONSENT_PENDING' ? 'LANGUAGE_SELECTION' : null;
  if (kind === 'CONSENT_DECLINED') return current === 'CONSENT_PENDING' ? 'HUMAN_REVIEW' : null;
  if (kind === 'LANGUAGE_SELECTED') return current === 'LANGUAGE_SELECTION' ? 'CONTACTING' : null;
  if (kind === 'PARTIAL_RESPONSE') return current === 'AWAITING_RESPONSE' ? 'PARTIAL_RESPONSE' : null;
  if (kind === 'CONTRADICTORY' || kind === 'CHANNEL_FAILURE' || kind === 'ACCESSIBILITY_UNAVAILABLE') return 'HUMAN_REVIEW';
  if (kind === 'DISCONNECTED') return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE'].includes(current) ? 'DISCONNECTED' : null;
  if (kind === 'RESPONSE') return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE'].includes(current) ? 'RESPONSE_CONFIRMED' : null;
  return null;
}

function validCallback(input: CallbackInput): boolean {
  if (!validScope(input) || !validNullableOwnerActorId(input.ownerActorId) || input.authenticatedTenantId !== input.tenantId || input.authenticatedCaseId !== input.caseId || !validId(input.callbackId) || !validId(input.traceId) || !validId(input.idempotencyKey) || !validTime(input.occurredAt)) return false;
  if (input.kind === 'LANGUAGE_SELECTED') return input.selectedLanguage === 'ar' || input.selectedLanguage === 'en';
  if (input.selectedLanguage !== undefined) return false;
  if (input.identityConfidence !== undefined && input.kind !== 'RESPONSE' && input.kind !== 'PARTIAL_RESPONSE') return false;
  return input.identityConfidence === undefined || input.identityConfidence === 'UNVERIFIED' || input.identityConfidence === 'PARTIAL';
}

function strongerIdentity(current: HumanContactIdentityConfidence, candidate: CallbackInput['identityConfidence']): HumanContactIdentityConfidence {
  if (current === 'CONFIRMED') return current;
  if (candidate === 'PARTIAL') return 'PARTIAL';
  return current;
}

function toSafetyChannel(channel: ContactChannel): HumanContactSessionContract['activeChannel'] {
  if (channel === 'IN_APP') return 'IN_APP_CHAT';
  if (channel === 'PUSH') return 'PUSH';
  if (channel === 'SMS_SIM') return 'SMS_SIMULATION';
  return 'TELEPHONY_SIMULATION';
}

function channelFromSession(session: HumanContactSessionContract): ContactChannel {
  if (session.activeChannel === 'IN_APP_CHAT' || session.activeChannel === 'IN_APP_VOICE') return 'IN_APP';
  if (session.activeChannel === 'SMS_SIMULATION') return 'SMS_SIM';
  if (session.activeChannel === 'TELEPHONY_SIMULATION') return 'TELEPHONY_SIM';
  return 'PUSH';
}

function fallbackChannel(active: HumanContactSessionContract['activeChannel'], attempt: number): ContactChannel {
  if (attempt <= 1) return active === 'IN_APP_CHAT' || active === 'IN_APP_VOICE' ? 'IN_APP' : 'PUSH';
  if (attempt === 2) return 'PUSH';
  return 'SMS_SIM';
}
function boundedOutboxBackoff(attempt: number): number { return Math.min(60_000, HUMAN_CONTACT_RETRY_BASE_DELAY_MS * Math.max(1, attempt)); }
function humanOperatorRole(role: ContactAuthorizedRole): role is Exclude<ContactAuthorizedRole, 'SYSTEM'> { return role === 'OPERATOR' || role === 'SUPERVISOR' || role === 'SAFETY_LEAD'; }
function scopeOf(value: ContactScope): ContactScope { return { tenantId: value.tenantId, caseId: value.caseId, sessionId: value.sessionId }; }
function validScope(value: ContactScope): boolean { return validId(value.tenantId) && validId(value.caseId) && validId(value.sessionId); }
function validLanguage(value: HumanContactLanguage): boolean { return value === 'ar' || value === 'en' || value === 'UNKNOWN'; }
function validNullableOwnerActorId(value: string | null): boolean { return value === null || validId(value); }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function validTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }
