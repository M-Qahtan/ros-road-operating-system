import {
  HUMAN_SAFETY_ROLE_AUTHORITIES,
  type HumanSafetyActorRole
} from '@ros/contracts';
import type { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
import {
  indicatorRevisionDigest,
  parseRecordedIndicator,
  parseRecordedIndicators,
  type IndicatorRevisionScope,
  type RecordedSafetyIndicator
} from './human-safety-indicator-revision.js';

const ACCESS_SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HUMAN_ROLES = new Set<HumanSafetyActorRole>(['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD']);

export interface RecordSafetyIndicatorInput extends IndicatorRevisionScope {
  readonly expectedRevision: number;
  readonly indicator: RecordedSafetyIndicator;
  readonly recordedBy: string;
  readonly recordedByRole: HumanSafetyActorRole;
  readonly traceId: string;
  readonly recordedAt: string;
}

export type RecordSafetyIndicatorDisposition =
  | { readonly status: 'RECORDED'; readonly revision: number; readonly digest: string }
  | { readonly status: 'CONFLICT' };

interface IndicatorLedgerRow {
  readonly revision: number | string;
  readonly indicator_set: unknown;
  readonly digest: string;
}

/** Records already-authorized structured observations; it never collects or actuates. */
export class PostgresHumanSafetyIndicatorLedger {
  constructor(private readonly pool: PostgresPool) {}

  async record(input: RecordSafetyIndicatorInput): Promise<RecordSafetyIndicatorDisposition> {
    validateInput(input);
    const normalized = parseRecordedIndicator(input.indicator);
    if (Date.parse(normalized.observedAt) > Date.parse(input.recordedAt)) {
      throw new Error('indicator observation cannot occur after its recording time');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE');
      const parent = await client.query<{ case_id: string; status: string }>(`SELECT id::text AS case_id, status::text FROM road_events
        WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid FOR UPDATE`,
      [input.tenantId, input.purpose, input.caseId]);
      if (parent.rowCount !== 1 || parent.rows.length !== 1) throw new Error('Indicator parent scope is unavailable or ambiguous');
      if (parent.rows[0]?.status === 'CLOSED') {
        throw new Error('Structured indicators cannot be appended after incident closure');
      }

      const latest = await client.query<IndicatorLedgerRow>(`SELECT revision, indicator_set, digest
        FROM human_safety_indicator_revision_ledger
        WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
        ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [input.tenantId, input.purpose, input.caseId]);
      const receipt = latest.rows[0];
      let current: readonly RecordedSafetyIndicator[] = [];
      let revision = 0;
      if (receipt !== undefined) {
        if (latest.rowCount !== 1 || latest.rows.length !== 1) throw new Error('Indicator revision receipt is ambiguous');
        revision = positiveInteger(receipt.revision);
        current = parseRecordedIndicators(receipt.indicator_set);
        if (!/^[a-f0-9]{64}$/.test(receipt.digest) ||
            receipt.digest !== indicatorRevisionDigest(input, current)) {
          throw new Error('Indicator revision receipt does not match authoritative state');
        }
      } else if (latest.rowCount !== 0 || latest.rows.length !== 0) {
        throw new Error('Indicator revision receipt is ambiguous');
      }
      if (revision !== input.expectedRevision) {
        await client.query('ROLLBACK');
        return { status: 'CONFLICT' };
      }
      if (current.some((item) => item.indicatorId === normalized.indicatorId)) throw new Error('indicator id already exists');
      if (normalized.supersedesIndicatorId !== null) {
        const target = current.find((item) => item.indicatorId === normalized.supersedesIndicatorId);
        if (target === undefined || current.some((item) => item.supersedesIndicatorId === target.indicatorId)) {
          throw new Error('indicator correction target is unavailable or already superseded');
        }
        if (Date.parse(normalized.observedAt) < Date.parse(target.observedAt)) {
          throw new Error('indicator correction predates its target');
        }
      }
      const next = parseRecordedIndicators([...current, normalized]);
      const digest = indicatorRevisionDigest(input, next);
      const inserted = await client.query(`INSERT INTO human_safety_indicator_revision_ledger (
        tenant_id, purpose, case_id, revision, indicator_set, digest,
        recorded_by, recorded_by_role, trace_id, recorded_at
      ) VALUES ($1,$2,$3::uuid,$4,$5::jsonb,$6,$7::uuid,$8,$9::uuid,$10::timestamptz)`, [
        input.tenantId, input.purpose, input.caseId, revision + 1, JSON.stringify(next), digest,
        input.recordedBy, input.recordedByRole, input.traceId, input.recordedAt
      ]);
      if (inserted.rowCount !== 1) throw new Error('Indicator revision was not appended');
      await client.query('COMMIT');
      return Object.freeze({ status: 'RECORDED', revision: revision + 1, digest });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }
}

function validateInput(input: RecordSafetyIndicatorInput): void {
  if (!ACCESS_SCOPE.test(input.tenantId) || !ACCESS_SCOPE.test(input.purpose)) throw new TypeError('invalid Indicator access scope');
  for (const [field, value] of [['caseId', input.caseId], ['recordedBy', input.recordedBy], ['traceId', input.traceId]] as const) {
    if (!UUID.test(value)) throw new TypeError(`${field} must be a UUID`);
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new TypeError('expectedRevision is invalid');
  if (!HUMAN_ROLES.has(input.recordedByRole) ||
      !HUMAN_SAFETY_ROLE_AUTHORITIES[input.recordedByRole].includes('RECORD_STRUCTURED_INDICATOR')) {
    throw new Error('human authority to record structured indicator is required');
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt) || !Number.isFinite(Date.parse(input.recordedAt))) {
    throw new TypeError('recordedAt is invalid');
  }
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('invalid Indicator revision');
  return parsed;
}
