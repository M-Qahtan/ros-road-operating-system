import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafetyFusionInputSnapshot } from '@ros/contracts';
import { evidenceRevisionDigest } from '../evidence/evidence-revision.js';
import type { EvidenceRow } from '../evidence/postgres-evidence-repository.js';
import type { TrustedIntegrationPrincipal } from '../integrations/integration-principal.js';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import { POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL } from './governed-recommendation-authorization.js';
import { GOVERNED_RECOMMENDATION_TRANSACTION_SQL } from './governed-recommendation-use-case.js';
import { createPostgresGovernedRecommendationRuntime } from './governed-recommendation-runtime.js';
import { indicatorRevisionDigest, type RecordedSafetyIndicator } from './human-safety-indicator-revision.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';
import { POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL } from './postgres-authoritative-safety-fusion-input.js';
import { POSTGRES_RECOMMENDATION_JOURNAL_SQL } from './recommendation-journal-postgres.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'TRAFFIC_COORDINATION', caseId: CASE_ID } as const;
const digest = (character: string) => character.repeat(64);
const indicator: RecordedSafetyIndicator = {
  indicatorId: '44444444-4444-4444-8444-444444444444', supersedesIndicatorId: null,
  code: 'HELP_REQUESTED', observedAt: '2026-09-08T18:00:00.000Z', source: 'OPERATOR',
  confidence: 0.9, requiresHumanReview: true
};
const evidenceRow: EvidenceRow = {
  id: '55555555-5555-4555-8555-555555555555', road_event_id: CASE_ID,
  object_key: 'tenant-riyadh/case/evidence', original_filename: 'evidence.bin', content_type: 'application/octet-stream',
  declared_size_bytes: 3, actual_size_bytes: 3, declared_checksum_sha256: digest('5'), verified_checksum_sha256: digest('5'),
  status: 'PRESERVED', upload_expires_at: '2026-09-08T18:05:00.000Z', retain_until: '2027-09-09T18:00:00.000Z',
  legal_hold: false, created_by: ACTOR_ID, created_at: '2026-09-08T17:59:00.000Z',
  completed_at: '2026-09-08T18:00:00.000Z', quarantine_reason: null
};
const evidenceDigest = evidenceRevisionDigest(SCOPE, [{
  id: evidenceRow.id, roadEventId: evidenceRow.road_event_id, objectKey: evidenceRow.object_key,
  originalFilename: evidenceRow.original_filename, contentType: evidenceRow.content_type,
  declaredSizeBytes: 3, actualSizeBytes: 3, declaredChecksumSha256: digest('5'), verifiedChecksumSha256: digest('5'),
  status: 'PRESERVED', uploadExpiresAt: new Date(evidenceRow.upload_expires_at),
  retention: { retainUntil: new Date(evidenceRow.retain_until), legalHold: false }, createdBy: evidenceRow.created_by,
  createdAt: new Date(evidenceRow.created_at), completedAt: new Date(evidenceRow.completed_at!)
}]);
const indicatorDigest = indicatorRevisionDigest(SCOPE, [indicator]);
const SNAPSHOT: SafetyFusionInputSnapshot = {
  policyVersion: 'ros-eye.input-snapshot.v1', tenantId: SCOPE.tenantId, caseId: CASE_ID,
  inputVersion: 3, capturedAt: '2026-09-08T18:00:02.000Z',
  case: { revision: 7, digest: digest('a') }, severity: { revision: 4, digest: digest('b') }, contact: null,
  evidence: { revision: 2, digest: evidenceDigest }, indicators: { revision: 1, digest: indicatorDigest },
  snapshotDigest: digest('1')
};
const PRINCIPAL: TrustedIntegrationPrincipal = {
  subject: ACTOR_ID, clientId: 'operator-console', tenantId: SCOPE.tenantId, purpose: SCOPE.purpose,
  mfaVerified: true, roles: ['OPERATOR'], issuedAt: '2026-09-08T17:59:00.000Z', expiresAt: '2026-09-08T18:05:00.000Z'
};

class RuntimePool implements ContactSqlPoolPort {
  readonly calls: string[] = [];
  transactions = 0;
  stored = false;
  async transaction<T>(work: (connection: RuntimePool) => Promise<T>): Promise<T> { this.transactions += 1; return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push(text);
    if (text === POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL) return rows([{ case_id: CASE_ID }]) as ContactSqlQueryResult<Row>;
    if (text === GOVERNED_RECOMMENDATION_TRANSACTION_SQL) return rows([]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) return rows([snapshotRow()]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM road_event_revision_ledger')) return rows([{
      revision: values[3] === 'CASE' ? 7 : 4, digest: values[3] === 'CASE' ? digest('a') : digest('b')
    }]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.roadEvent) return rows([{ case_id: CASE_ID, severity: 'S3' }]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM road_events')) return rows([{ case_id: CASE_ID }]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM ros_eye_contact_sessions')) return rows([]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return rows([]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM evidence_objects')) return rows([evidenceRow]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM evidence_revision_ledger')) return rows([{ revision: 2, digest: evidenceDigest }]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM human_safety_indicator_revision_ledger')) return rows([{
      revision: 1, indicator_set: [indicator], digest: indicatorDigest, recorded_at: '2026-09-08T18:00:01.000Z'
    }]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.activeRule) return rows([{
      rule_set_version: 'ros-eye.safety-fusion.rules.v1', threshold_version: 'ros-eye.safety-fusion.thresholds.v1'
    }]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.readExact) return rows([]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_RECOMMENDATION_JOURNAL_SQL.insert) { this.stored = true; return { rows: [], rowCount: 1 }; }
    throw new Error(`unexpected SQL: ${text}`);
  }
}

test('internal runtime proves exact-scope OIDC authorization through authoritative fusion and shadow journal', async () => {
  const pool = new RuntimePool();
  const runtime = createPostgresGovernedRecommendationRuntime({
    pool, principal: PRINCIPAL, clock: { async now() { return '2026-09-08T18:00:03.000Z'; } }
  });
  const result = await runtime.execute({ ...SCOPE, actorId: ACTOR_ID, inputVersion: 3 });
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.reason, 'STORED');
  assert.equal(result.recommendation?.authority, 'RECOMMENDATION_ONLY');
  assert.equal(result.recommendation?.requiresHumanReview, true);
  assert.equal(result.recommendation?.autonomousDispatchPermitted, false);
  assert.equal(pool.transactions, 1);
  assert.equal(pool.stored, true);
});

test('composition rejects scope drift before the governed transaction or source reads', async () => {
  const pool = new RuntimePool();
  const runtime = createPostgresGovernedRecommendationRuntime({
    pool, principal: PRINCIPAL, clock: { async now() { return '2026-09-08T18:00:03.000Z'; } }
  });
  const result = await runtime.execute({ ...SCOPE, tenantId: 'tenant-other', actorId: ACTOR_ID, inputVersion: 3 });
  assert.deepEqual(result, { status: 'REJECTED', reason: 'AUTHORIZATION_DENIED', recommendation: null });
  assert.equal(pool.transactions, 0);
  assert.equal(pool.calls.length, 0);
});

function snapshotRow(): ContactSqlRow {
  return {
    tenant_id: SNAPSHOT.tenantId, purpose: SCOPE.purpose, case_id: SNAPSHOT.caseId, input_version: SNAPSHOT.inputVersion,
    policy_version: SNAPSHOT.policyVersion, captured_at: SNAPSHOT.capturedAt, case_revision: SNAPSHOT.case.revision,
    case_digest: SNAPSHOT.case.digest, severity_revision: SNAPSHOT.severity.revision, severity_digest: SNAPSHOT.severity.digest,
    contact_revision: null, contact_digest: null, evidence_revision: SNAPSHOT.evidence.revision,
    evidence_digest: SNAPSHOT.evidence.digest, indicator_revision: SNAPSHOT.indicators.revision,
    indicator_digest: SNAPSHOT.indicators.digest, snapshot_digest: SNAPSHOT.snapshotDigest
  };
}
function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }
