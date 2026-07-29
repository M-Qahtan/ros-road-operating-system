import type {
  ContactAuditEvent,
  ContactOutboxMessage,
  ContactRuntimeRepositoryPort,
  ContactRuntimeTransaction,
  ContactScope,
  ContactSessionRecord,
  OutboxDeliveryDisposition,
  ProcessClaimedOutboxInput
} from './contact-orchestration.js';

export type ContactSqlRow = Readonly<Record<string, unknown>>;

export interface ContactSqlQueryResult<Row extends ContactSqlRow = ContactSqlRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface ContactSqlConnectionPort {
  query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values?: readonly unknown[]): Promise<ContactSqlQueryResult<Row>>;
}

/**
 * A production wrapper may be backed by `pg.Pool`. The wrapper owns BEGIN,
 * COMMIT and ROLLBACK and supplies one connection for the callback.
 */
export interface ContactSqlPoolPort extends ContactSqlConnectionPort {
  transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T>;
}

const SESSION_COLUMNS = `
  tenant_id, case_id, session_id, state, version, protocol_version,
  prompt_policy_version, accessibility_policy_version, language,
  identity_confidence, active_channel, attempt_count, response_deadline_at,
  next_action_at, last_interaction_at, assigned_operator_id,
  automation_suppressed, accessibility, lease_owner, lease_expires_at,
  updated_at`;

const OUTBOX_COLUMNS = `
  tenant_id, case_id, session_id, message_id, channel, prompt_id,
  idempotency_key, available_at, attempt, lease_owner, lease_expires_at,
  delivered_at, cancelled_at, last_error_code`;

export const POSTGRES_CONTACT_RUNTIME_SQL = Object.freeze({
  getSessionForUpdate: `SELECT ${SESSION_COLUMNS} FROM ros_eye_contact_sessions
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
    FOR UPDATE`,
  claimDueSessions: `WITH due AS (
      SELECT tenant_id, case_id, session_id
      FROM ros_eye_contact_sessions
      WHERE automation_suppressed = false
        AND next_action_at IS NOT NULL
        AND next_action_at <= $2::timestamptz
        AND (lease_expires_at IS NULL OR lease_expires_at <= $2::timestamptz)
      ORDER BY next_action_at, tenant_id, case_id, session_id
      FOR UPDATE SKIP LOCKED
      LIMIT $4
    )
    UPDATE ros_eye_contact_sessions AS session
    SET lease_owner = $1,
        lease_expires_at = $2::timestamptz + ($3::bigint * interval '1 millisecond')
    FROM due
    WHERE session.tenant_id = due.tenant_id
      AND session.case_id = due.case_id
      AND session.session_id = due.session_id
    RETURNING ${SESSION_COLUMNS}`,
  releaseSessionLease: `UPDATE ros_eye_contact_sessions
    SET lease_owner = NULL, lease_expires_at = NULL
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
      AND lease_owner = $4`,
  claimDueOutbox: `WITH due AS (
      SELECT tenant_id, case_id, session_id, message_id
      FROM ros_eye_contact_outbox
      WHERE delivered_at IS NULL
        AND cancelled_at IS NULL
        AND available_at <= $2::timestamptz
        AND (lease_expires_at IS NULL OR lease_expires_at <= $2::timestamptz)
      ORDER BY available_at, tenant_id, case_id, session_id, message_id
      FOR UPDATE SKIP LOCKED
      LIMIT $4
    )
    UPDATE ros_eye_contact_outbox AS message
    SET lease_owner = $1,
        lease_expires_at = $2::timestamptz + ($3::bigint * interval '1 millisecond')
    FROM due
    WHERE message.tenant_id = due.tenant_id
      AND message.case_id = due.case_id
      AND message.session_id = due.session_id
      AND message.message_id = due.message_id
    RETURNING ${OUTBOX_COLUMNS}`,
  getClaimedOutboxForDelivery: `SELECT ${OUTBOX_COLUMNS}
    FROM ros_eye_contact_outbox
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
      AND message_id = $4 AND lease_owner = $5
      AND lease_expires_at > $6::timestamptz
    FOR UPDATE`,
  markOutboxDelivered: `UPDATE ros_eye_contact_outbox
    SET delivered_at = $6::timestamptz,
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
      AND message_id = $4 AND lease_owner = $5
      AND delivered_at IS NULL AND cancelled_at IS NULL`,
  markOutboxRetry: `UPDATE ros_eye_contact_outbox
    SET available_at = $6::timestamptz,
        lease_owner = NULL,
        lease_expires_at = NULL,
        last_error_code = $7
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
      AND message_id = $4 AND lease_owner = $5
      AND delivered_at IS NULL AND cancelled_at IS NULL`,
  releaseOutboxLease: `UPDATE ros_eye_contact_outbox
    SET lease_owner = NULL, lease_expires_at = NULL
    WHERE tenant_id = $1 AND case_id = $2 AND session_id = $3
      AND message_id = $4 AND lease_owner = $5
      AND delivered_at IS NULL AND cancelled_at IS NULL`
});

export class PostgresContactRuntimeRepository implements ContactRuntimeRepositoryPort {
  constructor(private readonly pool: ContactSqlPoolPort) {}

  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (connection) => work(new PostgresContactRuntimeTransaction(connection)));
  }

  async claimDueSessions(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactSessionRecord[]> {
    return this.pool.transaction(async (connection) => {
      const result = await connection.query(POSTGRES_CONTACT_RUNTIME_SQL.claimDueSessions, [input.workerId, input.now, input.leaseMs, input.limit]);
      return result.rows.map(mapSession);
    });
  }

  async releaseLease(scope: ContactScope, workerId: string): Promise<void> {
    await this.pool.query(POSTGRES_CONTACT_RUNTIME_SQL.releaseSessionLease, [scope.tenantId, scope.caseId, scope.sessionId, workerId]);
  }

  async claimDueOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number }): Promise<ContactOutboxMessage[]> {
    return this.pool.transaction(async (connection) => {
      const result = await connection.query(POSTGRES_CONTACT_RUNTIME_SQL.claimDueOutbox, [input.workerId, input.now, input.leaseMs, input.limit]);
      return result.rows.map(mapOutbox);
    });
  }

  async processClaimedOutbox(
    input: ProcessClaimedOutboxInput,
    deliver: (message: ContactOutboxMessage) => Promise<'SENT' | 'UNAVAILABLE'>
  ): Promise<OutboxDeliveryDisposition> {
    return this.pool.transaction(async (connection) => {
      const selected = await connection.query(POSTGRES_CONTACT_RUNTIME_SQL.getClaimedOutboxForDelivery, [
        input.tenantId, input.caseId, input.sessionId, input.messageId, input.workerId, input.now
      ]);
      const row = selected.rows[0];
      if (row === undefined) return 'CONFLICT';
      const message = mapOutbox(row);
      if (message.cancelledAt !== null) return 'CANCELLED';
      if (message.deliveredAt !== null) return 'DELIVERED';

      // The row lock is intentionally held across the bounded channel call. This
      // establishes a strict ordering with operator takeover: cancellation that
      // commits first prevents the send; a send that obtains the fence first is
      // durably acknowledged before takeover can suppress later automation.
      const delivery = await deliver(message);
      if (delivery === 'SENT') {
        const updated = await connection.query(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxDelivered, [
          input.tenantId, input.caseId, input.sessionId, input.messageId, input.workerId, input.now
        ]);
        return updated.rowCount === 1 ? 'DELIVERED' : 'CONFLICT';
      }

      const updated = await connection.query(POSTGRES_CONTACT_RUNTIME_SQL.markOutboxRetry, [
        input.tenantId, input.caseId, input.sessionId, input.messageId, input.workerId,
        input.retryAvailableAt, input.errorCode
      ]);
      return updated.rowCount === 1 ? 'RETRY' : 'CONFLICT';
    });
  }

  async releaseOutboxLease(input: ContactScope & { messageId: string; workerId: string }): Promise<void> {
    await this.pool.query(POSTGRES_CONTACT_RUNTIME_SQL.releaseOutboxLease, [
      input.tenantId, input.caseId, input.sessionId, input.messageId, input.workerId
    ]);
  }
}

class PostgresContactRuntimeTransaction implements ContactRuntimeTransaction {
  constructor(private readonly connection: ContactSqlConnectionPort) {}

  async getSessionForUpdate(scope: ContactScope): Promise<ContactSessionRecord | null> {
    const result = await this.connection.query(POSTGRES_CONTACT_RUNTIME_SQL.getSessionForUpdate, [scope.tenantId, scope.caseId, scope.sessionId]);
    return result.rows[0] === undefined ? null : mapSession(result.rows[0]);
  }

  async insertSession(session: ContactSessionRecord): Promise<void> {
    await this.connection.query(`INSERT INTO ros_eye_contact_sessions (
      tenant_id, case_id, session_id, state, version, protocol_version,
      prompt_policy_version, accessibility_policy_version, language,
      identity_confidence, active_channel, attempt_count, response_deadline_at,
      next_action_at, last_interaction_at, assigned_operator_id,
      automation_suppressed, accessibility, lease_owner, lease_expires_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,
      $15::timestamptz,$16,$17,$18::jsonb,$19,$20::timestamptz,$21::timestamptz
    )`, sessionValues(session));
  }

  async updateSession(session: ContactSessionRecord, expectedVersion: number): Promise<'UPDATED' | 'CONFLICT'> {
    const result = await this.connection.query(`UPDATE ros_eye_contact_sessions SET
      state=$4, version=$5, protocol_version=$6, prompt_policy_version=$7,
      accessibility_policy_version=$8, language=$9, identity_confidence=$10,
      active_channel=$11, attempt_count=$12, response_deadline_at=$13::timestamptz,
      next_action_at=$14::timestamptz, last_interaction_at=$15::timestamptz,
      assigned_operator_id=$16, automation_suppressed=$17, accessibility=$18::jsonb,
      lease_owner=$19, lease_expires_at=$20::timestamptz, updated_at=$21::timestamptz
      WHERE tenant_id=$1 AND case_id=$2 AND session_id=$3 AND version=$22`,
    [...sessionValues(session), expectedVersion]);
    return result.rowCount === 1 ? 'UPDATED' : 'CONFLICT';
  }

  async insertInboxIfAbsent(scope: ContactScope, idempotencyKey: string): Promise<'INSERTED' | 'EXISTS'> {
    const result = await this.connection.query(`INSERT INTO ros_eye_contact_inbox
      (tenant_id, case_id, session_id, idempotency_key)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [scope.tenantId, scope.caseId, scope.sessionId, idempotencyKey]);
    return result.rowCount === 1 ? 'INSERTED' : 'EXISTS';
  }

  async insertAuditIfAbsent(event: ContactAuditEvent): Promise<'INSERTED' | 'EXISTS'> {
    const result = await this.connection.query(`INSERT INTO ros_eye_contact_audit (
      tenant_id, case_id, session_id, event_id, event_type, state,
      session_version, actor_type, actor_id, authorized_by_role,
      authority_policy_version, reason_code, occurred_at, trace_id,
      runtime_policy_version
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14,$15)
      ON CONFLICT DO NOTHING`, [
      event.tenantId, event.caseId, event.sessionId, event.eventId, event.eventType,
      event.state, event.version, event.actorType, event.actorId,
      event.authorizedByRole, event.authorityPolicyVersion, event.reasonCode,
      event.occurredAt, event.traceId, event.runtimePolicyVersion
    ]);
    return result.rowCount === 1 ? 'INSERTED' : 'EXISTS';
  }

  async insertOutboxIfAbsent(message: ContactOutboxMessage): Promise<'INSERTED' | 'EXISTS'> {
    const result = await this.connection.query(`INSERT INTO ros_eye_contact_outbox (
      tenant_id, case_id, session_id, message_id, channel, prompt_id,
      idempotency_key, available_at, attempt, lease_owner, lease_expires_at,
      delivered_at, cancelled_at, last_error_code
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11::timestamptz,
      $12::timestamptz,$13::timestamptz,$14)
      ON CONFLICT DO NOTHING`, [
      message.tenantId, message.caseId, message.sessionId, message.messageId,
      message.channel, message.promptId, message.idempotencyKey,
      message.availableAt, message.attempt, message.leaseOwner,
      message.leaseExpiresAt, message.deliveredAt, message.cancelledAt,
      message.lastErrorCode
    ]);
    return result.rowCount === 1 ? 'INSERTED' : 'EXISTS';
  }

  async cancelPendingAutomation(scope: ContactScope, occurredAt: string): Promise<void> {
    await this.connection.query(`UPDATE ros_eye_contact_outbox
      SET cancelled_at=$4::timestamptz, lease_owner=NULL, lease_expires_at=NULL
      WHERE tenant_id=$1 AND case_id=$2 AND session_id=$3
        AND delivered_at IS NULL AND cancelled_at IS NULL`,
    [scope.tenantId, scope.caseId, scope.sessionId, occurredAt]);
  }
}

function sessionValues(session: ContactSessionRecord): readonly unknown[] {
  return [
    session.tenantId, session.caseId, session.sessionId, session.state,
    session.version, session.protocolVersion, session.promptPolicyVersion,
    session.accessibilityPolicyVersion, session.language,
    session.identityConfidence, session.activeChannel, session.attemptCount,
    session.responseDeadlineAt, session.nextActionAt, session.lastInteractionAt,
    session.assignedOperatorId, session.automationSuppressed,
    JSON.stringify(session.accessibility), session.leaseOwner,
    session.leaseExpiresAt, session.updatedAt
  ];
}

function mapSession(row: ContactSqlRow): ContactSessionRecord {
  return {
    tenantId: text(row, 'tenant_id'),
    caseId: text(row, 'case_id'),
    sessionId: text(row, 'session_id'),
    state: text(row, 'state') as ContactSessionRecord['state'],
    version: integer(row, 'version'),
    protocolVersion: text(row, 'protocol_version') as ContactSessionRecord['protocolVersion'],
    promptPolicyVersion: text(row, 'prompt_policy_version') as ContactSessionRecord['promptPolicyVersion'],
    accessibilityPolicyVersion: text(row, 'accessibility_policy_version') as ContactSessionRecord['accessibilityPolicyVersion'],
    language: text(row, 'language') as ContactSessionRecord['language'],
    identityConfidence: text(row, 'identity_confidence') as ContactSessionRecord['identityConfidence'],
    activeChannel: nullableText(row, 'active_channel') as ContactSessionRecord['activeChannel'],
    attemptCount: integer(row, 'attempt_count'),
    responseDeadlineAt: nullableTimestamp(row, 'response_deadline_at'),
    nextActionAt: nullableTimestamp(row, 'next_action_at'),
    lastInteractionAt: timestamp(row, 'last_interaction_at'),
    assignedOperatorId: nullableText(row, 'assigned_operator_id'),
    accessibility: jsonObject(row, 'accessibility') as ContactSessionRecord['accessibility'],
    automationSuppressed: booleanValue(row, 'automation_suppressed'),
    leaseOwner: nullableText(row, 'lease_owner'),
    leaseExpiresAt: nullableTimestamp(row, 'lease_expires_at'),
    updatedAt: timestamp(row, 'updated_at')
  };
}

function mapOutbox(row: ContactSqlRow): ContactOutboxMessage {
  return {
    tenantId: text(row, 'tenant_id'),
    caseId: text(row, 'case_id'),
    sessionId: text(row, 'session_id'),
    messageId: text(row, 'message_id'),
    channel: text(row, 'channel') as ContactOutboxMessage['channel'],
    promptId: text(row, 'prompt_id'),
    idempotencyKey: text(row, 'idempotency_key'),
    availableAt: timestamp(row, 'available_at'),
    attempt: integer(row, 'attempt'),
    leaseOwner: nullableText(row, 'lease_owner'),
    leaseExpiresAt: nullableTimestamp(row, 'lease_expires_at'),
    deliveredAt: nullableTimestamp(row, 'delivered_at'),
    cancelledAt: nullableTimestamp(row, 'cancelled_at'),
    lastErrorCode: nullableText(row, 'last_error_code')
  };
}

function value(row: ContactSqlRow, key: string): unknown { return row[key]; }
function text(row: ContactSqlRow, key: string): string { const current = value(row, key); if (typeof current !== 'string') throw new Error(`invalid ${key}`); return current; }
function nullableText(row: ContactSqlRow, key: string): string | null { const current = value(row, key); if (current === null || current === undefined) return null; if (typeof current !== 'string') throw new Error(`invalid ${key}`); return current; }
function integer(row: ContactSqlRow, key: string): number { const current = value(row, key); const parsed = typeof current === 'number' ? current : Number(current); if (!Number.isInteger(parsed)) throw new Error(`invalid ${key}`); return parsed; }
function booleanValue(row: ContactSqlRow, key: string): boolean { const current = value(row, key); if (typeof current !== 'boolean') throw new Error(`invalid ${key}`); return current; }
function timestamp(row: ContactSqlRow, key: string): string { const current = value(row, key); if (current instanceof Date) return current.toISOString(); if (typeof current === 'string' && Number.isFinite(Date.parse(current))) return new Date(current).toISOString(); throw new Error(`invalid ${key}`); }
function nullableTimestamp(row: ContactSqlRow, key: string): string | null { const current = value(row, key); if (current === null || current === undefined) return null; if (current instanceof Date) return current.toISOString(); if (typeof current === 'string' && Number.isFinite(Date.parse(current))) return new Date(current).toISOString(); throw new Error(`invalid ${key}`); }
function jsonObject(row: ContactSqlRow, key: string): Readonly<Record<string, unknown>> { const current = value(row, key); if (typeof current === 'string') { const parsed: unknown = JSON.parse(current); if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Readonly<Record<string, unknown>>; } if (typeof current === 'object' && current !== null && !Array.isArray(current)) return current as Readonly<Record<string, unknown>>; throw new Error(`invalid ${key}`); }
