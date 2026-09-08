import type { ContactSqlConnectionPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import type {
  AuthoritativeRevisionReceipt,
  AuthoritativeRevisionSourcePort
} from './input-snapshot-capture.js';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';

export type RoadEventRevisionComponent = 'CASE' | 'SEVERITY';

interface RevisionLedgerRow extends ContactSqlRow {
  readonly revision: number | string;
  readonly digest: string;
}

export const POSTGRES_ROAD_EVENT_REVISION_SOURCE_SQL = `SELECT revision, digest
  FROM road_event_revision_ledger
  WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid AND component = $4
  ORDER BY revision DESC
  LIMIT 1
  FOR SHARE`;

/** Read-only bridge from the RoadEvent-owned ledger into ROS Brain capture. */
export class PostgresRoadEventRevisionSource implements AuthoritativeRevisionSourcePort {
  constructor(private readonly component: RoadEventRevisionComponent) {
    if (component !== 'CASE' && component !== 'SEVERITY') throw new TypeError('unsupported RoadEvent revision component');
  }

  async load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeRevisionReceipt | null> {
    validateScope(scope);
    const result = await connection.query<RevisionLedgerRow>(POSTGRES_ROAD_EVENT_REVISION_SOURCE_SQL, [
      scope.tenantId, scope.purpose, scope.caseId, this.component
    ]);
    if (result.rows[0] === undefined) return null;
    if (result.rowCount !== 1 || result.rows.length !== 1) throw new Error('ambiguous RoadEvent revision receipt');
    const revision = integer(result.rows[0].revision);
    const digest = result.rows[0].digest;
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid RoadEvent revision digest');
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

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid RoadEvent revision');
  return parsed;
}
