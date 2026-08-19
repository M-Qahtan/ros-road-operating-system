import {
  AuditTimelineEntry,
  AuditTimelinePort,
  IdempotencyInFlightError,
  IdempotencyPort,
  IdempotencyRecord,
  SignalAttachmentInput,
  SignalAttachmentPort
} from '../../application/ports.js';
import { PostgresPool } from './postgres-types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface IdempotencyRow {
  readonly fingerprint: string;
  readonly response: unknown;
}

interface AdvisoryLockRow {
  readonly acquired: boolean;
}

interface AuditRow {
  readonly action: string;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly before_state: Readonly<Record<string, unknown>> | null;
  readonly after_state: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
  readonly trace_id: string;
  readonly occurred_at: Date | string;
}

export class IdempotencyPersistenceConflictError extends Error {
  override readonly name = 'IdempotencyPersistenceConflictError';
}

function requireText(value: string, field: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new TypeError(`${field} must contain between ${min} and ${max} characters`);
  }
  return normalized;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Audit timestamp is invalid');
  return date.toISOString();
}

export class PostgresIdempotencyAdapter implements IdempotencyPort {
  constructor(private readonly pool: PostgresPool) {}

  async executeExclusively<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T> {
    const normalizedScope = requireText(scope, 'scope', 1, 128);
    const normalizedKey = requireText(key, 'idempotencyKey', 8, 128);
    const lockMaterial = `${normalizedScope}\u0000${normalizedKey}`;
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const lock = await client.query<AdvisoryLockRow>(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired`,
        [lockMaterial]
      );
      if (lock.rows[0]?.acquired !== true) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        throw new IdempotencyInFlightError('Equivalent idempotent request is already in progress');
      }

      const value = await operation();
      await client.query('COMMIT');
      transactionOpen = false;
      return value;
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK'); } catch { /* Connection close/release drops transaction-scoped lock. */ }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | undefined> {
    const normalizedScope = requireText(scope, 'scope', 1, 128);
    const normalizedKey = requireText(key, 'idempotencyKey', 8, 128);
    const client = await this.pool.connect();
    try {
      const result = await client.query<IdempotencyRow>(
        `SELECT fingerprint, response
           FROM idempotency_records
          WHERE scope = $1 AND idempotency_key = $2`,
        [normalizedScope, normalizedKey]
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : { fingerprint: row.fingerprint, value: row.response as T };
    } finally {
      client.release();
    }
  }

  async put<T>(scope: string, key: string, record: IdempotencyRecord<T>): Promise<void> {
    const normalizedScope = requireText(scope, 'scope', 1, 128);
    const normalizedKey = requireText(key, 'idempotencyKey', 8, 128);
    if (!SHA256_PATTERN.test(record.fingerprint)) throw new TypeError('fingerprint must be lowercase SHA-256 hex');

    const client = await this.pool.connect();
    try {
      const inserted = await client.query<IdempotencyRow>(
        `INSERT INTO idempotency_records (scope, idempotency_key, fingerprint, response)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (scope, idempotency_key) DO NOTHING
         RETURNING fingerprint, response`,
        [normalizedScope, normalizedKey, record.fingerprint, record.value]
      );
      if (inserted.rowCount === 1) return;

      const existing = await client.query<IdempotencyRow>(
        `SELECT fingerprint, response
           FROM idempotency_records
          WHERE scope = $1 AND idempotency_key = $2`,
        [normalizedScope, normalizedKey]
      );
      const row = existing.rows[0];
      if (row === undefined || row.fingerprint !== record.fingerprint) {
        throw new IdempotencyPersistenceConflictError(
          'Idempotency key already exists with a different request fingerprint'
        );
      }
    } finally {
      client.release();
    }
  }
}

export class PostgresSignalAttachmentAdapter implements SignalAttachmentPort {
  constructor(private readonly pool: PostgresPool) {}

  async attach(input: SignalAttachmentInput): Promise<void> {
    const roadEventId = requireUuid(input.roadEventId, 'roadEventId');
    const signalId = requireUuid(input.signalId, 'signalId');
    const actorId = requireUuid(input.actor.actorId, 'actorId');
    const traceId = requireUuid(input.traceId, 'traceId');
    if (!Number.isFinite(input.matchScore) || input.matchScore < 0 || input.matchScore > 1) {
      throw new RangeError('matchScore must be between 0 and 1');
    }
    const mergeReasons = input.mergeReasons.map((reason) => requireText(reason, 'mergeReason', 1, 256));
    if (mergeReasons.length === 0) throw new TypeError('mergeReasons must not be empty');
    const actorType = input.actor.roles[0];
    if (actorType === undefined) throw new TypeError('actor must have at least one role');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const attached = await client.query(
        `INSERT INTO road_event_signals (road_event_id, signal_id, match_score, merge_reason)
         VALUES ($1::uuid, $2::uuid, $3, $4::text[])
         ON CONFLICT (road_event_id, signal_id) DO NOTHING
         RETURNING road_event_id`,
        [roadEventId, signalId, input.matchScore, mergeReasons]
      );
      if (attached.rowCount === 1) {
        const payload = {
          signalId,
          matchScore: input.matchScore,
          mergeReasons
        };
        await client.query(
          `INSERT INTO audit_logs (
             actor_type, actor_id, action, resource_type, resource_id,
             before_state, after_state, reason, trace_id
           ) VALUES ($1, $2::uuid, 'road_event.signal_attached', 'RoadEvent', $3::uuid,
                     NULL, $4::jsonb, NULL, $5::uuid)`,
          [actorType, actorId, roadEventId, payload, traceId]
        );
        await client.query(
          `INSERT INTO road_event_timeline (
             road_event_id, event_type, actor_type, actor_id, payload, trace_id
           ) VALUES ($1::uuid, 'RoadEventSignalAttached', $2, $3::uuid, $4::jsonb, $5::uuid)`,
          [roadEventId, actorType, actorId, payload, traceId]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresAuditTimelineAdapter implements AuditTimelinePort {
  constructor(private readonly pool: PostgresPool) {}

  async listForRoadEvent(roadEventId: string): Promise<readonly AuditTimelineEntry[]> {
    const id = requireUuid(roadEventId, 'roadEventId');
    const client = await this.pool.connect();
    try {
      const result = await client.query<AuditRow>(
        `SELECT action, actor_type, actor_id, before_state, after_state, reason, trace_id, occurred_at
           FROM audit_logs
          WHERE resource_type = 'RoadEvent' AND resource_id = $1::uuid
          ORDER BY occurred_at ASC, id ASC`,
        [id]
      );
      return result.rows.map((row) => ({
        action: row.action,
        actorType: row.actor_type,
        actorId: row.actor_id,
        beforeState: row.before_state,
        afterState: row.after_state,
        reason: row.reason,
        traceId: row.trace_id,
        occurredAt: asIso(row.occurred_at)
      }));
    } finally {
      client.release();
    }
  }
}
