import type { AuthoritativeRevisionReceipt, AuthoritativeRevisionSourcePort } from '../ros-eye/input-snapshot-capture.js';
import type { InputSnapshotScope } from '../ros-eye/input-snapshot-postgres.js';
import type { ContactSqlConnectionPort, ContactSqlRow } from '../ros-eye/contact-orchestration-postgres.js';
import { EVIDENCE_SELECT_COLUMNS, mapEvidenceRow, type EvidenceRow } from './postgres-evidence-repository.js';
import { evidenceRevisionDigest } from './evidence-revision.js';

interface EvidenceRevisionRow extends ContactSqlRow {
  readonly revision: number | string;
  readonly digest: string;
}

/** Read-only Evidence-owned source. It cannot upload, download, scan, or mutate evidence. */
export class PostgresEvidenceRevisionSource implements AuthoritativeRevisionSourcePort {
  async load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeRevisionReceipt | null> {
    validateScope(scope);
    const parent = await connection.query(`SELECT id::text AS case_id
      FROM road_events
      WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid
      FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (parent.rowCount === 0 && parent.rows.length === 0) return null;
    if (parent.rowCount !== 1 || parent.rows.length !== 1 || parent.rows[0]?.case_id !== scope.caseId.toLowerCase()) {
      throw new Error('ambiguous Evidence parent scope');
    }
    const evidence = await connection.query<EvidenceRow>(`SELECT ${EVIDENCE_SELECT_COLUMNS}
      FROM evidence_objects
      WHERE road_event_id=$1::uuid
      ORDER BY id`, [scope.caseId]);
    const ledger = await connection.query<EvidenceRevisionRow>(`SELECT revision, digest
      FROM evidence_revision_ledger
      WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
      ORDER BY revision DESC LIMIT 1
      FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (evidence.rows.length === 0) {
      if (ledger.rows.length !== 0 || ledger.rowCount !== 0) throw new Error('Evidence ledger exists without authoritative evidence state');
      return null;
    }
    if (ledger.rowCount !== 1 || ledger.rows.length !== 1 || ledger.rows[0] === undefined) return null;
    const receipt = ledger.rows[0];
    const revision = positiveInteger(receipt.revision);
    if (!/^[a-f0-9]{64}$/.test(receipt.digest)) throw new Error('invalid Evidence revision digest');
    const digest = evidenceRevisionDigest(scope, evidence.rows.map(mapEvidenceRow));
    if (receipt.digest !== digest) throw new Error('Evidence revision receipt does not match authoritative evidence');
    return Object.freeze({ authority: 'SOURCE_LEDGER', revision, digest });
  }
}

function validateScope(scope: InputSnapshotScope): void {
  for (const [field, value] of [['tenantId', scope.tenantId], ['purpose', scope.purpose]] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.caseId)) {
    throw new TypeError('caseId must be a UUID');
  }
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid Evidence revision');
  return parsed;
}
