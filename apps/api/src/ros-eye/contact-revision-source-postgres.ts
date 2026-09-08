import type { AuthoritativeContactReceipt, AuthoritativeContactSourcePort } from './input-snapshot-capture.js';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';
import {
  CONTACT_SESSION_COLUMNS,
  mapContactSessionRow,
  type ContactSqlConnectionPort,
  type ContactSqlRow
} from './contact-orchestration-postgres.js';
import { contactRevisionDigest } from './contact-revision.js';

interface ContactRevisionRow extends ContactSqlRow {
  readonly revision: number | string;
  readonly status: string;
  readonly digest: string;
}

/** Read-only Contact-owned source. It neither opens a session nor sends a message. */
export class PostgresContactRevisionSource implements AuthoritativeContactSourcePort {
  async load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeContactReceipt | null> {
    validateScope(scope);
    const parent = await connection.query(`SELECT id::text AS case_id
      FROM road_events
      WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid
      FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (parent.rowCount === 0 && parent.rows.length === 0) return null;
    if (parent.rowCount !== 1 || parent.rows.length !== 1 || parent.rows[0]?.case_id !== scope.caseId.toLowerCase()) {
      throw new Error('ambiguous Contact parent scope');
    }
    const sessions = await connection.query(`SELECT ${CONTACT_SESSION_COLUMNS}
      FROM ros_eye_contact_sessions
      WHERE tenant_id=$1 AND case_id=$2
      ORDER BY session_id`, [scope.tenantId, scope.caseId]);
    const ledger = await connection.query<ContactRevisionRow>(`SELECT revision, status, digest
      FROM ros_eye_contact_revision_ledger
      WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
      ORDER BY revision DESC LIMIT 1
      FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (sessions.rows.length === 0) {
      if (ledger.rows.length !== 0 || ledger.rowCount !== 0) throw new Error('Contact ledger exists without authoritative session state');
      return Object.freeze({ status: 'ABSENT' });
    }
    if (ledger.rowCount !== 1 || ledger.rows.length !== 1 || ledger.rows[0] === undefined) return null;
    const receipt = ledger.rows[0];
    if (receipt.status !== 'PRESENT') throw new Error('invalid Contact revision status');
    const revision = positiveInteger(receipt.revision);
    if (!/^[a-f0-9]{64}$/.test(receipt.digest)) throw new Error('invalid Contact revision digest');
    const digest = contactRevisionDigest(scope, sessions.rows.map(mapContactSessionRow));
    if (receipt.digest !== digest) throw new Error('Contact revision receipt does not match authoritative sessions');
    return Object.freeze({
      status: 'PRESENT',
      binding: Object.freeze({ authority: 'SOURCE_LEDGER', revision, digest })
    });
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
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid Contact revision');
  return parsed;
}
