import {
  EvidenceAuditContext,
  EvidenceNotFoundError,
  EvidenceRecord,
  EvidenceRepository
} from './evidence-types.js';
import { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
import { evidenceRevisionDigest } from './evidence-revision.js';

export interface EvidenceRow extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly road_event_id: string;
  readonly object_key: string;
  readonly original_filename: string;
  readonly content_type: string;
  readonly declared_size_bytes: number | string;
  readonly actual_size_bytes: number | string | null;
  readonly declared_checksum_sha256: string;
  readonly verified_checksum_sha256: string | null;
  readonly status: EvidenceRecord['status'];
  readonly upload_expires_at: Date | string;
  readonly retain_until: Date | string;
  readonly legal_hold: boolean;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly quarantine_reason: string | null;
}

function asDate(value: Date | string): Date {
  const result = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new TypeError('Evidence timestamp is invalid');
  return result;
}

export function mapEvidenceRow(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    roadEventId: row.road_event_id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    declaredSizeBytes: Number(row.declared_size_bytes),
    ...(row.actual_size_bytes === null ? {} : { actualSizeBytes: Number(row.actual_size_bytes) }),
    declaredChecksumSha256: row.declared_checksum_sha256,
    ...(row.verified_checksum_sha256 === null ? {} : { verifiedChecksumSha256: row.verified_checksum_sha256 }),
    status: row.status,
    uploadExpiresAt: asDate(row.upload_expires_at),
    retention: { retainUntil: asDate(row.retain_until), legalHold: row.legal_hold },
    createdBy: row.created_by,
    createdAt: asDate(row.created_at),
    ...(row.completed_at === null ? {} : { completedAt: asDate(row.completed_at) }),
    ...(row.quarantine_reason === null ? {} : { quarantineReason: row.quarantine_reason })
  };
}

export const EVIDENCE_SELECT_COLUMNS = `
  id, road_event_id, object_key, original_filename, content_type,
  declared_size_bytes, actual_size_bytes, declared_checksum_sha256,
  verified_checksum_sha256, status, upload_expires_at, retain_until,
  legal_hold, created_by, created_at, completed_at, quarantine_reason
`;

const SELECT_EVIDENCE = `SELECT ${EVIDENCE_SELECT_COLUMNS} FROM evidence_objects`;

export class PostgresEvidenceRepository implements EvidenceRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(record: EvidenceRecord, audit: EvidenceAuditContext): Promise<void> {
    await this.withTransaction(async (client) => {
      const revisionState = await this.loadRevisionState(client, record.roadEventId);
      await client.query(
        `INSERT INTO evidence_objects (
          id, road_event_id, object_key, original_filename, content_type,
          declared_size_bytes, declared_checksum_sha256, status,
          upload_expires_at, retain_until, legal_hold, created_by, created_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::evidence_status, $9, $10, $11, $12, $13)`,
        [record.id, record.roadEventId, record.objectKey, record.originalFilename, record.contentType,
          record.declaredSizeBytes, record.declaredChecksumSha256, record.status,
          record.uploadExpiresAt, record.retention.retainUntil, record.retention.legalHold,
          record.createdBy, record.createdAt]
      );
      await this.appendAudit(client, record.id, record.roadEventId, null, record, audit);
      await this.appendRevision(client, revisionState, [...revisionState.records, record], audit.occurredAt ?? record.createdAt);
    });
  }

  async findById(id: string): Promise<EvidenceRecord | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<EvidenceRow>(`${SELECT_EVIDENCE} WHERE id = $1::uuid`, [id]);
      return result.rows[0] === undefined ? undefined : mapEvidenceRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async appendAccessAudit(record: EvidenceRecord, audit: EvidenceAuditContext): Promise<void> {
    await this.withTransaction(async (client) => {
      await this.appendAudit(client, record.id, record.roadEventId, record, record, audit);
    });
  }

  async markPreserved(
    id: string,
    actualSizeBytes: number,
    verifiedChecksumSha256: string,
    completedAt: Date,
    audit: EvidenceAuditContext
  ): Promise<EvidenceRecord> {
    return this.transition(id, 'PRESERVED', completedAt, audit, {
      actualSizeBytes,
      verifiedChecksumSha256,
      quarantineReason: null
    });
  }

  async markQuarantined(id: string, reason: string, occurredAt: Date, audit: EvidenceAuditContext): Promise<EvidenceRecord> {
    return this.transition(id, 'QUARANTINED', occurredAt, audit, {
      actualSizeBytes: null,
      verifiedChecksumSha256: null,
      quarantineReason: reason
    });
  }

  private async transition(
    id: string,
    status: 'PRESERVED' | 'QUARANTINED',
    occurredAt: Date,
    audit: EvidenceAuditContext,
    values: { readonly actualSizeBytes: number | null; readonly verifiedChecksumSha256: string | null; readonly quarantineReason: string | null }
  ): Promise<EvidenceRecord> {
    return this.withTransaction(async (client) => {
      const locator = await client.query<{ road_event_id: string }>(
        `SELECT road_event_id::text FROM evidence_objects WHERE id=$1::uuid`, [id]
      );
      if (locator.rowCount !== 1 || locator.rows.length !== 1 || locator.rows[0] === undefined) {
        throw new EvidenceNotFoundError('Evidence was not found');
      }
      const revisionState = await this.loadRevisionState(client, locator.rows[0].road_event_id);
      const current = await client.query<EvidenceRow>(`${SELECT_EVIDENCE} WHERE id = $1::uuid FOR UPDATE`, [id]);
      const row = current.rows[0];
      if (row === undefined) throw new EvidenceNotFoundError('Evidence was not found');
      if (row.road_event_id !== revisionState.caseId) throw new Error('Evidence parent changed concurrently');
      const before = mapEvidenceRow(row);
      const updated = await client.query<EvidenceRow>(
        `UPDATE evidence_objects SET
          status = $2::evidence_status,
          actual_size_bytes = $3,
          verified_checksum_sha256 = $4,
          completed_at = $5,
          quarantine_reason = $6
        WHERE id = $1::uuid AND status = 'PENDING_UPLOAD'
        RETURNING id, road_event_id, object_key, original_filename, content_type,
          declared_size_bytes, actual_size_bytes, declared_checksum_sha256,
          verified_checksum_sha256, status, upload_expires_at, retain_until,
          legal_hold, created_by, created_at, completed_at, quarantine_reason`,
        [id, status, values.actualSizeBytes, values.verifiedChecksumSha256, occurredAt, values.quarantineReason]
      );
      const changed = updated.rows[0];
      if (changed === undefined) throw new Error('Evidence status changed concurrently');
      const after = mapEvidenceRow(changed);
      await this.appendAudit(client, id, row.road_event_id, before, after, audit);
      await this.appendRevision(
        client,
        revisionState,
        revisionState.records.map((record) => record.id === after.id ? after : record),
        audit.occurredAt ?? occurredAt
      );
      return after;
    });
  }

  private async appendAudit(
    client: PostgresClient,
    evidenceId: string,
    roadEventId: string,
    before: EvidenceRecord | null,
    after: EvidenceRecord,
    audit: EvidenceAuditContext
  ): Promise<void> {
    const occurredAt = audit.occurredAt ?? new Date();
    await client.query(
      `INSERT INTO evidence_audit_logs (
        evidence_id, road_event_id, actor_id, action, before_state,
        after_state, reason, trace_id, occurred_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
      [evidenceId, roadEventId, audit.actorId, audit.action,
        before === null ? null : JSON.stringify(before), JSON.stringify(after),
        audit.reason ?? null, audit.traceId, occurredAt]
    );
  }

  private async loadRevisionState(client: PostgresClient, caseId: string): Promise<EvidenceRevisionState> {
    const parent = await client.query<{ tenant_id: string; purpose: string; case_id: string }>(`SELECT
      tenant_id, purpose, id::text AS case_id
      FROM road_events WHERE id=$1::uuid FOR UPDATE`, [caseId]);
    const scope = parent.rows[0];
    if (parent.rowCount !== 1 || parent.rows.length !== 1 || scope === undefined ||
        typeof scope.tenant_id !== 'string' || typeof scope.purpose !== 'string' || scope.case_id !== caseId.toLowerCase()) {
      throw new Error('Evidence parent RoadEvent is unavailable or ambiguous');
    }
    const evidence = await client.query<EvidenceRow>(`SELECT ${EVIDENCE_SELECT_COLUMNS}
      FROM evidence_objects WHERE road_event_id=$1::uuid ORDER BY id`, [caseId]);
    const records = evidence.rows.map(mapEvidenceRow);
    const latest = await client.query<{ revision: number | string; digest: string }>(`SELECT revision, digest
      FROM evidence_revision_ledger
      WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
      ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [scope.tenant_id, scope.purpose, caseId]);
    const receipt = latest.rows[0];
    if (records.length === 0) {
      if (latest.rowCount !== 0 || receipt !== undefined) throw new Error('Evidence ledger exists without evidence state');
      return { tenantId: scope.tenant_id, purpose: scope.purpose, caseId, records, revision: 0 };
    }
    if (latest.rowCount !== 1 || latest.rows.length !== 1 || receipt === undefined) {
      throw new Error('Evidence revision receipt is missing or ambiguous');
    }
    const revision = Number(receipt.revision);
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(receipt.digest)) {
      throw new Error('invalid Evidence revision receipt');
    }
    const expected = evidenceRevisionDigest(
      { tenantId: scope.tenant_id, purpose: scope.purpose, caseId }, records
    );
    if (receipt.digest !== expected) throw new Error('Evidence revision receipt does not match current evidence state');
    return { tenantId: scope.tenant_id, purpose: scope.purpose, caseId, records, revision };
  }

  private async appendRevision(
    client: PostgresClient,
    state: EvidenceRevisionState,
    records: readonly EvidenceRecord[],
    recordedAt: Date
  ): Promise<void> {
    const digest = evidenceRevisionDigest(state, records);
    const result = await client.query(`INSERT INTO evidence_revision_ledger (
      tenant_id, purpose, case_id, revision, digest, recorded_at
    ) VALUES ($1,$2,$3::uuid,$4,$5,$6)`, [
      state.tenantId, state.purpose, state.caseId, state.revision + 1, digest, recordedAt
    ]);
    if (result.rowCount !== 1) throw new Error('Evidence revision receipt was not appended');
  }

  private async withTransaction<T>(operation: (client: PostgresClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }
}

interface EvidenceRevisionState {
  readonly tenantId: string;
  readonly purpose: string;
  readonly caseId: string;
  readonly records: readonly EvidenceRecord[];
  readonly revision: number;
}
