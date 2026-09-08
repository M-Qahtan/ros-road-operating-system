import { RoadEvent, RoadEventAccessScope, RoadEventStatus, SeverityLevel } from '@ros/domain';
import {
  RoadEventRevisionComponent,
  RoadEventRevisionLedgerError,
  roadEventRevisionDigest
} from './postgres-road-event-repository.js';
import { PostgresClient, PostgresPool } from './postgres-types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface LegacyRoadEventRow {
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
  readonly version: number | string;
  readonly closure_authorized_by: string | null;
  readonly closure_authorized_at: Date | string | null;
  readonly closure_authorization_reason: string | null;
}

interface ExistingReceiptRow {
  readonly component: string;
  readonly revision: number | string;
  readonly digest: string;
  readonly origin: string;
  readonly reconciliation_id: string | null;
  readonly reconciled_by: string | null;
  readonly source_event_version: number | string | null;
}

export interface ReconcileRoadEventRevisionLedgerCommand extends RoadEventAccessScope {
  readonly caseId: string;
  readonly expectedEventVersion: number;
  readonly reconciliationId: string;
  readonly operatorActorId: string;
  readonly recordedAt: Date;
}

export type RoadEventRevisionReconciliationResult = 'RECONCILED' | 'IDEMPOTENT';

export class RoadEventRevisionReconciliationError extends Error {
  override readonly name = 'RoadEventRevisionReconciliationError';
}

export class RoadEventRevisionReconciler {
  constructor(private readonly pool: PostgresPool) {}

  async reconcile(raw: ReconcileRoadEventRevisionLedgerCommand): Promise<RoadEventRevisionReconciliationResult> {
    const command = validateCommand(raw);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const loaded = await client.query<LegacyRoadEventRow>(`${LEGACY_EVENT_SELECT}
        WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3
        FOR UPDATE`, [command.caseId, command.tenantId, command.purpose]);
      if (loaded.rowCount !== 1 || loaded.rows.length !== 1 || loaded.rows[0] === undefined) {
        throw new RoadEventRevisionReconciliationError('legacy RoadEvent was not found in the exact scope');
      }
      const sourceVersion = positiveInteger(loaded.rows[0].version, 'RoadEvent version');
      if (sourceVersion !== command.expectedEventVersion) {
        throw new RoadEventRevisionReconciliationError(
          `legacy RoadEvent changed: expected version ${command.expectedEventVersion}, found ${sourceVersion}`
        );
      }
      const event = mapLegacyRoadEvent(loaded.rows[0]);
      const expected = expectedReceipts(event, command);
      const existing = await client.query<ExistingReceiptRow>(
        `SELECT component, revision, digest, origin, reconciliation_id, reconciled_by, source_event_version
         FROM road_event_revision_ledger
         WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid
         ORDER BY component, revision
         FOR UPDATE`,
        [command.tenantId, command.purpose, command.caseId]
      );
      if (existing.rows.length > 0) {
        if (!isIdempotent(existing.rows, expected, command)) {
          throw new RoadEventRevisionReconciliationError('existing revision receipts are ambiguous or have different provenance');
        }
        await client.query('COMMIT');
        return 'IDEMPOTENT';
      }
      for (const receipt of expected) await appendReceipt(client, receipt, command);
      await client.query('COMMIT');
      return 'RECONCILED';
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}

const LEGACY_EVENT_SELECT = `SELECT
  id, tenant_id, purpose, reporter_actor_id, status, severity, severity_score, confidence,
  reason_codes, severity_requires_human_review,
  ST_X(location::geometry)::double precision AS longitude,
  ST_Y(location::geometry)::double precision AS latitude,
  occurred_at, version, closure_authorized_by, closure_authorized_at, closure_authorization_reason
  FROM road_events`;

interface ExpectedReceipt { readonly component: RoadEventRevisionComponent; readonly digest: string; }

function expectedReceipts(event: RoadEvent, scope: RoadEventAccessScope): readonly ExpectedReceipt[] {
  return (['CASE', 'SEVERITY'] as const).map((component) => ({
    component,
    digest: roadEventRevisionDigest(event, scope, component)
  }));
}

async function appendReceipt(
  client: PostgresClient,
  receipt: ExpectedReceipt,
  command: ReconcileRoadEventRevisionLedgerCommand
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO road_event_revision_ledger (
       tenant_id, purpose, case_id, component, revision, digest, recorded_at,
       origin, reconciliation_id, reconciled_by, source_event_version
     ) VALUES ($1, $2, $3::uuid, $4, 1, $5, $6, 'LEGACY_RECONCILIATION', $7::uuid, $8::uuid, $9)`,
    [
      command.tenantId, command.purpose, command.caseId, receipt.component, receipt.digest,
      command.recordedAt, command.reconciliationId, command.operatorActorId, command.expectedEventVersion
    ]
  );
  if (inserted.rowCount !== 1) throw new RoadEventRevisionLedgerError(`${receipt.component} legacy receipt was not appended`);
}

function isIdempotent(
  rows: readonly ExistingReceiptRow[],
  expected: readonly ExpectedReceipt[],
  command: ReconcileRoadEventRevisionLedgerCommand
): boolean {
  if (rows.length !== expected.length) return false;
  return expected.every((receipt) => rows.some((row) =>
    row.component === receipt.component
    && positiveInteger(row.revision, 'receipt revision') === 1
    && row.digest === receipt.digest
    && row.origin === 'LEGACY_RECONCILIATION'
    && row.reconciliation_id === command.reconciliationId
    && row.reconciled_by === command.operatorActorId
    && positiveInteger(row.source_event_version, 'source event version') === command.expectedEventVersion
  ));
}

function mapLegacyRoadEvent(row: LegacyRoadEventRow): RoadEvent {
  const closureAuthorization = row.closure_authorized_by === null
    || row.closure_authorized_at === null
    || row.closure_authorization_reason === null
    ? undefined
    : {
        actorId: row.closure_authorized_by,
        authorizedAt: date(row.closure_authorized_at, 'closure authorization time'),
        reason: row.closure_authorization_reason
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
    occurredAt: date(row.occurred_at, 'occurred_at'),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    version: positiveInteger(row.version, 'RoadEvent version'),
    ...(closureAuthorization === undefined ? {} : { closureAuthorization })
  });
}

function validateCommand(command: ReconcileRoadEventRevisionLedgerCommand): ReconcileRoadEventRevisionLedgerCommand {
  if (!ACCESS_SCOPE_PATTERN.test(command.tenantId)) throw new TypeError('tenantId is invalid');
  if (!ACCESS_SCOPE_PATTERN.test(command.purpose)) throw new TypeError('purpose is invalid');
  for (const [field, value] of [
    ['caseId', command.caseId],
    ['reconciliationId', command.reconciliationId],
    ['operatorActorId', command.operatorActorId]
  ] as const) if (!UUID_PATTERN.test(value)) throw new TypeError(`${field} must be a UUID`);
  positiveInteger(command.expectedEventVersion, 'expectedEventVersion');
  date(command.recordedAt, 'recordedAt');
  return command;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RoadEventRevisionReconciliationError(`${field} must be a positive integer`);
  return parsed;
}

function date(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${field} must be a valid timestamp`);
  return parsed;
}
