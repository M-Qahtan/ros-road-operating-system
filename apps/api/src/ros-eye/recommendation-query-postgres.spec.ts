import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  RecommendationSnapshotBinding,
  SafetyFusionInputSnapshot,
  SafetyFusionRecommendation
} from '@ros/contracts';
import type { AuthenticatedActor } from '../application/ports.js';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  GOVERNED_RECOMMENDATION_QUERY_TRANSACTION_SQL,
  POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL,
  PostgresGovernedRecommendationQuery
} from './recommendation-query-postgres.js';
import type {
  AuthoritativeContactReceipt,
  AuthoritativeInputSnapshotSources,
  AuthoritativeRevisionReceipt
} from './input-snapshot-capture.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';
import { ACTIVE_SAFETY_FUSION_RULE_SET } from './safety-fusion.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'TRAFFIC_COORDINATION', caseId: CASE_ID } as const;
const ACTOR: AuthenticatedActor = { actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: SCOPE.tenantId, purpose: SCOPE.purpose };
const digest = (value: string) => value.repeat(64);
const fingerprint = (value: string) => `sha256:${digest(value)}`;
const receipts = {
  case: { authority: 'SOURCE_LEDGER', revision: 7, digest: digest('a') },
  severity: { authority: 'SOURCE_LEDGER', revision: 3, digest: digest('b') },
  contact: { authority: 'SOURCE_LEDGER', revision: 4, digest: digest('c') },
  evidence: { authority: 'SOURCE_LEDGER', revision: 9, digest: digest('d') },
  indicators: { authority: 'SOURCE_LEDGER', revision: 2, digest: digest('e') }
} as const satisfies Record<string, AuthoritativeRevisionReceipt>;

function recommendation(overrides: Partial<SafetyFusionRecommendation> = {}): SafetyFusionRecommendation {
  return {
    tenantId: SCOPE.tenantId, caseId: CASE_ID, inputVersion: 1, evaluatedAt: '2026-09-08T18:00:01.000Z',
    currentSeverity: 'S3', recommendedSeverity: 'S4', score: 8, confidence: 0.8, uncertainty: 0.2,
    reasonCodes: ['FUSION_HUMAN_AUTHORITY_REQUIRED'], missingEvidenceFlags: [], contributions: [],
    guardResults: [{ kind: 'DATA_QUALITY', disposition: 'CLEAR', reasonCode: 'clear', guardVersion: 'v1', evaluatedInputVersion: 1 }],
    requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false, autonomousDispatchPermitted: false, policyVersion: 'ros-eye.safety-fusion.v1',
    ruleSetVersion: ACTIVE_SAFETY_FUSION_RULE_SET.ruleSetVersion,
    thresholdVersion: ACTIVE_SAFETY_FUSION_RULE_SET.thresholdVersion,
    deterministicFingerprint: fingerprint('f'), ...overrides
  };
}
function binding(): RecommendationSnapshotBinding {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', inputVersion: 1,
    recommendationFingerprint: fingerprint('f'), sourceSnapshotDigest: digest('1'),
    boundAt: '2026-09-08T18:00:02.000Z'
  };
}
function snapshot(): SafetyFusionInputSnapshot {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', tenantId: SCOPE.tenantId, caseId: CASE_ID,
    inputVersion: 1, capturedAt: '2026-09-08T18:00:00.000Z',
    case: strip(receipts.case), severity: strip(receipts.severity), contact: strip(receipts.contact),
    evidence: strip(receipts.evidence), indicators: strip(receipts.indicators), snapshotDigest: digest('1')
  };
}

class QueryPool implements ContactSqlPoolPort {
  readonly calls: string[] = [];
  row: ContactSqlRow | null = journalRow();
  async transaction<T>(work: (connection: QueryPool) => Promise<T>): Promise<T> { return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push(text);
    if (text === GOVERNED_RECOMMENDATION_QUERY_TRANSACTION_SQL) return rows([]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.authorizeCase) return rows([{ case_id: CASE_ID }]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.latest) return rows(this.row === null ? [] : [this.row]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) return rows([snapshotRow()]) as ContactSqlQueryResult<Row>;
    throw new Error(`unexpected SQL: ${text}`);
  }
}

class Sources implements AuthoritativeInputSnapshotSources {
  indicatorRevision: number = receipts.indicators.revision;
  missingEvidence = false;
  case = source(receipts.case);
  severity = source(receipts.severity);
  contact = { async load(): Promise<AuthoritativeContactReceipt> { return { status: 'PRESENT', binding: receipts.contact }; } };
  evidence = { load: async () => this.missingEvidence ? null : receipts.evidence };
  indicators = { load: async () => ({ ...receipts.indicators, revision: this.indicatorRevision }) };
}

test('returns only a current exact-scope recommendation and preserves non-executable review state', async () => {
  const query = new PostgresGovernedRecommendationQuery(new QueryPool(), new Sources());
  const result = await query.read(ACTOR, CASE_ID);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.snapshot?.status, 'VERIFIED');
  assert.equal(result.recommendation?.deterministicFingerprint, fingerprint('f'));
  assert.equal(result.humanReviewStatus, 'PENDING');
  assert.equal(result.mode, 'SHADOW_ONLY');
  assert.equal(result.activationAuthorized, false);
  assert.equal(GOVERNED_RECOMMENDATION_QUERY_TRANSACTION_SQL.includes('READ ONLY'), true);
  assert.equal(POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.authorizeCase.includes('FOR SHARE'), false);
  assert.equal(POSTGRES_GOVERNED_RECOMMENDATION_QUERY_SQL.latest.includes('FOR SHARE'), false);
});

test('a newer module revision withholds the historical recommendation but retains pending human review', async () => {
  const sources = new Sources();
  sources.indicatorRevision = 3;
  const result = await new PostgresGovernedRecommendationQuery(new QueryPool(), sources).read(ACTOR, CASE_ID);
  assert.equal(result.status, 'WITHHELD');
  assert.deepEqual(result.snapshot, { status: 'INVALIDATED', reason: 'CURRENT_INPUT_CHANGED', sourceSnapshotDigest: digest('1') });
  assert.equal(result.recommendation, null);
  assert.equal(result.humanReviewStatus, 'PENDING');
});

test('role, actor and case identity validation deny before database access', async () => {
  for (const actor of [
    { ...ACTOR, roles: ['FIELD_USER'] as const },
    { ...ACTOR, actorId: 'self-attested' }
  ]) {
    const pool = new QueryPool();
    assert.equal((await new PostgresGovernedRecommendationQuery(pool, new Sources()).read(actor, CASE_ID)).status, 'FORBIDDEN');
    assert.equal(pool.calls.length, 0);
  }
});

test('forged activation or review columns withhold the row without claiming persisted review state', async () => {
  const pool = new QueryPool();
  pool.row = { ...journalRow(), activation_authorized: true };
  const result = await new PostgresGovernedRecommendationQuery(pool, new Sources()).read(ACTOR, CASE_ID);
  assert.equal(result.status, 'WITHHELD');
  assert.equal(result.recommendation, null);
  assert.equal(result.humanReviewStatus, null);
  assert.equal(result.activationAuthorized, false);
});

test('an unavailable owner receipt never promotes a persisted recommendation to current', async () => {
  const sources = new Sources();
  sources.missingEvidence = true;
  const result = await new PostgresGovernedRecommendationQuery(new QueryPool(), sources).read(ACTOR, CASE_ID);
  assert.equal(result.status, 'WITHHELD');
  assert.equal(result.snapshot?.status, 'UNVERIFIED');
  assert.equal(result.snapshot?.reason, 'MISSING_BINDING');
  assert.equal(result.recommendation, null);
  assert.equal(result.humanReviewStatus, 'PENDING');
});

function journalRow(): ContactSqlRow {
  return {
    input_version: 1, deterministic_fingerprint: fingerprint('f'), source_snapshot_digest: digest('1'),
    authority: 'RECOMMENDATION_ONLY', mode: 'SHADOW_ONLY', activation_authorized: false,
    human_review_status: 'PENDING', recommendation: recommendation(), binding: binding()
  };
}
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
function source(value: AuthoritativeRevisionReceipt) { return { async load() { return value; } }; }
function strip(value: AuthoritativeRevisionReceipt) { return { revision: value.revision, digest: value.digest }; }
function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }
