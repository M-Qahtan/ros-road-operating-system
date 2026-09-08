import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { RecommendationSnapshotBinding, SafetyFusionInputSnapshot, SafetyFusionRecommendation, SafetyFusionRegistryPort } from '@ros/contracts';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';
import { ACTIVE_SAFETY_FUSION_RULE_SET } from './safety-fusion.js';
import { POSTGRES_RECOMMENDATION_JOURNAL_SQL, PostgresRecommendationJournal } from './recommendation-journal-postgres.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;
const digest = (character: string) => character.repeat(64);
const fingerprint = (character: string) => `sha256:${digest(character)}`;

function snapshot(): SafetyFusionInputSnapshot {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', ...SCOPE, inputVersion: 1, capturedAt: '2026-09-08T14:00:00.000Z',
    case: { revision: 7, digest: digest('a') }, severity: { revision: 3, digest: digest('b') },
    contact: { revision: 4, digest: digest('c') }, evidence: { revision: 9, digest: digest('d') },
    indicators: { revision: 2, digest: digest('e') }, snapshotDigest: digest('1')
  };
}

function recommendation(overrides: Partial<SafetyFusionRecommendation> = {}): SafetyFusionRecommendation {
  return {
    tenantId: SCOPE.tenantId, caseId: CASE_ID, inputVersion: 1, evaluatedAt: '2026-09-08T14:00:01.000Z',
    currentSeverity: 'S3', recommendedSeverity: 'S4', score: 8, confidence: 0.8, uncertainty: 0.2,
    reasonCodes: ['FUSION_HUMAN_AUTHORITY_REQUIRED'], missingEvidenceFlags: [], contributions: [],
    guardResults: [{ kind: 'DATA_QUALITY', disposition: 'CLEAR', reasonCode: 'clear', guardVersion: 'v1', evaluatedInputVersion: 1 }],
    requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false, autonomousDispatchPermitted: false, policyVersion: 'ros-eye.safety-fusion.v1',
    ruleSetVersion: ACTIVE_SAFETY_FUSION_RULE_SET.ruleSetVersion,
    thresholdVersion: ACTIVE_SAFETY_FUSION_RULE_SET.thresholdVersion, deterministicFingerprint: fingerprint('f'), ...overrides
  };
}

function binding(value = recommendation()): RecommendationSnapshotBinding {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', inputVersion: 1,
    recommendationFingerprint: value.deterministicFingerprint, sourceSnapshotDigest: digest('1'),
    boundAt: '2026-09-08T14:00:02.000Z'
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

class JournalPool implements ContactSqlPoolPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  stored: ContactSqlRow | null = null;
  hasSnapshot = true;
  loseInsertRace = false;
  async transaction<T>(work: (connection: JournalPool) => Promise<T>): Promise<T> { return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) return rows(this.hasSnapshot ? [snapshotRow()] : []) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.readExact) return rows(this.stored === null ? [] : [this.stored]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert) {
      const row = journalRow(values);
      if (this.stored !== null) return { rows: [], rowCount: 0 };
      this.stored = this.loseInsertRace ? { ...row, deterministic_fingerprint: fingerprint('9') } : row;
      return { rows: [], rowCount: this.loseInsertRace ? 0 : 1 };
    }
    throw new Error(`unexpected SQL: ${text}`);
  }
}

class Registry implements SafetyFusionRegistryPort {
  fail = false;
  active = true;
  async findRuleSet() {
    if (this.fail) throw new Error('registry unavailable');
    return this.active ? ACTIVE_SAFETY_FUSION_RULE_SET : { ...ACTIVE_SAFETY_FUSION_RULE_SET, status: 'RETIRED' as const };
  }
}

test('appends only a governed snapshot-bound shadow recommendation pending human review', async () => {
  const pool = new JournalPool();
  const value = recommendation();
  assert.deepEqual(await new PostgresRecommendationJournal(pool, new Registry()).append({ ...SCOPE, recommendation: value, binding: binding(value) }),
    { disposition: 'CREATED', reason: 'STORED' });
  const insert = pool.calls.find((call) => call.text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert);
  assert.ok(insert);
  assert.match(insert.text, /'RECOMMENDATION_ONLY', 'SHADOW_ONLY', false, 'PENDING'/);
  assert.deepEqual(insert.values.slice(0, 5), [SCOPE.tenantId, SCOPE.purpose, CASE_ID, 1, digest('1')]);
});

test('database migration independently guards active governance, payload binding and append-only history', () => {
  const migration = readFileSync('database/migrations/0021_ros_eye_recommendation_journal.sql', 'utf8');
  assert.match(migration, /snapshot_row\.snapshot_digest <> NEW\.source_snapshot_digest/);
  assert.match(migration, /rule_row\.status <> 'ACTIVE'/);
  assert.match(migration, /recommendation->>'requiresHumanReview' <> 'true'/);
  assert.match(migration, /binding->>'recommendationFingerprint' <> NEW\.deterministic_fingerprint/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON ros_eye_safety_fusion_recommendation_journal/);
});

test('exact retry is idempotent and a different recommendation for the same input conflicts', async () => {
  const pool = new JournalPool();
  const journal = new PostgresRecommendationJournal(pool, new Registry());
  const value = recommendation();
  const request = { ...SCOPE, recommendation: value, binding: binding(value) };
  assert.equal((await journal.append(request)).disposition, 'CREATED');
  assert.equal((await journal.append(request)).disposition, 'IDEMPOTENT');
  const changed = recommendation({ deterministicFingerprint: fingerprint('9') });
  assert.deepEqual(await journal.append({ ...SCOPE, recommendation: changed, binding: binding(changed) }),
    { disposition: 'CONFLICT', reason: 'DUPLICATE_INPUT' });
});

test('missing persisted snapshot and a mismatched binding fail before insert', async () => {
  const pool = new JournalPool();
  const journal = new PostgresRecommendationJournal(pool, new Registry());
  const value = recommendation();
  pool.hasSnapshot = false;
  assert.equal((await journal.append({ ...SCOPE, recommendation: value, binding: binding(value) })).reason, 'SNAPSHOT_NOT_FOUND');
  pool.hasSnapshot = true;
  assert.equal((await journal.append({ ...SCOPE, recommendation: value, binding: { ...binding(value), sourceSnapshotDigest: digest('9') } })).reason, 'BINDING_INVALID');
  assert.equal(pool.calls.some((call) => call.text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert), false);
});

test('inactive or unavailable governance and forged authority fields fail closed', async () => {
  const pool = new JournalPool();
  const registry = new Registry();
  const value = recommendation();
  registry.active = false;
  assert.equal((await new PostgresRecommendationJournal(pool, registry).append({ ...SCOPE, recommendation: value, binding: binding(value) })).reason, 'GOVERNANCE_INVALID');
  registry.fail = true;
  assert.equal((await new PostgresRecommendationJournal(pool, registry).append({ ...SCOPE, recommendation: value, binding: binding(value) })).reason, 'GOVERNANCE_INVALID');
  const forged = { ...value, requiresHumanReview: false, activationAuthorized: true } as unknown as SafetyFusionRecommendation;
  assert.equal((await new PostgresRecommendationJournal(pool, new Registry()).append({ ...SCOPE, recommendation: forged, binding: binding(value) })).reason, 'RECOMMENDATION_INVALID');
  assert.equal(pool.calls.some((call) => call.text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert), false);
});

test('a concurrent non-identical winner never becomes an idempotent success', async () => {
  const pool = new JournalPool();
  pool.loseInsertRace = true;
  const value = recommendation();
  assert.deepEqual(await new PostgresRecommendationJournal(pool, new Registry()).append({ ...SCOPE, recommendation: value, binding: binding(value) }),
    { disposition: 'CONFLICT', reason: 'DUPLICATE_INPUT' });
});

function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }
function journalRow(values: readonly unknown[]): ContactSqlRow {
  return { deterministic_fingerprint: values[8], source_snapshot_digest: values[4], recommendation: values[11], binding: values[12] };
}
