import {
  RoadEvent,
  RoadEventAccessScope,
  RoadEventAlreadyExistsError,
  RoadEventConcurrencyError,
  RoadEventListQuery,
  RoadEventNotFoundError,
  RoadEventPage,
  RoadEventRepository,
  RoadEventStatus,
  RoadEventWriteContext,
  SeverityLevel
} from '@ros/domain';
import { PostgresClient, PostgresPool } from './postgres-types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_ATTRIBUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PAGE_SIZE = 100;

interface RoadEventRow {
  readonly id: string;
  readonly status: RoadEventStatus;
  readonly severity: SeverityLevel;
  readonly severity_score: number | string;
  readonly confidence: number | string;
  readonly reason_codes: readonly string[];
  readonly severity_requires_human_review: boolean;
  readonly longitude: number | string;
  readonly latitude: number | string;
  readonly occurred_at: Date | string;
  readonly version: number;
  readonly closure_authorized_by: string | null;
  readonly closure_authorized_at: Date | string | null;
  readonly closure_authorization_reason: string | null;
  readonly total_count?: number | string;
}

interface VersionRow { readonly version: number; }
interface PostgresErrorLike { readonly code?: string; }

export class InvalidPersistenceIdentifierError extends Error {
  override readonly name = 'InvalidPersistenceIdentifierError';
}

function isPostgresError(error: unknown): error is PostgresErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new InvalidPersistenceIdentifierError(`${field} must be a UUID`);
  return value;
}

function requireText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new TypeError(`${field} must contain between 1 and ${maximumLength} characters`);
  }
  return normalized;
}

function requireAccessAttribute(value: string, field: string): string {
  if (!ACCESS_ATTRIBUTE_PATTERN.test(value)) throw new TypeError(`${field} is not a safe access-scope attribute`);
  return value;
}

function validateScope(scope: RoadEventAccessScope): RoadEventAccessScope {
  return {
    tenantId: requireAccessAttribute(scope.tenantId, 'tenantId'),
    purpose: requireAccessAttribute(scope.purpose, 'purpose')
  };
}

function asDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} is not a valid timestamp`);
  return date;
}

function mapRoadEvent(row: RoadEventRow): RoadEvent {
  const closureAuthorization = row.closure_authorized_by === null || row.closure_authorized_at === null || row.closure_authorization_reason === null
    ? undefined
    : {
        actorId: row.closure_authorized_by,
        authorizedAt: asDate(row.closure_authorized_at, 'closure_authorized_at'),
        reason: row.closure_authorization_reason
      };

  return new RoadEvent({
    id: row.id,
    status: row.status,
    severity: {
      level: row.severity,
      score: Number(row.severity_score),
      confidence: Number(row.confidence),
      reasonCodes: [...row.reason_codes],
      requiresHumanReview: row.severity_requires_human_review
    },
    occurredAt: asDate(row.occurred_at, 'occurred_at'),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    version: row.version,
    ...(closureAuthorization === undefined ? {} : { closureAuthorization })
  });
}

function snapshot(event: RoadEvent): Readonly<Record<string, unknown>> {
  const authorization = event.closureAuthorization;
  return Object.freeze({
    id: event.id,
    status: event.status,
    severity: {
      level: event.severity.level,
      score: event.severity.score,
      confidence: event.severity.confidence,
      reasonCodes: [...event.severity.reasonCodes],
      requiresHumanReview: event.severity.requiresHumanReview
    },
    location: { latitude: event.latitude, longitude: event.longitude },
    occurredAt: event.occurredAt.toISOString(),
    version: event.version,
    closureAuthorization: authorization === undefined
      ? null
      : {
          actorId: authorization.actorId,
          reason: authorization.reason,
          authorizedAt: authorization.authorizedAt.toISOString()
        }
  });
}

function validateContext(context: RoadEventWriteContext): Date {
  validateScope(context);
  requireText(context.actorType, 'actorType', 64);
  requireText(context.action, 'action', 128);
  requireText(context.eventType, 'eventType', 128);
  requireUuid(context.traceId, 'traceId');
  requireUuid(context.correlationId, 'correlationId');
  if (context.actorId !== undefined) requireUuid(context.actorId, 'actorId');
  if (context.causationId !== undefined) requireUuid(context.causationId, 'causationId');
  if (context.reason !== undefined) requireText(context.reason, 'reason', 500);
  return context.occurredAt === undefined ? new Date() : asDate(context.occurredAt, 'context.occurredAt');
}

function roadEventSelect(includeTotal = false): string {
  return `
  SELECT
    re.id,
    re.status,
    re.severity,
    re.severity_score,
    re.confidence,
    re.reason_codes,
    re.severity_requires_human_review,
    ST_X(re.location::geometry)::double precision AS longitude,
    ST_Y(re.location::geometry)::double precision AS latitude,
    re.occurred_at,
    re.version,
    re.closure_authorized_by,
    re.closure_authorized_at,
    re.closure_authorization_reason${includeTotal ? ',\n    COUNT(*) OVER() AS total_count' : ''}
  FROM road_events re
  INNER JOIN road_event_access_scopes scope ON scope.road_event_id = re.id`;
}

export class PostgresRoadEventRepository implements RoadEventRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(event: RoadEvent, context: RoadEventWriteContext): Promise<void> {
    requireUuid(event.id, 'RoadEvent id');
    const occurredAt = validateContext(context);
    const scope = validateScope(context);
    const afterState = snapshot(event);

    try {
      await this.withTransaction(async (client) => {
        const authorization = event.closureAuthorization;
        await client.query(
          `INSERT INTO road_events (
            id, status, severity, severity_score, confidence, reason_codes,
            severity_requires_human_review, location, occurred_at, version,
            closure_authorized_by, closure_authorized_at, closure_authorization_reason
          ) VALUES (
            $1::uuid, $2::road_event_status, $3::severity_level, $4, $5, $6::text[],
            $7, ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography, $10, $11,
            $12::uuid, $13, $14
          )`,
          [
            event.id,
            event.status,
            event.severity.level,
            event.severity.score,
            event.severity.confidence,
            [...event.severity.reasonCodes],
            event.severity.requiresHumanReview,
            event.longitude,
            event.latitude,
            event.occurredAt,
            event.version,
            authorization?.actorId ?? null,
            authorization?.authorizedAt ?? null,
            authorization?.reason ?? null
          ]
        );
        await client.query(
          `INSERT INTO road_event_access_scopes (road_event_id, tenant_id, purpose)
           VALUES ($1::uuid, $2, $3)`,
          [event.id, scope.tenantId, scope.purpose]
        );
        await this.appendAuditAndOutbox(client, event, null, afterState, context, occurredAt);
      });
    } catch (error) {
      if (isPostgresError(error) && error.code === '23505') {
        throw new RoadEventAlreadyExistsError(`RoadEvent ${event.id} already exists`);
      }
      throw error;
    }
  }

  async update(event: RoadEvent, expectedVersion: number, context: RoadEventWriteContext): Promise<void> {
    requireUuid(event.id, 'RoadEvent id');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new RangeError('expectedVersion must be a positive safe integer');
    if (event.version <= expectedVersion) throw new RangeError('RoadEvent version must advance beyond expectedVersion');
    const occurredAt = validateContext(context);
    const scope = validateScope(context);

    await this.withTransaction(async (client) => {
      const current = await client.query<RoadEventRow>(
        `${roadEventSelect()} WHERE re.id = $1::uuid AND scope.tenant_id = $2 AND scope.purpose = $3 FOR UPDATE OF re`,
        [event.id, scope.tenantId, scope.purpose]
      );
      const row = current.rows[0];
      if (row === undefined) throw new RoadEventNotFoundError(`RoadEvent ${event.id} was not found`);
      if (row.version !== expectedVersion) {
        throw new RoadEventConcurrencyError(`RoadEvent ${event.id} expected version ${expectedVersion}, found ${row.version}`);
      }

      const beforeState = snapshot(mapRoadEvent(row));
      const afterState = snapshot(event);
      const authorization = event.closureAuthorization;
      const updated = await client.query<VersionRow>(
        `UPDATE road_events SET
          status = $3::road_event_status,
          severity = $4::severity_level,
          severity_score = $5,
          confidence = $6,
          reason_codes = $7::text[],
          severity_requires_human_review = $8,
          location = ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
          occurred_at = $11,
          version = $12,
          closure_authorized_by = $13::uuid,
          closure_authorized_at = $14,
          closure_authorization_reason = $15
        WHERE id = $1::uuid
          AND version = $2
          AND EXISTS (
            SELECT 1 FROM road_event_access_scopes scope
            WHERE scope.road_event_id = road_events.id
              AND scope.tenant_id = $16
              AND scope.purpose = $17
          )
        RETURNING version`,
        [
          event.id,
          expectedVersion,
          event.status,
          event.severity.level,
          event.severity.score,
          event.severity.confidence,
          [...event.severity.reasonCodes],
          event.severity.requiresHumanReview,
          event.longitude,
          event.latitude,
          event.occurredAt,
          event.version,
          authorization?.actorId ?? null,
          authorization?.authorizedAt ?? null,
          authorization?.reason ?? null,
          scope.tenantId,
          scope.purpose
        ]
      );
      if (updated.rowCount !== 1) throw new RoadEventConcurrencyError(`RoadEvent ${event.id} changed during update`);
      await this.appendAuditAndOutbox(client, event, beforeState, afterState, context, occurredAt);
    });
  }

  async findById(id: string, rawScope: RoadEventAccessScope): Promise<RoadEvent | undefined> {
    requireUuid(id, 'RoadEvent id');
    const scope = validateScope(rawScope);
    const client = await this.pool.connect();
    try {
      const result = await client.query<RoadEventRow>(
        `${roadEventSelect()} WHERE re.id = $1::uuid AND scope.tenant_id = $2 AND scope.purpose = $3`,
        [id, scope.tenantId, scope.purpose]
      );
      const row = result.rows[0];
      return row === undefined ? undefined : mapRoadEvent(row);
    } finally {
      client.release();
    }
  }

  async list(query: RoadEventListQuery, rawScope: RoadEventAccessScope): Promise<RoadEventPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE) throw new RangeError(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    if (!Number.isSafeInteger(query.offset) || query.offset < 0) throw new RangeError('offset must be a non-negative safe integer');
    const scope = validateScope(rawScope);

    const conditions: string[] = ['scope.tenant_id = $1', 'scope.purpose = $2'];
    const values: unknown[] = [scope.tenantId, scope.purpose];
    const addValue = (value: unknown): number => { values.push(value); return values.length; };

    if (query.statuses !== undefined && query.statuses.length > 0) {
      conditions.push(`re.status = ANY($${addValue([...query.statuses])}::road_event_status[])`);
    }
    if (query.severities !== undefined && query.severities.length > 0) {
      conditions.push(`re.severity = ANY($${addValue([...query.severities])}::severity_level[])`);
    }
    if (query.occurredFrom !== undefined) conditions.push(`re.occurred_at >= $${addValue(query.occurredFrom)}`);
    if (query.occurredTo !== undefined) conditions.push(`re.occurred_at < $${addValue(query.occurredTo)}`);
    const limitParameter = addValue(query.limit);
    const offsetParameter = addValue(query.offset);

    const client = await this.pool.connect();
    try {
      const result = await client.query<RoadEventRow>(
        `${roadEventSelect(true)} WHERE ${conditions.join(' AND ')}
         ORDER BY re.occurred_at DESC, re.id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        values
      );
      const total = result.rows[0] === undefined ? 0 : Number(result.rows[0].total_count ?? 0);
      return { items: result.rows.map(mapRoadEvent), total, limit: query.limit, offset: query.offset };
    } finally {
      client.release();
    }
  }

  private async appendAuditAndOutbox(
    client: PostgresClient,
    event: RoadEvent,
    beforeState: Readonly<Record<string, unknown>> | null,
    afterState: Readonly<Record<string, unknown>>,
    context: RoadEventWriteContext,
    occurredAt: Date
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (
        actor_type, actor_id, action, resource_type, resource_id,
        before_state, after_state, reason, trace_id, occurred_at
      ) VALUES ($1, $2::uuid, $3, 'RoadEvent', $4::uuid, $5::jsonb, $6::jsonb, $7, $8::uuid, $9)`,
      [context.actorType, context.actorId ?? null, context.action, event.id, beforeState, afterState, context.reason ?? null, context.traceId, occurredAt]
    );
    await client.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload,
        correlation_id, causation_id, occurred_at
      ) VALUES ('RoadEvent', $1::uuid, $2, $3::jsonb, $4::uuid, $5::uuid, $6)`,
      [event.id, context.eventType, afterState, context.correlationId, context.causationId ?? null, occurredAt]
    );
  }

  private async withTransaction<T>(operation: (client: PostgresClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
