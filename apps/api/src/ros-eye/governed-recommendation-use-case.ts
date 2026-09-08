import {
  SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION,
  type SafetyFusionClockPort,
  type SafetyFusionInput,
  type SafetyFusionInputSnapshot,
  type SafetyFusionRecommendation
} from '@ros/contracts';
import type { ContactSqlConnectionPort, ContactSqlPoolPort } from './contact-orchestration-postgres.js';
import type { GovernedSafetyFusionOrchestrator } from './governed-safety-fusion.js';
import type { SafetyFusionEvidenceAuthorityPort } from './governed-safety-fusion.js';
import { PostgresInputSnapshotRepository, type InputSnapshotScope } from './input-snapshot-postgres.js';
import { PostgresRecommendationJournal, type RecommendationJournalResult } from './recommendation-journal-postgres.js';

export const GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION = 'ros-eye.governed-recommendation.authorization.v1' as const;
export const GOVERNED_RECOMMENDATION_TRANSACTION_SQL = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ WRITE' as const;

export interface GovernedRecommendationActor {
  readonly actorId: string;
}
export interface GovernedRecommendationAuthorizationReceipt extends InputSnapshotScope {
  readonly actorId: string;
  readonly permission: 'EVALUATE_AND_RECORD_RECOMMENDATION';
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly policyVersion: typeof GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export interface GovernedRecommendationAuthorizationPort {
  authorize(actor: GovernedRecommendationActor, scope: InputSnapshotScope): Promise<GovernedRecommendationAuthorizationReceipt | null>;
}
export interface AuthoritativeSafetyFusionInputReceipt {
  readonly authority: 'SOURCE_LEDGER';
  readonly sourceSnapshotDigest: string;
  readonly input: SafetyFusionInput;
  readonly evidenceAuthority: SafetyFusionEvidenceAuthorityPort;
}
export interface AuthoritativeSafetyFusionInputPort {
  load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope, snapshot: SafetyFusionInputSnapshot): Promise<AuthoritativeSafetyFusionInputReceipt | null>;
}
export interface EvaluateAndRecordRecommendationRequest extends InputSnapshotScope, GovernedRecommendationActor {
  readonly inputVersion: number;
}
export type GovernedRecommendationUseCaseReason = 'STORED' | 'EXACT_REPLAY' | 'DUPLICATE_INPUT' |
  'AUTHORIZATION_DENIED' | 'SNAPSHOT_NOT_FOUND' | 'SOURCE_UNAVAILABLE' | 'SOURCE_MISMATCH' |
  'EVALUATION_BLOCKED' | 'TRUSTED_TIME_UNAVAILABLE' | 'JOURNAL_REJECTED';
export interface GovernedRecommendationUseCaseResult {
  readonly status: 'RECORDED' | 'IDEMPOTENT' | 'CONFLICT' | 'REJECTED';
  readonly reason: GovernedRecommendationUseCaseReason;
  readonly recommendation: SafetyFusionRecommendation | null;
}

export class GovernedRecommendationUseCase {
  private readonly snapshots: PostgresInputSnapshotRepository;

  constructor(
    private readonly pool: ContactSqlPoolPort,
    private readonly authorization: GovernedRecommendationAuthorizationPort,
    private readonly input: AuthoritativeSafetyFusionInputPort,
    private readonly fusion: GovernedSafetyFusionOrchestrator,
    private readonly clock: SafetyFusionClockPort,
    private readonly journal: PostgresRecommendationJournal
  ) {
    this.snapshots = new PostgresInputSnapshotRepository(pool);
  }

  async execute(request: EvaluateAndRecordRecommendationRequest): Promise<GovernedRecommendationUseCaseResult> {
    const startedAt = await trustedTime(this.clock);
    if (startedAt === null) return output('REJECTED', 'TRUSTED_TIME_UNAVAILABLE', null);
    const receipt = await this.authorization.authorize({ actorId: request.actorId }, request).catch(() => null);
    if (!validAuthorization(receipt, request, startedAt)) return output('REJECTED', 'AUTHORIZATION_DENIED', null);

    return this.pool.transaction(async (connection) => {
      await connection.query(GOVERNED_RECOMMENDATION_TRANSACTION_SQL);
      const snapshot = await this.snapshots.readWithin(connection, request, request.inputVersion);
      if (snapshot === null) return output('REJECTED', 'SNAPSHOT_NOT_FOUND', null);
      const source = await this.input.load(connection, request, snapshot).catch(() => null);
      if (source === null || source.authority !== 'SOURCE_LEDGER') return output('REJECTED', 'SOURCE_UNAVAILABLE', null);
      if (!validSource(source, request, snapshot)) return output('REJECTED', 'SOURCE_MISMATCH', null);

      const recommendation = await this.fusion.recommend(source.input, source.evidenceAuthority);
      if (recommendation.guardResults.some((guard) => guard.disposition === 'BLOCK_AND_REVIEW')) {
        return output('REJECTED', 'EVALUATION_BLOCKED', recommendation);
      }
      const boundAt = await trustedTime(this.clock);
      if (boundAt === null || Date.parse(boundAt) < Date.parse(recommendation.evaluatedAt)) {
        return output('REJECTED', 'TRUSTED_TIME_UNAVAILABLE', recommendation);
      }
      if (!validAuthorization(receipt, request, boundAt)) return output('REJECTED', 'AUTHORIZATION_DENIED', recommendation);
      const journal = await this.journal.appendWithin(connection, {
        tenantId: request.tenantId, purpose: request.purpose, caseId: request.caseId,
        recommendation,
        binding: {
          policyVersion: SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION,
          inputVersion: snapshot.inputVersion,
          recommendationFingerprint: recommendation.deterministicFingerprint,
          sourceSnapshotDigest: snapshot.snapshotDigest,
          boundAt
        }
      });
      return mapJournal(journal, recommendation);
    });
  }
}

function validAuthorization(receipt: GovernedRecommendationAuthorizationReceipt | null, request: EvaluateAndRecordRecommendationRequest, now: string): receipt is GovernedRecommendationAuthorizationReceipt {
  if (receipt === null || receipt.actorId !== request.actorId || receipt.tenantId !== request.tenantId || receipt.purpose !== request.purpose || receipt.caseId !== request.caseId ||
      receipt.permission !== 'EVALUATE_AND_RECORD_RECOMMENDATION' || receipt.status !== 'ACTIVE' ||
      receipt.policyVersion !== GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION) return false;
  const issuedAt = Date.parse(receipt.issuedAt), expiresAt = Date.parse(receipt.expiresAt), time = Date.parse(now);
  return Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && issuedAt <= time && time < expiresAt;
}

function validSource(source: AuthoritativeSafetyFusionInputReceipt, request: EvaluateAndRecordRecommendationRequest, snapshot: SafetyFusionInputSnapshot): boolean {
  return source.sourceSnapshotDigest === snapshot.snapshotDigest && source.input.tenantId === request.tenantId &&
    source.input.caseId === request.caseId && source.input.inputVersion === request.inputVersion &&
    source.input.requestedRuleSetVersion.length > 0 && source.input.requestedThresholdVersion.length > 0;
}

function mapJournal(value: RecommendationJournalResult, recommendation: SafetyFusionRecommendation): GovernedRecommendationUseCaseResult {
  if (value.disposition === 'CREATED') return output('RECORDED', 'STORED', recommendation);
  if (value.disposition === 'IDEMPOTENT') return output('IDEMPOTENT', 'EXACT_REPLAY', recommendation);
  if (value.disposition === 'CONFLICT') return output('CONFLICT', 'DUPLICATE_INPUT', recommendation);
  return output('REJECTED', 'JOURNAL_REJECTED', recommendation);
}
function output(status: GovernedRecommendationUseCaseResult['status'], reason: GovernedRecommendationUseCaseReason, recommendation: SafetyFusionRecommendation | null): GovernedRecommendationUseCaseResult {
  return Object.freeze({ status, reason, recommendation });
}
async function trustedTime(clock: SafetyFusionClockPort): Promise<string | null> {
  try {
    const value = await clock.now();
    return Number.isFinite(Date.parse(value)) ? value : null;
  } catch { return null; }
}
