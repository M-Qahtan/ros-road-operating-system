import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafetyFusionClockPort, SafetyFusionInput, SafetyFusionInputSnapshot } from '@ros/contracts';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION,
  GOVERNED_RECOMMENDATION_TRANSACTION_SQL,
  GovernedRecommendationUseCase,
  type AuthoritativeSafetyFusionInputPort,
  type GovernedRecommendationAuthorizationPort
} from './governed-recommendation-use-case.js';
import {
  GovernedSafetyFusionOrchestrator,
  SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
  type SafetyFusionEvidenceAuthorityPort,
  type SafetyFusionEvidenceAuthorityReceipt
} from './governed-safety-fusion.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';
import { POSTGRES_RECOMMENDATION_JOURNAL_SQL, PostgresRecommendationJournal } from './recommendation-journal-postgres.js';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  DEFAULT_SAFETY_FUSION_GUARDS,
  NodeSafetyFusionFingerprint,
  StaticSafetyFusionRegistry
} from './safety-fusion.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;
const digest = (character: string) => character.repeat(64);
const evidence = {
  evidenceId: 'evidence-001', sourceRef: 'vehicle-001', sourceType: 'VEHICLE' as const,
  code: 'DEVICE_AIRBAG' as const, direction: 'SUPPORTS_RISK' as const,
  observedAt: '2026-09-08T14:00:00.000Z', receivedAt: '2026-09-08T14:00:00.100Z',
  reliability: 0.95, integrity: 'VERIFIED' as const, deviceCondition: 'HEALTHY' as const,
  corroborationGroup: 'incident-001', locationQuality: 'PRECISE' as const
};

const fusionInput: SafetyFusionInput = {
  tenantId: SCOPE.tenantId, caseId: CASE_ID, inputVersion: 1, currentSeverity: 'S3',
  contactState: 'NO_RESPONSE', contactLastInteractionAt: '2026-09-08T14:00:00.200Z', evidence: [evidence],
  requestedRuleSetVersion: ACTIVE_SAFETY_FUSION_RULE_SET.ruleSetVersion,
  requestedThresholdVersion: ACTIVE_SAFETY_FUSION_RULE_SET.thresholdVersion
};

function snapshot(): SafetyFusionInputSnapshot {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', tenantId: SCOPE.tenantId, caseId: CASE_ID, inputVersion: 1,
    capturedAt: '2026-09-08T14:00:00.500Z', case: { revision: 7, digest: digest('a') },
    severity: { revision: 3, digest: digest('b') }, contact: { revision: 4, digest: digest('c') },
    evidence: { revision: 9, digest: digest('d') }, indicators: { revision: 2, digest: digest('e') },
    snapshotDigest: digest('1')
  };
}

class EvaluationPool implements ContactSqlPoolPort {
  readonly calls: string[] = [];
  transactions = 0;
  stored: ContactSqlRow | null = null;
  async transaction<T>(work: (connection: EvaluationPool) => Promise<T>): Promise<T> { this.transactions += 1; return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push(text);
    if (text === GOVERNED_RECOMMENDATION_TRANSACTION_SQL) return rows([]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) return rows([snapshotRow()]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.readExact) return rows(this.stored === null ? [] : [this.stored]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert) {
      this.stored = { deterministic_fingerprint: values[8], source_snapshot_digest: values[4], recommendation: values[11], binding: values[12] };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }
}

class Authorization implements GovernedRecommendationAuthorizationPort {
  active = true;
  calls = 0;
  expiresAt = '2026-09-08T14:05:00.000Z';
  async authorize(actor: { actorId: string }) {
    this.calls += 1;
    if (!this.active) return null;
    return {
      ...SCOPE, actorId: actor.actorId, permission: 'EVALUATE_AND_RECORD_RECOMMENDATION' as const,
      status: 'ACTIVE' as const, policyVersion: GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION,
      issuedAt: '2026-09-08T13:59:00.000Z', expiresAt: this.expiresAt
    };
  }
}

class InputLoader implements AuthoritativeSafetyFusionInputPort {
  calls = 0;
  digest = snapshot().snapshotDigest;
  available = true;
  async load() {
    this.calls += 1;
    return this.available ? { authority: 'SOURCE_LEDGER' as const, sourceSnapshotDigest: this.digest, input: fusionInput } : null;
  }
}

class EvidenceAuthority implements SafetyFusionEvidenceAuthorityPort {
  available = true;
  calls = 0;
  async findEvidence(): Promise<SafetyFusionEvidenceAuthorityReceipt | null> {
    this.calls += 1;
    return this.available ? {
      ...evidence, tenantId: SCOPE.tenantId, caseId: CASE_ID, approvedPurpose: 'HUMAN_SAFETY_FUSION',
      status: 'ACTIVE', policyVersion: SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
      issuedAt: '2026-09-08T13:55:00.000Z', expiresAt: '2026-09-08T14:10:00.000Z'
    } : null;
  }
}

class SequenceClock implements SafetyFusionClockPort {
  private index = 0;
  constructor(private readonly values: readonly string[]) {}
  async now(): Promise<string> { return this.values[Math.min(this.index++, this.values.length - 1)]!; }
}

function useCase(pool: EvaluationPool, authorization = new Authorization(), input = new InputLoader(), evidenceAuthority = new EvidenceAuthority()) {
  const registry = new StaticSafetyFusionRegistry([ACTIVE_SAFETY_FUSION_RULE_SET]);
  const fusion = new GovernedSafetyFusionOrchestrator(
    registry, DEFAULT_SAFETY_FUSION_GUARDS, new SequenceClock(['2026-09-08T14:00:01.000Z']),
    new NodeSafetyFusionFingerprint(), evidenceAuthority
  );
  return {
    service: new GovernedRecommendationUseCase(
      pool, authorization, input, fusion,
      new SequenceClock(['2026-09-08T14:00:00.900Z', '2026-09-08T14:00:02.000Z']),
      new PostgresRecommendationJournal(pool, registry)
    ), authorization, input, evidenceAuthority
  };
}

const request = { ...SCOPE, actorId: 'ros-brain-runtime', inputVersion: 1 } as const;

test('authorized use case runs governed fusion and appends one snapshot-bound shadow recommendation in one transaction', async () => {
  const pool = new EvaluationPool();
  const { service, evidenceAuthority } = useCase(pool);
  const result = await service.execute(request);
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.reason, 'STORED');
  assert.equal(result.recommendation?.authority, 'RECOMMENDATION_ONLY');
  assert.equal(result.recommendation?.requiresHumanReview, true);
  assert.equal(pool.transactions, 1);
  assert.equal(evidenceAuthority.calls, 1);
  assert.equal(pool.calls.filter((sql) => sql === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert).length, 1);
});

test('retry returns the same logical journal entry without a duplicate insert', async () => {
  const pool = new EvaluationPool();
  assert.equal((await useCase(pool).service.execute(request)).status, 'RECORDED');
  assert.equal((await useCase(pool).service.execute(request)).status, 'IDEMPOTENT');
  assert.equal(pool.calls.filter((sql) => sql === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert).length, 1);
});

test('missing authorization stops before transaction, source reads, fusion and journal', async () => {
  const pool = new EvaluationPool();
  const authorization = new Authorization();
  authorization.active = false;
  const built = useCase(pool, authorization);
  assert.deepEqual(await built.service.execute(request), { status: 'REJECTED', reason: 'AUTHORIZATION_DENIED', recommendation: null });
  assert.equal(pool.transactions, 0);
  assert.equal(built.input.calls, 0);
  assert.equal(built.evidenceAuthority.calls, 0);
});

test('source receipt with a different snapshot digest fails before fusion or journal', async () => {
  const pool = new EvaluationPool();
  const input = new InputLoader();
  input.digest = digest('9');
  const built = useCase(pool, new Authorization(), input);
  assert.equal((await built.service.execute(request)).reason, 'SOURCE_MISMATCH');
  assert.equal(built.evidenceAuthority.calls, 0);
  assert.equal(pool.calls.some((sql) => sql === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert), false);
});

test('authorization expiring during evaluation prevents the journal append', async () => {
  const pool = new EvaluationPool();
  const authorization = new Authorization();
  authorization.expiresAt = '2026-09-08T14:00:01.500Z';
  const result = await useCase(pool, authorization).service.execute(request);
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'AUTHORIZATION_DENIED');
  assert.equal(result.recommendation?.requiresHumanReview, true);
  assert.equal(pool.calls.some((sql) => sql === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert), false);
});

test('blocked governed evaluation remains visible for human review but is not persisted', async () => {
  const pool = new EvaluationPool();
  const evidenceAuthority = new EvidenceAuthority();
  evidenceAuthority.available = false;
  const result = await useCase(pool, new Authorization(), new InputLoader(), evidenceAuthority).service.execute(request);
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'EVALUATION_BLOCKED');
  assert.equal(result.recommendation?.requiresHumanReview, true);
  assert.ok(result.recommendation?.guardResults.some((guard) => guard.disposition === 'BLOCK_AND_REVIEW'));
  assert.equal(pool.calls.some((sql) => sql === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert), false);
});

function snapshotRow(): ContactSqlRow {
  const value = snapshot();
  return {
    tenant_id: value.tenantId, purpose: SCOPE.purpose, case_id: value.caseId, input_version: value.inputVersion,
    policy_version: value.policyVersion, captured_at: value.capturedAt, case_revision: value.case.revision,
    case_digest: value.case.digest, severity_revision: value.severity.revision, severity_digest: value.severity.digest,
    contact_revision: value.contact?.revision, contact_digest: value.contact?.digest, evidence_revision: value.evidence.revision,
    evidence_digest: value.evidence.digest, indicator_revision: value.indicators.revision,
    indicator_digest: value.indicators.digest, snapshot_digest: value.snapshotDigest
  };
}
function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }
