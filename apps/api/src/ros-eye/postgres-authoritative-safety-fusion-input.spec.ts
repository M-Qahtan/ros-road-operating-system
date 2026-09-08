import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafetyFusionInputSnapshot } from '@ros/contracts';
import { evidenceRevisionDigest } from '../evidence/evidence-revision.js';
import type { EvidenceRow } from '../evidence/postgres-evidence-repository.js';
import type { ContactSqlConnectionPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import { indicatorRevisionDigest, type RecordedSafetyIndicator } from './human-safety-indicator-revision.js';
import {
  POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL,
  PostgresAuthoritativeSafetyFusionInput
} from './postgres-authoritative-safety-fusion-input.js';
import { GovernedSafetyFusionOrchestrator } from './governed-safety-fusion.js';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  DEFAULT_SAFETY_FUSION_GUARDS,
  NodeSafetyFusionFingerprint,
  StaticSafetyFusionRegistry
} from './safety-fusion.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;
const digest = (character: string) => character.repeat(64);
const indicator: RecordedSafetyIndicator = {
  indicatorId: '44444444-4444-4444-8444-444444444444', supersedesIndicatorId: null,
  code: 'HELP_REQUESTED', observedAt: '2026-09-08T14:00:00.000Z', source: 'OPERATOR',
  confidence: 0.9, requiresHumanReview: true
};
const evidenceRow: EvidenceRow = {
  id: '55555555-5555-4555-8555-555555555555', road_event_id: CASE_ID,
  object_key: 'tenant-riyadh/case/evidence', original_filename: 'evidence.bin', content_type: 'application/octet-stream',
  declared_size_bytes: 3, actual_size_bytes: 3, declared_checksum_sha256: digest('5'), verified_checksum_sha256: digest('5'),
  status: 'PRESERVED', upload_expires_at: '2026-09-08T14:05:00.000Z', retain_until: '2027-09-09T14:00:00.000Z',
  legal_hold: false, created_by: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-08T13:59:00.000Z',
  completed_at: '2026-09-08T14:00:00.000Z', quarantine_reason: null
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

function snapshot(overrides: Partial<SafetyFusionInputSnapshot> = {}): SafetyFusionInputSnapshot {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', tenantId: SCOPE.tenantId, caseId: CASE_ID,
    inputVersion: 3, capturedAt: '2026-09-08T14:00:02.000Z',
    case: { revision: 7, digest: digest('a') }, severity: { revision: 4, digest: digest('b') }, contact: null,
    evidence: { revision: 2, digest: evidenceDigest }, indicators: { revision: 1, digest: indicatorDigest },
    snapshotDigest: digest('1'), ...overrides
  };
}

class FusionConnection implements ContactSqlConnectionPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  caseDigest = digest('a');
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text.includes('FROM road_event_revision_ledger')) {
      return rows([{ revision: values[3] === 'CASE' ? 7 : 4, digest: values[3] === 'CASE' ? this.caseDigest : digest('b') }]) as ContactSqlQueryResult<Row>;
    }
    if (text.includes('FROM road_events') && text !== POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.roadEvent) return rows([{ case_id: CASE_ID }]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM ros_eye_contact_sessions') && text !== POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.contacts) return rows([]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return rows([]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM evidence_objects')) return rows([evidenceRow]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM evidence_revision_ledger')) return rows([{ revision: 2, digest: evidenceDigest }]) as ContactSqlQueryResult<Row>;
    if (text.includes('FROM human_safety_indicator_revision_ledger')) {
      return rows([{ revision: 1, indicator_set: [indicator], digest: indicatorDigest, recorded_at: '2026-09-08T14:00:01.000Z' }]) as ContactSqlQueryResult<Row>;
    }
    if (text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.roadEvent) return rows([{ case_id: CASE_ID, severity: 'S3' }]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.contacts) return rows([]) as ContactSqlQueryResult<Row>;
    if (text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.activeRule) return rows([{
      rule_set_version: 'ros-eye.safety-fusion.rules.v1', threshold_version: 'ros-eye.safety-fusion.thresholds.v1'
    }]) as ContactSqlQueryResult<Row>;
    throw new Error(`unexpected SQL: ${text}`);
  }
}

test('builds exact snapshot-bound fusion input and transaction-scoped evidence authority from module ledgers', async () => {
  const connection = new FusionConnection();
  const result = await new PostgresAuthoritativeSafetyFusionInput().load(connection, SCOPE, snapshot());
  assert.ok(result);
  assert.equal(result.authority, 'SOURCE_LEDGER');
  assert.equal(result.sourceSnapshotDigest, digest('1'));
  assert.equal(result.input.currentSeverity, 'S3');
  assert.equal(result.input.contactState, 'NOT_STARTED');
  assert.equal(result.input.evidence.length, 1);
  assert.deepEqual(result.input.evidence[0], {
    evidenceId: indicator.indicatorId, sourceRef: `indicator:${indicator.indicatorId}`, sourceType: 'OPERATOR',
    code: 'HELP_REQUESTED', direction: 'SUPPORTS_RISK', observedAt: indicator.observedAt,
    receivedAt: '2026-09-08T14:00:01.000Z', reliability: 0.9, integrity: 'VERIFIED',
    deviceCondition: 'UNKNOWN', corroborationGroup: `case:${indicator.indicatorId}`, locationQuality: 'UNKNOWN'
  });
  const receipt = await result.evidenceAuthority.findEvidence({
    tenantId: SCOPE.tenantId, caseId: CASE_ID, evidenceId: indicator.indicatorId,
    sourceRef: `indicator:${indicator.indicatorId}`
  });
  assert.equal(receipt?.approvedPurpose, 'HUMAN_SAFETY_FUSION');
  assert.equal(receipt?.expiresAt, '2026-09-08T14:30:01.000Z');
  const recommendation = await new GovernedSafetyFusionOrchestrator(
    new StaticSafetyFusionRegistry([ACTIVE_SAFETY_FUSION_RULE_SET]),
    DEFAULT_SAFETY_FUSION_GUARDS,
    { async now() { return '2026-09-08T14:00:03.000Z'; } },
    new NodeSafetyFusionFingerprint(),
    result.evidenceAuthority
  ).recommend(result.input, result.evidenceAuthority);
  assert.equal(recommendation.authority, 'RECOMMENDATION_ONLY');
  assert.equal(recommendation.requiresHumanReview, true);
  assert.equal(recommendation.guardResults.some((guard) => guard.disposition === 'BLOCK_AND_REVIEW'), false);
});

test('snapshot scope mismatch is rejected before any database read', async () => {
  const connection = new FusionConnection();
  assert.equal(await new PostgresAuthoritativeSafetyFusionInput().load(connection, SCOPE, snapshot({ tenantId: 'tenant-other' })), null);
  assert.equal(connection.calls.length, 0);
});

test('any module receipt drift stops before semantic fusion reads', async () => {
  const connection = new FusionConnection();
  connection.caseDigest = digest('9');
  assert.equal(await new PostgresAuthoritativeSafetyFusionInput().load(connection, SCOPE, snapshot()), null);
  assert.equal(connection.calls.length, 1);
  assert.equal(connection.calls.some((call) => call.text === POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.roadEvent), false);
});

test('evidence authority cannot be rebound to a different tenant case or source reference', async () => {
  const result = await new PostgresAuthoritativeSafetyFusionInput().load(new FusionConnection(), SCOPE, snapshot());
  assert.ok(result);
  const base = { tenantId: SCOPE.tenantId, caseId: CASE_ID, evidenceId: indicator.indicatorId, sourceRef: `indicator:${indicator.indicatorId}` };
  assert.equal(await result.evidenceAuthority.findEvidence({ ...base, tenantId: 'tenant-other' }), null);
  assert.equal(await result.evidenceAuthority.findEvidence({ ...base, caseId: '99999999-9999-4999-8999-999999999999' }), null);
  assert.equal(await result.evidenceAuthority.findEvidence({ ...base, sourceRef: 'indicator:other' }), null);
});

function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }
