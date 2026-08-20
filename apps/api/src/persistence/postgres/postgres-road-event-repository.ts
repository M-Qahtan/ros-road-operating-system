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
const ACCESS_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PAGE_SIZE = 100;

interface RoadEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly purpose: string;
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

function requireAccessScope(scope: RoadEventAccessScope): RoadEventAccessScope {
  const tenantId = scope.tenantId.trim();
  const purpose = scope.purpose.trim();
  if (!ACCESS_SCOPE_PATTERN.test(tenantId)) throw new TypeError('tenantId is not a valid access scope');
  if (!ACCESS_SCOPE_PATTERN.test(purpose)) throw new TypeError('purpose is not a valid access scope');
  return { tenantId, purpose };
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

function validateContext(context: RoadEventWriteContext): { readonly occurredAt: Date; readonly scope: RoadEventAccessScope } {
  requireText(context.actorType, 'actorType', 64);
  requireText(context.action, 'action', 128);
  requireText(context.eventType, 'eventType', 128);
  requireUuid(context.traceId, 'traceId');
  requireUuid(context.correlationId, 'correlationId');
  if (context.actorId !== undefined) requireUuid(context.actorId, 'actorId');
  if (context.causationId !== undefined) requireUuid(context.causationId, 'causationId');
  if (context.reason !== undefined) requireText(context.reason, 'reason', 500);
  return {
    occurredAt: context.occurredAt === undefined ? new Date() : asDate(context.occurredAt, 'context.occurredAt'),
    scope: requireAccessScope(context)
  };
}

const ROAD_EVENT_SELECT = `
  SELECT
    id,
    tenant_id,
    purpose,
    status,
    severity,
    severity_score,
    confidence,
    reason_codes,
    severity_requires_human_review,
    ST_X(location::geometry)::double precision AS longitude,
    ST_Y(location::geometry)::double precision AS latitude,
    occurred_at,
    version,
    closure_authorized_by,
    closure_authorized_at,
    closure_authorization_reason
  FROM road_events`;

export class PostgresRoadEventRepository implements RoadEventRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(event: RoadEvent, context: RoadEventWriteContext): Promise<void> {
    requireUuid(event.id, 'RoadEvent id');
    const { occurredAt, scope } = validateContext(context);
    const afterState = snapshot(event);

    try {
      await this.withTransaction(async (client) => {
        const authorization = event.closureAuthorization;
        await client.query(
          `INSERT INTO road_events (
            id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
            severity_requires_human_review, location, occurred_at, version,
            closure_authorized_by, closure_authorized_at, closure_authorization_reason
          ) VALUES (
            $1::uuid, $2, $3, $4::road_event_status, $5::severity_level, $6, $7, $8::text[],
            $9, ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12, $13,
            $14::uuid, $15, $16
          )`,
          [
            event.id,
            scope.tenantId,
            scope.purpose,
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
    const { occurredAt, scope } = validateContext(context);

    await this.withTransaction(async (client) => {
      const current = await client.query<RoadEventRow>(
        `${ROAD_EVENT_SELECT} WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3 FOR UPDATE`,
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
          status = $5::road_event_status,
          severity = $6::severity_level,
          severity_score = $7,
          confidence = $8,
          reason_codes = $9::text[],
          severity_requires_human_review = $10,
          location = ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography,
          occurred_at = $13,
          version = $14,
          closure_authorized_by = $15::uuid,
          closure_authorized_at = $16,
          closure_authorization_reason = $17
        WHERE id = $1::uuid AND version = $2 AND tenant_id = $3 AND purpose = $4
        RETURNING version`,
        [
          event.id,
          expectedVersion,
          scope.tenantId,
          scope.purpose,
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
      if (updated.rowCount !== 1) throw new RoadEventConcurrencyError(`RoadEvent ${event.id} changed during update`);
      await this.appendAuditAndOutbox(client, event, beforeState, afterState, context, occurredAt);
    });
  }

  async findById(id: string, rawScope: RoadEventAccessScope): Promise<RoadEvent | undefined> {
    requireUuid(id, 'RoadEvent id');
    const scope = requireAccessScope(rawScope);
    const client = await this.pool.connect();
    try {
      const result = await client.query<RoadEventRow>(
        `${ROAD_EVENT_SELECT} WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3`,
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

    const scope = requireAccessScope(rawScope);
    const conditions: string[] = ['tenant_id = $1', 'purpose = $2'];
    const values: unknown[] = [scope.tenantId, scope.purpose];
    const addValue = (value: unknown): number => { values.push(value); return values.length; };

    if (query.statuses !== undefined && query.statuses.length > 0) {
      conditions.push(`status = ANY($${addValue([...query.statuses])}::road_event_status[])`);
    }
    if (query.severities !== undefined && query.severities.length > 0) {
      conditions.push(`severity = ANY($${addValue([...query.severities])}::severity_level[])`);
    }
    if (query.occurredFrom !== undefined) conditions.push(`occurred_at >= $${addValue(query.occurredFrom)}`);
    if (query.occurredTo !== undefined) conditions.push(`occurred_at < $${addValue(query.occurredTo)}`);
    const limitParameter = addValue(query.limit);
    const offsetParameter = addValue(query.offset);
    const where = ` WHERE ${conditions.join(' AND ')}`;

    const client = await this.pool.connect();
    try {
      const result = await client.query<RoadEventRow>(
        `${ROAD_EVENT_SELECT.replace('  FROM road_events', ',\n    COUNT(*) OVER() AS total_count\n  FROM road_events')}${where}
         ORDER BY occurred_at DESC, id DESC
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
        correlation_id, causation_id, occurred_at, tenant_id, purpose
      ) VALUES ('RoadEvent', $1::uuid, $2, $3::jsonb, $4::uuid, $5::uuid, $6, $7, $8)`,
      [
        event.id,
        context.eventType,
        afterState,
        context.correlationId,
        context.causationId ?? null,
        occurredAt,
        context.tenantId,
        context.purpose
      ]
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
