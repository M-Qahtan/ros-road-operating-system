import {
  assessRecommendationSnapshotBinding,
  type CurrentInputRevisions,
  type RecommendationSnapshotBinding,
  type SafetyFusionRecommendation,
  type SnapshotBindingAssessment
} from '@ros/contracts';
import type { AuthenticatedActor } from '../application/ports.js';
import { PostgresEvidenceRevisionSource } from '../evidence/evidence-revision-source-postgres.js';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import { PostgresContactRevisionSource } from './contact-revision-source-postgres.js';
import { PostgresHumanSafetyIndicatorSource } from './human-safety-indicator-source-postgres.js';
import type { AuthoritativeInputSnapshotSources, AuthoritativeRevisionReceipt } from './input-snapshot-capture.js';
import { PostgresInputSnapshotRepository, type InputSnapshotScope } from './input-snapshot-postgres.js';
import { isValidRecommendationJournalEntry } from './recommendation-journal-postgres.js';
import { PostgresRoadEventRevisionSource } from './road-event-revision-source-postgres.js';

interface RecommendationQueryRow extends ContactSqlRow {
  readonly input_version: number | string;
  readonly deterministic_fingerprint: string;
  readonly source_snapshot_digest: string;
  readonly authority: string;
  readonly mode: string;
  readonly activation_authorized: boolean;
  readonly human_review_status: string;
  readonly recommendation: unknown;
  readonly binding: unknown;
}

export const GOVERNED_RECOMMENDATION_QUERY_TRANSACTION_SQL =
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY' as const;
export const POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL = Object.freeze({
  authorizeCase: `SELECT id::text AS case_id FROM road_events
    WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid`,
  latest: `SELECT input_version, deterministic_fingerprint, source_snapshot_digest,
      authority, mode, activation_authorized, human_review_status, recommendation, binding
    FROM ros_eye_safety_fusion_recommendation_journal
    WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
    ORDER BY input_version DESC LIMIT 1`
});

export type GovernedRecommendationQueryResult = Readonly<{
  status: 'AVAILABLE' | 'WITHHELD' | 'NOT_FOUND' | 'FORBIDDEN';
  snapshot: SnapshotBindingAssessment | null;
  recommendation: SafetyFusionRecommendation | null;
  humanReviewStatus: 'PENDING' | null;
  mode: 'SHADOW_ONLY' | null;
  activationAuthorized: false;
  sourceVersions: GovernedRecommendationSourceVersions | null;
}>;

export type GovernedRecommendationSourceVersions = Readonly<{
  inputVersion: number;
  sourceSnapshotDigest: string;
  caseRevision: number;
  severityRevision: number;
  contactRevision: number | null;
  evidenceRevision: number;
  indicatorRevision: number;
}>;

/**
 * Read-only case query. A historical row is never returned as a current
 * recommendation unless all module-owned receipts still match its snapshot.
 */
export class PostgresGovernedRecommendationQuery {
  private readonly snapshots: PostgresInputSnapshotRepository;

  constructor(
    private readonly pool: ContactSqlPoolPort,
    private readonly sources: AuthoritativeInputSnapshotSources
  ) { this.snapshots = new PostgresInputSnapshotRepository(pool); }

  async read(actor: AuthenticatedActor, caseId: string): Promise<GovernedRecommendationQueryResult> {
    if (!authorizedActor(actor) || !validCaseId(caseId)) return result('FORBIDDEN', null, null, null, null, null);
    const scope = { tenantId: actor.tenantId, purpose: actor.purpose, caseId };
    return this.pool.transaction(async (connection) => {
      await connection.query(GOVERNED_RECOMMENDATION_QUERY_TRANSACTION_SQL);
      const parent = await connection.query(POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.authorizeCase,
        [scope.tenantId, scope.purpose, scope.caseId]);
      if (parent.rowCount !== 1 || parent.rows.length !== 1 || parent.rows[0]?.case_id !== caseId.toLowerCase()) {
        return result('NOT_FOUND', null, null, null, null, null);
      }
      const latest = await connection.query<RecommendationQueryRow>(POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.latest,
        [scope.tenantId, scope.purpose, scope.caseId]);
      if (latest.rowCount === 0 && latest.rows.length === 0) return result('NOT_FOUND', null, null, null, null, null);
      if (latest.rowCount !== 1 || latest.rows.length !== 1) return withheld('INVALID_BINDING');
      const row = latest.rows[0]!;
      if (!fixedSafetyColumns(row)) return withheld('INVALID_BINDING');
      const recommendation = parseObject<SafetyFusionRecommendation>(row.recommendation);
      const binding = parseObject<RecommendationSnapshotBinding>(row.binding);
      const inputVersion = positiveInteger(row.input_version);
      if (recommendation === null || binding === null || inputVersion === null ||
          recommendation.inputVersion !== inputVersion || binding.inputVersion !== inputVersion ||
          recommendation.deterministicFingerprint !== row.deterministic_fingerprint ||
          binding.recommendationFingerprint !== row.deterministic_fingerprint ||
          binding.sourceSnapshotDigest !== row.source_snapshot_digest ||
          !isValidRecommendationJournalEntry({ ...scope, recommendation, binding })) return withheld('INVALID_BINDING', 'PENDING');

      const snapshot = await this.snapshots.readWithin(connection, scope, inputVersion);
      const current = await currentRevisions(connection, scope, this.sources);
      const assessment = assessRecommendationSnapshotBinding(recommendation, snapshot, binding, current);
      return assessment.status === 'VERIFIED'
        ? result('AVAILABLE', assessment, recommendation, 'PENDING', 'SHADOW_ONLY', sourceVersions(snapshot!))
        : result('WITHHELD', assessment, null, 'PENDING', 'SHADOW_ONLY', null);
    }).catch(() => withheld('MISSING_BINDING'));
  }
}

export function createPostgresGovernedRecommendationQuery(pool: ContactSqlPoolPort): PostgresGovernedRecommendationQuery {
  return new PostgresGovernedRecommendationQuery(pool, Object.freeze({
    case: new PostgresRoadEventRevisionSource('CASE'),
    severity: new PostgresRoadEventRevisionSource('SEVERITY'),
    contact: new PostgresContactRevisionSource(),
    evidence: new PostgresEvidenceRevisionSource(),
    indicators: new PostgresHumanSafetyIndicatorSource()
  }));
}

async function currentRevisions(
  connection: ContactSqlConnectionPort,
  scope: InputSnapshotScope,
  sources: AuthoritativeInputSnapshotSources
): Promise<CurrentInputRevisions | null> {
  const caseReceipt = await sources.case.load(connection, scope);
  if (!validReceipt(caseReceipt)) return null;
  const severity = await sources.severity.load(connection, scope);
  if (!validReceipt(severity)) return null;
  const contact = await sources.contact.load(connection, scope);
  if (contact === null || (contact.status === 'PRESENT' && !validReceipt(contact.binding))) return null;
  const evidence = await sources.evidence.load(connection, scope);
  if (!validReceipt(evidence)) return null;
  const indicators = await sources.indicators.load(connection, scope);
  if (!validReceipt(indicators)) return null;
  return Object.freeze({
    tenantId: scope.tenantId, caseId: scope.caseId,
    case: strip(caseReceipt), severity: strip(severity),
    contact: contact.status === 'ABSENT' ? null : strip(contact.binding),
    evidence: strip(evidence), indicators: strip(indicators)
  });
}

function authorizedActor(actor: AuthenticatedActor): boolean {
  return validScope(actor.tenantId) && validScope(actor.purpose) && validActorId(actor.actorId) &&
    actor.roles.some((role) => role === 'OPERATOR' || role === 'SUPERVISOR' || role === 'AUDITOR');
}
function fixedSafetyColumns(row: RecommendationQueryRow): boolean {
  return row.authority === 'RECOMMENDATION_ONLY' && row.mode === 'SHADOW_ONLY' &&
    row.activation_authorized === false && row.human_review_status === 'PENDING' &&
    /^sha256:[a-f0-9]{64}$/.test(row.deterministic_fingerprint) && /^[a-f0-9]{64}$/.test(row.source_snapshot_digest);
}
function parseObject<T>(value: unknown): T | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as T : null;
  } catch { return null; }
}
function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function validReceipt(value: AuthoritativeRevisionReceipt | null): value is AuthoritativeRevisionReceipt {
  return value !== null && value.authority === 'SOURCE_LEDGER' && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    /^[a-f0-9]{64}$/.test(value.digest);
}
function strip(value: AuthoritativeRevisionReceipt) { return Object.freeze({ revision: value.revision, digest: value.digest }); }
function validScope(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function validActorId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function validCaseId(value: string): boolean { return validActorId(value); }
function withheld(reason: SnapshotBindingAssessment['reason'], review: 'PENDING' | null = null): GovernedRecommendationQueryResult {
  return result('WITHHELD', Object.freeze({ status: 'UNVERIFIED', reason, sourceSnapshotDigest: null }), null, review, review === null ? null : 'SHADOW_ONLY', null);
}
function result(
  status: GovernedRecommendationQueryResult['status'], snapshot: SnapshotBindingAssessment | null,
  recommendation: SafetyFusionRecommendation | null, humanReviewStatus: 'PENDING' | null, mode: 'SHADOW_ONLY' | null,
  sourceVersions: GovernedRecommendationSourceVersions | null
): GovernedRecommendationQueryResult {
  return Object.freeze({ status, snapshot, recommendation, humanReviewStatus, mode, activationAuthorized: false, sourceVersions });
}

function sourceVersions(snapshot: NonNullable<Awaited<ReturnType<PostgresInputSnapshotRepository['read']>>>): GovernedRecommendationSourceVersions {
  return Object.freeze({
    inputVersion: snapshot.inputVersion,
    sourceSnapshotDigest: snapshot.snapshotDigest,
    caseRevision: snapshot.case.revision,
    severityRevision: snapshot.severity.revision,
    contactRevision: snapshot.contact?.revision ?? null,
    evidenceRevision: snapshot.evidence.revision,
    indicatorRevision: snapshot.indicators.revision
  });
}
