import type { SafetyFusionInputSnapshot } from '@ros/contracts';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlRow } from './contact-orchestration-postgres.js';

export interface InputSnapshotScope {
  readonly tenantId: string;
  readonly purpose: string;
  readonly caseId: string;
}

export interface CaptureInputSnapshotRequest extends InputSnapshotScope {
  readonly expectedPreviousInputVersion: number;
  readonly snapshot: SafetyFusionInputSnapshot;
}

export type InputSnapshotCaptureDisposition = 'CREATED' | 'IDEMPOTENT' | 'CONFLICT' | 'NOT_FOUND';

interface VersionRow extends ContactSqlRow { readonly input_version: number | string }

export const POSTGRES_INPUT_SNAPSHOT_SQL = Object.freeze({
  authorizeCase: `SELECT 1 AS authorized
    FROM road_events
    WHERE id = $3::uuid AND tenant_id = $1 AND purpose = $2
    FOR SHARE`,
  readExact: `SELECT tenant_id, purpose, case_id, input_version, policy_version, captured_at,
      case_revision, case_digest, severity_revision, severity_digest,
      contact_revision, contact_digest, evidence_revision, evidence_digest,
      indicator_revision, indicator_digest, snapshot_digest
    FROM ros_eye_safety_fusion_input_snapshots
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid AND input_version = $4`,
  readLatestVersion: `SELECT input_version
    FROM ros_eye_safety_fusion_input_snapshots
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid
    ORDER BY input_version DESC
    LIMIT 1
    FOR UPDATE`,
  insert: `INSERT INTO ros_eye_safety_fusion_input_snapshots (
      tenant_id, purpose, case_id, input_version, policy_version, captured_at,
      case_revision, case_digest, severity_revision, severity_digest,
      contact_revision, contact_digest, evidence_revision, evidence_digest,
      indicator_revision, indicator_digest, snapshot_digest
    ) VALUES (
      $1, $2, $3::uuid, $4, $5, $6::timestamptz,
      $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
    ) ON CONFLICT DO NOTHING`
});

export class PostgresInputSnapshotRepository {
  constructor(private readonly pool: ContactSqlPoolPort) {}

  async capture(request: CaptureInputSnapshotRequest): Promise<InputSnapshotCaptureDisposition> {
    validateRequest(request);
    return this.pool.transaction(async (connection) => {
      const scopeValues = [request.tenantId, request.purpose, request.caseId] as const;
      const authorized = await connection.query(POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase, scopeValues);
      if (authorized.rowCount !== 1) return 'NOT_FOUND';

      const exact = await this.readWith(connection, request, request.snapshot.inputVersion);
      if (exact !== null) return sameSnapshot(exact, request.snapshot) ? 'IDEMPOTENT' : 'CONFLICT';

      const latest = await connection.query<VersionRow>(POSTGRES_INPUT_SNAPSHOT_SQL.readLatestVersion, scopeValues);
      const latestVersion = latest.rows[0] === undefined ? 0 : integer(latest.rows[0].input_version, 'input_version');
      if (latestVersion !== request.expectedPreviousInputVersion || request.snapshot.inputVersion !== latestVersion + 1) {
        return 'CONFLICT';
      }

      const inserted = await connection.query(POSTGRES_INPUT_SNAPSHOT_SQL.insert, values(request));
      if (inserted.rowCount === 1) return 'CREATED';

      // A concurrent writer may have won the unique input-version fence after
      // our read. Only an exact receipt replay is idempotent.
      const winner = await this.readWith(connection, request, request.snapshot.inputVersion);
      return winner !== null && sameSnapshot(winner, request.snapshot) ? 'IDEMPOTENT' : 'CONFLICT';
    });
  }

  async read(scope: InputSnapshotScope, inputVersion: number): Promise<SafetyFusionInputSnapshot | null> {
    validateScope(scope);
    if (!positive(inputVersion)) throw new TypeError('inputVersion must be a positive integer');
    const row = await this.pool.query(POSTGRES_INPUT_SNAPSHOT_SQL.readExact, [scope.tenantId, scope.purpose, scope.caseId, inputVersion]);
    return row.rows[0] === undefined ? null : mapSnapshot(row.rows[0]);
  }

  private async readWith(connection: ContactSqlConnectionPort, scope: InputSnapshotScope, inputVersion: number) {
    const result = await connection.query(POSTGRES_INPUT_SNAPSHOT_SQL.readExact, [scope.tenantId, scope.purpose, scope.caseId, inputVersion]);
    return result.rows[0] === undefined ? null : mapSnapshot(result.rows[0]);
  }
}

function values(request: CaptureInputSnapshotRequest): readonly unknown[] {
  const value = request.snapshot;
  return [
    request.tenantId, request.purpose, request.caseId, value.inputVersion, value.policyVersion, value.capturedAt,
    value.case.revision, value.case.digest, value.severity.revision, value.severity.digest,
    value.contact?.revision ?? null, value.contact?.digest ?? null,
    value.evidence.revision, value.evidence.digest, value.indicators.revision, value.indicators.digest, value.snapshotDigest
  ];
}

function mapSnapshot(row: ContactSqlRow): SafetyFusionInputSnapshot {
  const contactRevision = nullableInteger(row.contact_revision, 'contact_revision');
  const contactDigest = nullableText(row.contact_digest, 'contact_digest');
  if ((contactRevision === null) !== (contactDigest === null)) throw new Error('invalid contact revision binding');
  return {
    policyVersion: exactText(row.policy_version, 'policy_version', 'ros-eye.input-snapshot.v1'),
    tenantId: text(row.tenant_id, 'tenant_id'), caseId: text(row.case_id, 'case_id'),
    inputVersion: integer(row.input_version, 'input_version'), capturedAt: timestamp(row.captured_at, 'captured_at'),
    case: { revision: integer(row.case_revision, 'case_revision'), digest: digest(row.case_digest, 'case_digest') },
    severity: { revision: integer(row.severity_revision, 'severity_revision'), digest: digest(row.severity_digest, 'severity_digest') },
    contact: contactRevision === null ? null : { revision: contactRevision, digest: digest(contactDigest, 'contact_digest') },
    evidence: { revision: integer(row.evidence_revision, 'evidence_revision'), digest: digest(row.evidence_digest, 'evidence_digest') },
    indicators: { revision: integer(row.indicator_revision, 'indicator_revision'), digest: digest(row.indicator_digest, 'indicator_digest') },
    snapshotDigest: digest(row.snapshot_digest, 'snapshot_digest')
  };
}

function sameSnapshot(left: SafetyFusionInputSnapshot, right: SafetyFusionInputSnapshot): boolean {
  return left.policyVersion === right.policyVersion && left.tenantId === right.tenantId && left.caseId === right.caseId &&
    left.inputVersion === right.inputVersion && left.capturedAt === right.capturedAt &&
    sameRevision(left.case, right.case) && sameRevision(left.severity, right.severity) &&
    sameNullableRevision(left.contact, right.contact) && sameRevision(left.evidence, right.evidence) &&
    sameRevision(left.indicators, right.indicators) && left.snapshotDigest === right.snapshotDigest;
}

function sameRevision(left: { readonly revision: number; readonly digest: string }, right: { readonly revision: number; readonly digest: string }): boolean {
  return left.revision === right.revision && left.digest === right.digest;
}
function sameNullableRevision(
  left: { readonly revision: number; readonly digest: string } | null,
  right: { readonly revision: number; readonly digest: string } | null
): boolean { return left === null || right === null ? left === right : sameRevision(left, right); }

function validateRequest(request: CaptureInputSnapshotRequest): void {
  validateScope(request);
  if (!Number.isSafeInteger(request.expectedPreviousInputVersion) || request.expectedPreviousInputVersion < 0) {
    throw new TypeError('expectedPreviousInputVersion must be a non-negative integer');
  }
  if (request.snapshot.tenantId !== request.tenantId || request.snapshot.caseId !== request.caseId) {
    throw new TypeError('snapshot scope must match trusted repository scope');
  }
  const snapshot = request.snapshot;
  if (snapshot.policyVersion !== 'ros-eye.input-snapshot.v1' || !positive(snapshot.inputVersion) ||
      !validTimestamp(snapshot.capturedAt) || !validRevision(snapshot.case) || !validRevision(snapshot.severity) ||
      (snapshot.contact !== null && !validRevision(snapshot.contact)) || !validRevision(snapshot.evidence) ||
      !validRevision(snapshot.indicators) || !validDigest(snapshot.snapshotDigest)) {
    throw new TypeError('snapshot receipt is invalid');
  }
}

function validateScope(scope: InputSnapshotScope): void {
  for (const [name, value] of [['tenantId', scope.tenantId], ['purpose', scope.purpose]] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${name} is invalid`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.caseId)) {
    throw new TypeError('caseId must be a UUID');
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`);
  return value;
}
function exactText<T extends string>(value: unknown, field: string, expected: T): T {
  if (value !== expected) throw new Error(`invalid ${field}`);
  return expected;
}
function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`invalid ${field}`);
  return value;
}
function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!positive(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}
function nullableInteger(value: unknown, field: string): number | null { return value === null ? null : integer(value, field); }
function nullableText(value: unknown, field: string): string | null { return value === null ? null : text(value, field); }
function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${field}`);
  return parsed.toISOString();
}
function validRevision(value: { readonly revision: number; readonly digest: string }): boolean {
  return typeof value === 'object' && value !== null && positive(value.revision) && validDigest(value.digest);
}
function validDigest(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validTimestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
