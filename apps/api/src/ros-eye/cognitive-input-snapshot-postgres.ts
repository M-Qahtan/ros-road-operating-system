import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY,
  type CognitiveRoadStateInputBinding
} from './cognitive-road-state-snapshot-adapter.js';
import type { InputSnapshotCaptureDisposition, InputSnapshotScope } from './input-snapshot-postgres.js';

export const COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION = 'ros-eye.input-snapshot.v2' as const;

export interface CognitiveInputSnapshotReceipt extends InputSnapshotScope {
  readonly policyVersion: typeof COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION;
  readonly inputVersion: number;
  readonly baseSnapshotDigest: string;
  readonly capturedAt: string;
  readonly cognitive: CognitiveRoadStateInputBinding;
}

export interface CaptureCognitiveInputSnapshotRequest extends InputSnapshotScope {
  readonly inputVersion: number;
  readonly baseSnapshotDigest: string;
  readonly binding: CognitiveRoadStateInputBinding;
}

export const POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL = Object.freeze({
  readBase: `SELECT 1 AS present
    FROM ros_eye_safety_fusion_input_snapshots
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid
      AND input_version = $4 AND snapshot_digest = $5
      AND captured_at = $6::timestamptz
      AND policy_version = 'ros-eye.input-snapshot.v1'
    FOR SHARE`,
  readExact: `SELECT tenant_id, purpose, case_id, input_version, policy_version,
      base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
      cognitive_revision, cognitive_digest, cognitive_state_time,
      cognitive_valid_until, cognitive_requires_abstention
    FROM ros_eye_cognitive_input_snapshot_bindings
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid AND input_version = $4`,
  readLatest: `SELECT tenant_id, purpose, case_id, input_version, policy_version,
      base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
      cognitive_revision, cognitive_digest, cognitive_state_time,
      cognitive_valid_until, cognitive_requires_abstention
    FROM ros_eye_cognitive_input_snapshot_bindings
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid
    ORDER BY input_version DESC LIMIT 1`,
  insert: `INSERT INTO ros_eye_cognitive_input_snapshot_bindings (
      tenant_id, purpose, case_id, input_version, policy_version,
      base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
      cognitive_revision, cognitive_digest, cognitive_state_time,
      cognitive_valid_until, cognitive_requires_abstention
    ) VALUES (
      $1, $2, $3::uuid, $4, $5, $6, $7::timestamptz, $8, $9,
      $10, $11, $12::timestamptz, $13::timestamptz, $14
    ) ON CONFLICT DO NOTHING`
});

/** Persists only the required v2 extension; the owner state itself remains outside ROS Brain ownership. */
export class PostgresCognitiveInputSnapshotRepository {
  constructor(private readonly pool: ContactSqlPoolPort) {}

  async capture(request: CaptureCognitiveInputSnapshotRequest): Promise<InputSnapshotCaptureDisposition> {
    validateRequest(request);
    return this.pool.transaction((connection) => this.captureWithin(connection, request));
  }

  /** Call in the same transaction that appends the v1 base to obtain one atomic v2 capture. */
  async captureWithin(
    connection: ContactSqlConnectionPort,
    request: CaptureCognitiveInputSnapshotRequest
  ): Promise<InputSnapshotCaptureDisposition> {
    validateRequest(request);
    const scopeValues = [request.tenantId, request.purpose, request.caseId, request.inputVersion] as const;
    const exact = await this.readWith(connection, scopeValues);
    if (exact !== null) return sameReceipt(exact, request) ? 'IDEMPOTENT' : 'CONFLICT';

    const base = await connection.query(POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readBase, [
      ...scopeValues, request.baseSnapshotDigest, request.binding.capturedAt
    ]);
    if (base.rowCount !== 1) return 'NOT_FOUND';

    const inserted = await connection.query(POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert, values(request));
    if (inserted.rowCount === 1) return 'CREATED';
    const winner = await this.readWith(connection, scopeValues);
    return winner !== null && sameReceipt(winner, request) ? 'IDEMPOTENT' : 'CONFLICT';
  }

  async read(scope: InputSnapshotScope, inputVersion: number): Promise<CognitiveInputSnapshotReceipt | null> {
    validateScope(scope);
    if (!positive(inputVersion)) throw new TypeError('inputVersion must be a positive integer');
    return this.readWith(this.pool, [scope.tenantId, scope.purpose, scope.caseId, inputVersion]);
  }

  async readWithin(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope,
    inputVersion: number
  ): Promise<CognitiveInputSnapshotReceipt | null> {
    validateScope(scope);
    if (!positive(inputVersion)) throw new TypeError('inputVersion must be a positive integer');
    return this.readWith(connection, [scope.tenantId, scope.purpose, scope.caseId, inputVersion]);
  }

  async readLatestWithin(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope
  ): Promise<CognitiveInputSnapshotReceipt | null> {
    validateScope(scope);
    const result = await connection.query(POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readLatest,
      [scope.tenantId, scope.purpose, scope.caseId]);
    return result.rows[0] === undefined ? null : mapReceipt(result.rows[0]);
  }

  private async readWith(
    connection: ContactSqlConnectionPort,
    values: readonly [string, string, string, number]
  ): Promise<CognitiveInputSnapshotReceipt | null> {
    const result = await connection.query(POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readExact, values);
    return result.rows[0] === undefined ? null : mapReceipt(result.rows[0]);
  }
}

function values(request: CaptureCognitiveInputSnapshotRequest): readonly unknown[] {
  const binding = request.binding;
  return [
    request.tenantId, request.purpose, request.caseId, request.inputVersion,
    COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION, request.baseSnapshotDigest, binding.capturedAt,
    binding.policyVersion, binding.authority, binding.revision, binding.digest,
    binding.stateTime, binding.validUntil, binding.requiresAbstention
  ];
}

function mapReceipt(row: ContactSqlRow): CognitiveInputSnapshotReceipt {
  const scope = {
    tenantId: text(row.tenant_id, 'tenant_id'),
    purpose: text(row.purpose, 'purpose'),
    caseId: text(row.case_id, 'case_id')
  };
  const capturedAt = timestamp(row.captured_at, 'captured_at');
  return {
    ...scope,
    policyVersion: exact(row.policy_version, 'policy_version', COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION),
    inputVersion: integer(row.input_version, 'input_version'),
    baseSnapshotDigest: digest(row.base_snapshot_digest, 'base_snapshot_digest'),
    capturedAt,
    cognitive: {
      ...scope,
      policyVersion: exact(row.binding_policy_version, 'binding_policy_version', COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY),
      capturedAt,
      revision: integer(row.cognitive_revision, 'cognitive_revision'),
      digest: digest(row.cognitive_digest, 'cognitive_digest'),
      stateTime: timestamp(row.cognitive_state_time, 'cognitive_state_time'),
      validUntil: timestamp(row.cognitive_valid_until, 'cognitive_valid_until'),
      requiresAbstention: boolean(row.cognitive_requires_abstention, 'cognitive_requires_abstention'),
      authority: exact(row.cognitive_authority, 'cognitive_authority', 'SOURCE_LEDGER')
    }
  };
}

function validateRequest(request: CaptureCognitiveInputSnapshotRequest): void {
  validateScope(request);
  if (!positive(request.inputVersion)) throw new TypeError('inputVersion must be a positive integer');
  if (!validDigest(request.baseSnapshotDigest)) throw new TypeError('baseSnapshotDigest is invalid');
  const binding = request.binding;
  if (binding.tenantId !== request.tenantId || binding.purpose !== request.purpose || binding.caseId !== request.caseId) {
    throw new TypeError('cognitive binding scope must match trusted repository scope');
  }
  const capturedAt = parsedTimestamp(binding.capturedAt, 'capturedAt');
  const stateTime = parsedTimestamp(binding.stateTime, 'stateTime');
  const validUntil = parsedTimestamp(binding.validUntil, 'validUntil');
  if (binding.policyVersion !== COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY || binding.authority !== 'SOURCE_LEDGER' ||
      !positive(binding.revision) || !validDigest(binding.digest) || typeof binding.requiresAbstention !== 'boolean' ||
      stateTime > capturedAt || capturedAt > validUntil || stateTime >= validUntil) {
    throw new TypeError('cognitive binding is invalid');
  }
}

function sameReceipt(receipt: CognitiveInputSnapshotReceipt, request: CaptureCognitiveInputSnapshotRequest): boolean {
  const binding = request.binding;
  return receipt.tenantId === request.tenantId && receipt.purpose === request.purpose && receipt.caseId === request.caseId &&
    receipt.inputVersion === request.inputVersion && receipt.baseSnapshotDigest === request.baseSnapshotDigest &&
    receipt.capturedAt === timestamp(binding.capturedAt, 'capturedAt') &&
    receipt.cognitive.policyVersion === binding.policyVersion && receipt.cognitive.revision === binding.revision &&
    receipt.cognitive.digest === binding.digest && receipt.cognitive.stateTime === timestamp(binding.stateTime, 'stateTime') &&
    receipt.cognitive.validUntil === timestamp(binding.validUntil, 'validUntil') &&
    receipt.cognitive.requiresAbstention === binding.requiresAbstention && receipt.cognitive.authority === binding.authority;
}

function validateScope(scope: InputSnapshotScope): void {
  for (const [field, value] of [['tenantId', scope.tenantId], ['purpose', scope.purpose]] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.caseId)) {
    throw new TypeError('caseId must be a UUID');
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`);
  return value;
}
function exact<T extends string>(value: unknown, field: string, expected: T): T {
  if (value !== expected) throw new Error(`invalid ${field}`);
  return expected;
}
function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!positive(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}
function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !validDigest(value)) throw new Error(`invalid ${field}`);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`invalid ${field}`);
  return value;
}
function timestamp(value: unknown, field: string): string {
  return new Date(parsedTimestamp(value, field)).toISOString();
}
function parsedTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'string' && !(value instanceof Date)) throw new Error(`${field} is invalid`);
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} is invalid`);
  return parsed;
}
function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
