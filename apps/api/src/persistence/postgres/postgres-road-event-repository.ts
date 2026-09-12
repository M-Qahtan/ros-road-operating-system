import { createHash } from 'node:crypto';
import {
  RoadEvent,
  RoadEventAccessScope,
  RoadEventAlreadyExistsError,
  RoadEventClosureSourceSnapshotChangedError,
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
  readonly reporter_actor_id: string | null;
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
  readonly closure_source_input_version: number | string | null;
  readonly closure_source_snapshot_digest: string | null;
  readonly total_count?: number | string;
}

interface VersionRow { readonly version: number; }
interface RevisionLedgerRow { readonly revision: number | string; readonly digest: string; }
interface ClosureSnapshotVerificationRow { readonly closure_snapshot_current: boolean; }
interface PostgresErrorLike { readonly code?: string; }

export class InvalidPersistenceIdentifierError extends Error {
  override readonly name = 'InvalidPersistenceIdentifierError';
}

export class RoadEventRevisionLedgerError extends Error {
  override readonly name = 'RoadEventRevisionLedgerError';
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
  if (scope.reporterActorId !== undefined) requireUuid(scope.reporterActorId, 'reporterActorId');
  return { tenantId, purpose, ...(scope.reporterActorId === undefined ? {} : { reporterActorId: scope.reporterActorId }) };
}

function asDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} is not a valid timestamp`);
  return date;
}

function mapClosureSourceSnapshot(row: RoadEventRow): { readonly inputVersion: number; readonly sourceSnapshotDigest: string } | undefined {
  const rawVersion = row.closure_source_input_version;
  const digest = row.closure_source_snapshot_digest;
  if (rawVersion === null && digest === null) return undefined;
  const inputVersion = Number(rawVersion);
  if (rawVersion === null || digest === null || !Number.isSafeInteger(inputVersion) || inputVersion < 1 || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError('closure authorization source snapshot is incomplete or invalid');
  }
  return Object.freeze({ inputVersion, sourceSnapshotDigest: digest });
}

function mapRoadEvent(row: RoadEventRow): RoadEvent {
  const sourceSnapshot = mapClosureSourceSnapshot(row);
  const authorizationIncomplete = row.closure_authorized_by === null || row.closure_authorized_at === null || row.closure_authorization_reason === null;
  if (sourceSnapshot !== undefined && authorizationIncomplete) {
    throw new TypeError('closure authorization source snapshot requires a complete closure authorization');
  }
  const closureAuthorization = authorizationIncomplete
    ? undefined
    : {
        actorId: row.closure_authorized_by,
        authorizedAt: asDate(row.closure_authorized_at, 'closure_authorized_at'),
        reason: row.closure_authorization_reason,
        ...(sourceSnapshot === undefined ? {} : { sourceSnapshot })
      };

  return new RoadEvent({
    id: row.id,
    reporterActorId: row.reporter_actor_id,
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
          authorizedAt: authorization.authorizedAt.toISOString(),
          ...(authorization.sourceSnapshot === undefined ? {} : { sourceSnapshot: authorization.sourceSnapshot })
        }
  });
}

export type RoadEventRevisionComponent = 'CASE' | 'SEVERITY';

export function roadEventRevisionDigest(event: RoadEvent, scope: RoadEventAccessScope, component: RoadEventRevisionComponent): string {
  const material = component === 'CASE'
    ? {
        policyVersion: 'road-event.case-revision.v1', tenantId: scope.tenantId, purpose: scope.purpose,
        caseId: event.id, reporterActorId: event.reporterActorId, status: event.status,
        location: { latitude: event.latitude, longitude: event.longitude }, occurredAt: event.occurredAt.toISOString(),
        closureAuthorization: event.closureAuthorization === undefined ? null : {
          actorId: event.closureAuthorization.actorId,
          authorizedAt: event.closureAuthorization.authorizedAt.toISOString(),
          reason: event.closureAuthorization.reason,
          ...(event.closureAuthorization.sourceSnapshot === undefined
            ? {}
            : { sourceSnapshot: event.closureAuthorization.sourceSnapshot })
        }
      }
    : {
        policyVersion: 'road-event.severity-revision.v1', tenantId: scope.tenantId, purpose: scope.purpose,
        caseId: event.id, level: event.severity.level, score: event.severity.score,
        confidence: event.severity.confidence, reasonCodes: [...event.severity.reasonCodes],
        requiresHumanReview: event.severity.requiresHumanReview
      };
  return createHash('sha256').update(canonicalize(material), 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
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
    reporter_actor_id,
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
    closure_authorization_reason,
    closure_source_input_version,
    closure_source_snapshot_digest
  FROM road_events`;

const CLOSURE_SNAPSHOT_CURRENT_SQL = `
  SELECT (
    EXISTS (
      SELECT 1 FROM road_event_revision_ledger original_case
      WHERE original_case.tenant_id = s.tenant_id AND original_case.purpose = s.purpose
        AND original_case.case_id = s.case_id AND original_case.component = 'CASE'
        AND original_case.revision = s.case_revision AND original_case.digest = s.case_digest
    )
    AND COALESCE((
      SELECT current_case.revision = s.case_revision + 1 AND current_case.digest = $6
      FROM road_event_revision_ledger current_case
      WHERE current_case.tenant_id = s.tenant_id AND current_case.purpose = s.purpose
        AND current_case.case_id = s.case_id AND current_case.component = 'CASE'
      ORDER BY current_case.revision DESC LIMIT 1
    ), false)
    AND COALESCE((
      SELECT current_severity.revision = s.severity_revision AND current_severity.digest = s.severity_digest
      FROM road_event_revision_ledger current_severity
      WHERE current_severity.tenant_id = s.tenant_id AND current_severity.purpose = s.purpose
        AND current_severity.case_id = s.case_id AND current_severity.component = 'SEVERITY'
      ORDER BY current_severity.revision DESC LIMIT 1
    ), false)
    AND (
      (s.contact_revision IS NULL
        AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_revision_ledger c WHERE c.tenant_id=s.tenant_id AND c.purpose=s.purpose AND c.case_id=s.case_id)
        AND NOT EXISTS (SELECT 1 FROM ros_eye_contact_sessions cs WHERE cs.tenant_id=s.tenant_id AND cs.case_id=s.case_id))
      OR
      (s.contact_revision IS NOT NULL
        AND COALESCE((SELECT c.revision=s.contact_revision AND c.digest=s.contact_digest
          FROM ros_eye_contact_revision_ledger c
          WHERE c.tenant_id=s.tenant_id AND c.purpose=s.purpose AND c.case_id=s.case_id
          ORDER BY c.revision DESC LIMIT 1), false)
        AND (SELECT count(*) FROM ros_eye_contact_sessions cs WHERE cs.tenant_id=s.tenant_id AND cs.case_id=s.case_id) = 1)
    )
    AND COALESCE((SELECT e.revision=s.evidence_revision AND e.digest=s.evidence_digest
      FROM evidence_revision_ledger e
      WHERE e.tenant_id=s.tenant_id AND e.purpose=s.purpose AND e.case_id=s.case_id
      ORDER BY e.revision DESC LIMIT 1), false)
    AND COALESCE((SELECT i.revision=s.indicator_revision AND i.digest=s.indicator_digest
      FROM human_safety_indicator_revision_ledger i
      WHERE i.tenant_id=s.tenant_id AND i.purpose=s.purpose AND i.case_id=s.case_id
      ORDER BY i.revision DESC LIMIT 1), false)
  ) AS closure_snapshot_current
  FROM ros_eye_safety_fusion_input_snapshots s
  WHERE s.tenant_id=$1 AND s.purpose=$2 AND s.case_id=$3::uuid
    AND s.input_version=$4 AND s.snapshot_digest=$5
  FOR SHARE OF s`;

export class PostgresRoadEventRepository implements RoadEventRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(event: RoadEvent, context: RoadEventWriteContext): Promise<void> {
    requireUuid(event.id, 'RoadEvent id');
    const { occurredAt, scope } = validateContext(context);
    const afterState = snapshot(event);
    const trustedReporterActorId = context.reporterActorId ?? null;
    if (trustedReporterActorId !== null && context.actorId !== trustedReporterActorId) {
      throw new TypeError('RoadEvent reporter ownership must use the trusted write actor');
    }
    if (event.reporterActorId !== trustedReporterActorId || scope.reporterActorId !== (trustedReporterActorId ?? undefined)) {
      throw new TypeError('RoadEvent reporter ownership must match the trusted FIELD_USER write context');
    }

    try {
      await this.withTransaction(async (client) => {
        const authorization = event.closureAuthorization;
        await client.query(
          `INSERT INTO road_events (
            id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
            severity_requires_human_review, location, occurred_at, version,
            closure_authorized_by, closure_authorized_at, closure_authorization_reason,
            closure_source_input_version, closure_source_snapshot_digest, reporter_actor_id
          ) VALUES (
            $1::uuid, $2, $3, $4::road_event_status, $5::severity_level, $6, $7, $8::text[],
            $9, ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12, $13,
            $14::uuid, $15, $16, $17, $18, $19::uuid
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
            authorization?.reason ?? null,
            authorization?.sourceSnapshot?.inputVersion ?? null,
            authorization?.sourceSnapshot?.sourceSnapshotDigest ?? null,
            trustedReporterActorId
          ]
        );
        await this.appendInitialRevisionReceipts(client, event, scope, occurredAt);
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
    const closureSnapshot = event.status === RoadEventStatus.Closed &&
      (event.severity.level === SeverityLevel.High || event.severity.level === SeverityLevel.Critical)
      ? event.closureAuthorization?.sourceSnapshot
      : undefined;
    if (event.status === RoadEventStatus.Closed &&
        (event.severity.level === SeverityLevel.High || event.severity.level === SeverityLevel.Critical) &&
        closureSnapshot === undefined) {
      throw new RoadEventClosureSourceSnapshotChangedError('High-risk closure requires a persisted governed source snapshot');
    }

    try {
      await this.withTransaction(async (client) => {
        if (closureSnapshot !== undefined) await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        const current = await client.query<RoadEventRow>(
        `${ROAD_EVENT_SELECT} WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3 FOR UPDATE`,
        [event.id, scope.tenantId, scope.purpose]
      );
      const row = current.rows[0];
      if (row === undefined) throw new RoadEventNotFoundError(`RoadEvent ${event.id} was not found`);
      if (row.version !== expectedVersion) {
        throw new RoadEventConcurrencyError(`RoadEvent ${event.id} expected version ${expectedVersion}, found ${row.version}`);
      }

      const before = mapRoadEvent(row);
      if (closureSnapshot !== undefined) {
        const persisted = before.closureAuthorization?.sourceSnapshot;
        if (persisted === undefined || persisted.inputVersion !== closureSnapshot.inputVersion ||
            persisted.sourceSnapshotDigest !== closureSnapshot.sourceSnapshotDigest) {
          throw new RoadEventClosureSourceSnapshotChangedError('Persisted closure authorization snapshot binding changed');
        }
        const verification = await client.query<ClosureSnapshotVerificationRow>(CLOSURE_SNAPSHOT_CURRENT_SQL, [
          scope.tenantId, scope.purpose, event.id, closureSnapshot.inputVersion,
          closureSnapshot.sourceSnapshotDigest, roadEventRevisionDigest(before, scope, 'CASE')
        ]);
        if (verification.rowCount !== 1 || verification.rows[0]?.closure_snapshot_current !== true) {
          throw new RoadEventClosureSourceSnapshotChangedError('Closure source snapshot is no longer current');
        }
      }
      const beforeState = snapshot(before);
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
          closure_authorization_reason = $17,
          closure_source_input_version = $18,
          closure_source_snapshot_digest = $19
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
          authorization?.reason ?? null,
          authorization?.sourceSnapshot?.inputVersion ?? null,
          authorization?.sourceSnapshot?.sourceSnapshotDigest ?? null
        ]
      );
      if (updated.rowCount !== 1) throw new RoadEventConcurrencyError(`RoadEvent ${event.id} changed during update`);
        await this.appendChangedRevisionReceipts(client, before, event, scope, occurredAt);
        await this.appendAuditAndOutbox(client, event, beforeState, afterState, context, occurredAt);
      });
    } catch (error) {
      if (closureSnapshot !== undefined && isPostgresError(error) && error.code === '40001') {
        throw new RoadEventClosureSourceSnapshotChangedError('Concurrent source change invalidated high-risk closure');
      }
      throw error;
    }
  }

  async findById(id: string, rawScope: RoadEventAccessScope): Promise<RoadEvent | undefined> {
    requireUuid(id, 'RoadEvent id');
    const scope = requireAccessScope(rawScope);
    const client = await this.pool.connect();
    try {
      const result = await client.query<RoadEventRow>(
        `${ROAD_EVENT_SELECT} WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3${scope.reporterActorId === undefined ? '' : ' AND reporter_actor_id = $4::uuid'}`,
        [id, scope.tenantId, scope.purpose, ...(scope.reporterActorId === undefined ? [] : [scope.reporterActorId])]
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
    if (scope.reporterActorId !== undefined) conditions.push(`reporter_actor_id = $${addValue(scope.reporterActorId)}::uuid`);

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

  private async appendInitialRevisionReceipts(
    client: PostgresClient,
    event: RoadEvent,
    scope: RoadEventAccessScope,
    recordedAt: Date
  ): Promise<void> {
    for (const component of ['CASE', 'SEVERITY'] as const) {
      await this.insertRevisionReceipt(client, event, scope, component, 1, roadEventRevisionDigest(event, scope, component), recordedAt);
    }
  }

  private async appendChangedRevisionReceipts(
    client: PostgresClient,
    before: RoadEvent,
    after: RoadEvent,
    scope: RoadEventAccessScope,
    recordedAt: Date
  ): Promise<void> {
    for (const component of ['CASE', 'SEVERITY'] as const) {
      const latest = await client.query<RevisionLedgerRow>(
        `SELECT revision, digest FROM road_event_revision_ledger
         WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid AND component = $4
         ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
        [scope.tenantId, scope.purpose, after.id, component]
      );
      const receipt = latest.rows[0];
      if (latest.rowCount !== 1 || receipt === undefined) {
        throw new RoadEventRevisionLedgerError(`${component} revision receipt is missing`);
      }
      const revision = Number(receipt.revision);
      if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(receipt.digest)) {
        throw new RoadEventRevisionLedgerError(`${component} revision receipt is invalid`);
      }
      const beforeDigest = roadEventRevisionDigest(before, scope, component);
      if (receipt.digest !== beforeDigest) throw new RoadEventRevisionLedgerError(`${component} revision receipt does not match RoadEvent state`);
      const afterDigest = roadEventRevisionDigest(after, scope, component);
      if (afterDigest !== beforeDigest) {
        await this.insertRevisionReceipt(client, after, scope, component, revision + 1, afterDigest, recordedAt);
      }
    }
  }

  private async insertRevisionReceipt(
    client: PostgresClient,
    event: RoadEvent,
    scope: RoadEventAccessScope,
    component: RoadEventRevisionComponent,
    revision: number,
    digest: string,
    recordedAt: Date
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO road_event_revision_ledger (
         tenant_id, purpose, case_id, component, revision, digest, recorded_at
       ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7)`,
      [scope.tenantId, scope.purpose, event.id, component, revision, digest, recordedAt]
    );
    if (result.rowCount !== 1) throw new RoadEventRevisionLedgerError(`${component} revision receipt was not appended`);
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
