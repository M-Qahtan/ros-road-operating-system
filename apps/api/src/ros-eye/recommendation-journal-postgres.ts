import {
  SAFETY_FUSION_POLICY_VERSION,
  SAFETY_FUSION_REGISTRY_SCHEMA_VERSION,
  assessRecommendationSnapshotBinding,
  type RecommendationSnapshotBinding,
  type SafetyFusionRecommendation,
  type SafetyFusionRegistryPort,
  type SafetyFusionRuleSetRegistryEntry
} from '@ros/contracts';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import { PostgresInputSnapshotRepository, type InputSnapshotScope } from './input-snapshot-postgres.js';

export type RecommendationJournalDisposition = 'CREATED' | 'IDEMPOTENT' | 'CONFLICT' | 'REJECTED';
export type RecommendationJournalReason = 'STORED' | 'EXACT_REPLAY' | 'DUPLICATE_INPUT' | 'SNAPSHOT_NOT_FOUND' |
  'BINDING_INVALID' | 'GOVERNANCE_INVALID' | 'RECOMMENDATION_INVALID';
export interface RecommendationJournalResult {
  readonly disposition: RecommendationJournalDisposition;
  readonly reason: RecommendationJournalReason;
}
export interface AppendRecommendationRequest extends InputSnapshotScope {
  readonly recommendation: SafetyFusionRecommendation;
  readonly binding: RecommendationSnapshotBinding;
}

interface JournalRow extends ContactSqlRow {
  readonly deterministic_fingerprint: string;
  readonly source_snapshot_digest: string;
  readonly recommendation: unknown;
  readonly binding: unknown;
}

export const POSTGRES_RECOMMENDATION_JOURNAL_SQL = Object.freeze({
  readExact: `SELECT deterministic_fingerprint, source_snapshot_digest, recommendation, binding
    FROM ros_eye_safety_fusion_recommendation_journal
    WHERE tenant_id = $1 AND purpose = $2 AND case_id = $3::uuid AND input_version = $4`,
  insert: `INSERT INTO ros_eye_safety_fusion_recommendation_journal (
      tenant_id, purpose, case_id, input_version, source_snapshot_digest,
      snapshot_policy_version, bound_at, evaluated_at, deterministic_fingerprint,
      authority, mode, activation_authorized, human_review_status,
      rule_set_version, threshold_version, recommendation, binding
    ) VALUES (
      $1, $2, $3::uuid, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9,
      'RECOMMENDATION_ONLY', 'SHADOW_ONLY', false, 'PENDING', $10, $11, $12::jsonb, $13::jsonb
    ) ON CONFLICT DO NOTHING`
});

export class PostgresRecommendationJournal {
  private readonly snapshots: PostgresInputSnapshotRepository;

  constructor(
    private readonly pool: ContactSqlPoolPort,
    private readonly registry: SafetyFusionRegistryPort
  ) {
    this.snapshots = new PostgresInputSnapshotRepository(pool);
  }

  async append(request: AppendRecommendationRequest): Promise<RecommendationJournalResult> {
    return this.pool.transaction((connection) => this.appendWithin(connection, request));
  }

  /** Used by the controlled evaluation use case so snapshot load and append share one transaction. */
  async appendWithin(connection: ContactSqlConnectionPort, request: AppendRecommendationRequest): Promise<RecommendationJournalResult> {
    if (!validRecommendation(request)) return result('REJECTED', 'RECOMMENDATION_INVALID');
    const registry = await this.registry.findRuleSet(request.recommendation.ruleSetVersion).catch(() => null);
    if (!validRegistry(registry, request.recommendation)) return result('REJECTED', 'GOVERNANCE_INVALID');

    const snapshot = await this.snapshots.readWithin(connection, request, request.recommendation.inputVersion);
    if (snapshot === null) return result('REJECTED', 'SNAPSHOT_NOT_FOUND');
    const current = {
      tenantId: snapshot.tenantId, caseId: snapshot.caseId, case: snapshot.case, severity: snapshot.severity,
      contact: snapshot.contact, evidence: snapshot.evidence, indicators: snapshot.indicators
    };
    const assessment = assessRecommendationSnapshotBinding(request.recommendation, snapshot, request.binding, current);
    if (assessment.status !== 'VERIFIED') return result('REJECTED', 'BINDING_INVALID');

    const existing = await readExact(connection, request);
    if (existing !== null) return sameEntry(existing, request) ? result('IDEMPOTENT', 'EXACT_REPLAY') : result('CONFLICT', 'DUPLICATE_INPUT');

    const inserted = await connection.query(POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert, values(request));
    if (inserted.rowCount === 1) return result('CREATED', 'STORED');
    const winner = await readExact(connection, request);
    return winner !== null && sameEntry(winner, request)
      ? result('IDEMPOTENT', 'EXACT_REPLAY')
      : result('CONFLICT', 'DUPLICATE_INPUT');
  }
}

async function readExact(connection: ContactSqlConnectionPort, request: AppendRecommendationRequest): Promise<JournalRow | null> {
  const found = await connection.query<JournalRow>(POSTGRES_RECOMMENDATION_JOURNAL_SQL.readExact,
    [request.tenantId, request.purpose, request.caseId, request.recommendation.inputVersion]);
  return found.rows[0] ?? null;
}

function values(request: AppendRecommendationRequest): readonly unknown[] {
  const recommendation = request.recommendation;
  return [
    request.tenantId, request.purpose, request.caseId, recommendation.inputVersion,
    request.binding.sourceSnapshotDigest, request.binding.policyVersion, request.binding.boundAt,
    recommendation.evaluatedAt, recommendation.deterministicFingerprint, recommendation.ruleSetVersion,
    recommendation.thresholdVersion, JSON.stringify(recommendation), JSON.stringify(request.binding)
  ];
}

function validRecommendation(request: AppendRecommendationRequest): boolean {
  const value = request.recommendation as unknown as Record<string, unknown>;
  if (!exactKeys(value, RECOMMENDATION_KEYS) || request.recommendation.tenantId !== request.tenantId ||
      request.recommendation.caseId !== request.caseId || request.recommendation.policyVersion !== SAFETY_FUSION_POLICY_VERSION ||
      request.recommendation.authority !== 'RECOMMENDATION_ONLY' || request.recommendation.requiresHumanReview !== true ||
      request.recommendation.autonomousDowngradePermitted !== false || request.recommendation.autonomousClosurePermitted !== false ||
      request.recommendation.autonomousDispatchPermitted !== false ||
      !/^sha256:[a-f0-9]{64}$/.test(request.recommendation.deterministicFingerprint)) return false;
  return Array.isArray(request.recommendation.contributions) && request.recommendation.contributions.every((item) => exactKeys(item as unknown as Record<string, unknown>, CONTRIBUTION_KEYS)) &&
    Array.isArray(request.recommendation.guardResults) && request.recommendation.guardResults.every((item) => exactKeys(item as unknown as Record<string, unknown>, GUARD_KEYS));
}

function validRegistry(entry: SafetyFusionRuleSetRegistryEntry | null, recommendation: SafetyFusionRecommendation): boolean {
  return entry !== null && entry.schemaVersion === SAFETY_FUSION_REGISTRY_SCHEMA_VERSION && entry.status === 'ACTIVE' &&
    entry.ruleSetVersion === recommendation.ruleSetVersion && entry.thresholdVersion === recommendation.thresholdVersion &&
    entry.protectedAttributePolicy === 'PROHIBITED' && entry.rollbackRuleSetVersion !== null &&
    /^sha256:[a-f0-9]{64}$/.test(entry.regressionEvidenceDigest);
}

function sameEntry(row: JournalRow, request: AppendRecommendationRequest): boolean {
  return row.deterministic_fingerprint === request.recommendation.deterministicFingerprint &&
    row.source_snapshot_digest === request.binding.sourceSnapshotDigest &&
    stableStringify(json(row.recommendation)) === stableStringify(request.recommendation) &&
    stableStringify(json(row.binding)) === stableStringify(request.binding);
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
function result(disposition: RecommendationJournalDisposition, reason: RecommendationJournalReason): RecommendationJournalResult {
  return Object.freeze({ disposition, reason });
}

const RECOMMENDATION_KEYS = new Set(['tenantId','caseId','inputVersion','evaluatedAt','recommendedSeverity','currentSeverity','score','confidence','uncertainty','reasonCodes','missingEvidenceFlags','contributions','guardResults','requiresHumanReview','authority','autonomousDowngradePermitted','autonomousClosurePermitted','autonomousDispatchPermitted','policyVersion','ruleSetVersion','thresholdVersion','deterministicFingerprint']);
const CONTRIBUTION_KEYS = new Set(['evidenceId','sourceType','code','signedContribution','freshnessFactor','reliabilityFactor','integrityFactor','deviceConditionFactor']);
const GUARD_KEYS = new Set(['kind','disposition','reasonCode','guardVersion','evaluatedInputVersion']);
