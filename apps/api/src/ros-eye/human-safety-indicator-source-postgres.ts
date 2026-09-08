import type { AuthoritativeRevisionReceipt, AuthoritativeRevisionSourcePort } from './input-snapshot-capture.js';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';
import type { ContactSqlConnectionPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import { indicatorRevisionDigest, parseRecordedIndicators } from './human-safety-indicator-revision.js';

interface IndicatorLedgerRow extends ContactSqlRow {
  readonly revision: number | string;
  readonly indicator_set: unknown;
  readonly digest: string;
}

/** Read-only Human Safety source; it cannot record observations or change case severity/state. */
export class PostgresHumanSafetyIndicatorSource implements AuthoritativeRevisionSourcePort {
  async load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeRevisionReceipt | null> {
    validateScope(scope);
    const parent = await connection.query(`SELECT id::text AS case_id FROM road_events
      WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (parent.rowCount === 0 && parent.rows.length === 0) return null;
    if (parent.rowCount !== 1 || parent.rows.length !== 1 || parent.rows[0]?.case_id !== scope.caseId.toLowerCase()) {
      throw new Error('ambiguous Indicator parent scope');
    }
    const latest = await connection.query<IndicatorLedgerRow>(`SELECT revision, indicator_set, digest
      FROM human_safety_indicator_revision_ledger
      WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
      ORDER BY revision DESC LIMIT 1 FOR SHARE`, [scope.tenantId, scope.purpose, scope.caseId]);
    if (latest.rowCount === 0 && latest.rows.length === 0) return null;
    if (latest.rowCount !== 1 || latest.rows.length !== 1 || latest.rows[0] === undefined) {
      throw new Error('ambiguous Indicator revision receipt');
    }
    const receipt = latest.rows[0];
    const revision = positiveInteger(receipt.revision);
    const indicators = parseRecordedIndicators(receipt.indicator_set);
    if (!/^[a-f0-9]{64}$/.test(receipt.digest)) throw new Error('invalid Indicator revision digest');
    const digest = indicatorRevisionDigest(scope, indicators);
    if (receipt.digest !== digest) throw new Error('Indicator revision receipt does not match authoritative state');
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
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid Indicator revision');
  return parsed;
}
