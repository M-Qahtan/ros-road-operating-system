import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION,
  assessRecommendationSnapshotBinding,
  type RecommendationSnapshotBinding,
  type SafetyFusionInputSnapshot,
  type SafetyFusionRecommendation
} from '@ros/contracts';
import { evidenceRevisionDigest } from '../evidence/evidence-revision.js';
import type { EvidenceRecord } from '../evidence/evidence-types.js';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import { indicatorRevisionDigest, type RecordedSafetyIndicator } from './human-safety-indicator-revision.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL, PostgresInputSnapshotRepository } from './input-snapshot-postgres.js';
import { createPostgresAuthoritativeInputSnapshotCaptureService } from './postgres-authoritative-input-snapshot-capture.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;
const digest = (character: string) => character.repeat(64);

function evidence(): EvidenceRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222', roadEventId: CASE_ID,
    objectKey: `road-events/${CASE_ID}/evidence/frame.jpg`, originalFilename: 'frame.jpg', contentType: 'image/jpeg',
    declaredSizeBytes: 128, declaredChecksumSha256: digest('a'), status: 'PENDING_UPLOAD',
    uploadExpiresAt: new Date('2026-09-08T13:10:00.000Z'),
    retention: { retainUntil: new Date('2027-09-09T13:00:00.000Z'), legalHold: false },
    createdBy: 'operator-a', createdAt: new Date('2026-09-08T13:00:00.000Z')
  };
}

function evidenceRow(record: EvidenceRecord): ContactSqlRow {
  return {
    id: record.id, road_event_id: record.roadEventId, object_key: record.objectKey,
    original_filename: record.originalFilename, content_type: record.contentType,
    declared_size_bytes: record.declaredSizeBytes, actual_size_bytes: null,
    declared_checksum_sha256: record.declaredChecksumSha256, verified_checksum_sha256: null,
    status: record.status, upload_expires_at: record.uploadExpiresAt,
    retain_until: record.retention.retainUntil, legal_hold: false, created_by: record.createdBy,
    created_at: record.createdAt, completed_at: null, quarantine_reason: null
  };
}

const firstIndicator: RecordedSafetyIndicator = {
  indicatorId: '33333333-3333-4333-8333-333333333333', supersedesIndicatorId: null,
  code: 'HELP_REQUESTED', observedAt: '2026-09-08T13:01:00.000Z', source: 'OPERATOR',
  confidence: 0.9, requiresHumanReview: true
};
const correction: RecordedSafetyIndicator = {
  indicatorId: '44444444-4444-4444-8444-444444444444', supersedesIndicatorId: firstIndicator.indicatorId,
  code: 'PERSON_RESPONDED', observedAt: '2026-09-08T13:02:00.000Z', source: 'OPERATOR',
  confidence: 0.95, requiresHumanReview: true
};

class IntegratedPool implements ContactSqlPoolPort {
  readonly calls: string[] = [];
  private readonly snapshots = new Map<number, ContactSqlRow>();
  private readonly evidenceRecord = evidence();
  indicatorRevision = 1;
  indicators: readonly RecordedSafetyIndicator[] = [firstIndicator];

  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> { return work(this); }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push(text);
    const result = this.result(text, values);
    return result as ContactSqlQueryResult<Row>;
  }

  private result(text: string, values: readonly unknown[]): ContactSqlQueryResult {
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase) return rows([{ authorized: 1 }]);
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) {
      const value = this.snapshots.get(Number(values[3]));
      return value === undefined ? rows([]) : rows([value]);
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readLatestVersion) {
      const latest = Math.max(0, ...this.snapshots.keys());
      return latest === 0 ? rows([]) : rows([{ input_version: latest }]);
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.insert) {
      this.snapshots.set(Number(values[3]), snapshotRow(values));
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM road_event_revision_ledger')) {
      return rows([{ revision: values[3] === 'CASE' ? 7 : 3, digest: values[3] === 'CASE' ? digest('b') : digest('c') }]);
    }
    if (text.includes('FROM road_events')) return rows([{ case_id: CASE_ID }]);
    if (text.includes('FROM ros_eye_contact_sessions')) return rows([]);
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return rows([]);
    if (text.includes('FROM evidence_objects')) return rows([evidenceRow(this.evidenceRecord)]);
    if (text.includes('FROM evidence_revision_ledger')) {
      return rows([{ revision: 9, digest: evidenceRevisionDigest(SCOPE, [this.evidenceRecord]) }]);
    }
    if (text.includes('FROM human_safety_indicator_revision_ledger')) {
      return rows([{ revision: this.indicatorRevision, indicator_set: this.indicators,
        digest: indicatorRevisionDigest(SCOPE, this.indicators) }]);
    }
    if (text.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')) return rows([]);
    throw new Error(`unexpected SQL: ${text}`);
  }
}

test('concrete PostgreSQL composition captures all five owners and a correction invalidates the prior binding', async () => {
  const pool = new IntegratedPool();
  const capture = createPostgresAuthoritativeInputSnapshotCaptureService(pool);
  assert.equal(await capture.capture({ ...SCOPE, inputVersion: 1, expectedPreviousInputVersion: 0,
    capturedAt: '2026-09-08T13:03:00.000Z' }), 'CREATED');

  const repository = new PostgresInputSnapshotRepository(pool);
  const first = await repository.read(SCOPE, 1);
  assert.ok(first);
  const recommendation = recommendationFor(first);
  const binding = bindingFor(recommendation, first);
  assert.equal(assessRecommendationSnapshotBinding(recommendation, first, binding, currentFrom(first)).status, 'VERIFIED');

  pool.indicatorRevision = 2;
  pool.indicators = [firstIndicator, correction];
  assert.equal(await capture.capture({ ...SCOPE, inputVersion: 2, expectedPreviousInputVersion: 1,
    capturedAt: '2026-09-08T13:04:00.000Z' }), 'CREATED');
  const corrected = await repository.read(SCOPE, 2);
  assert.ok(corrected);
  assert.deepEqual(assessRecommendationSnapshotBinding(recommendation, first, binding, currentFrom(corrected)), {
    status: 'INVALIDATED', reason: 'CURRENT_INPUT_CHANGED', sourceSnapshotDigest: first.snapshotDigest
  });
  assert.equal(pool.calls.some((sql) => /INSERT INTO .*recommendation/i.test(sql)), false);
});

function recommendationFor(snapshot: SafetyFusionInputSnapshot): SafetyFusionRecommendation {
  return {
    tenantId: snapshot.tenantId, caseId: snapshot.caseId, inputVersion: snapshot.inputVersion,
    evaluatedAt: '2026-09-08T13:03:01.000Z', currentSeverity: 'S3', recommendedSeverity: 'S3',
    score: 80, confidence: 0.8, uncertainty: 0.2, reasonCodes: [], missingEvidenceFlags: [],
    contributions: [], guardResults: [], requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY',
    autonomousDowngradePermitted: false, autonomousClosurePermitted: false, autonomousDispatchPermitted: false,
    policyVersion: 'ros-eye.safety-fusion.v1', ruleSetVersion: 'test.v1',
    thresholdVersion: 'ros-eye.safety-fusion.thresholds.v1', deterministicFingerprint: digest('f')
  };
}

function bindingFor(recommendation: SafetyFusionRecommendation, snapshot: SafetyFusionInputSnapshot): RecommendationSnapshotBinding {
  return {
    policyVersion: SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION, inputVersion: snapshot.inputVersion,
    recommendationFingerprint: recommendation.deterministicFingerprint, sourceSnapshotDigest: snapshot.snapshotDigest,
    boundAt: '2026-09-08T13:03:02.000Z'
  };
}

function currentFrom(snapshot: SafetyFusionInputSnapshot) {
  return {
    tenantId: snapshot.tenantId, caseId: snapshot.caseId, case: snapshot.case, severity: snapshot.severity,
    contact: snapshot.contact, evidence: snapshot.evidence, indicators: snapshot.indicators
  };
}

function rows(values: readonly ContactSqlRow[]): ContactSqlQueryResult { return { rows: values, rowCount: values.length }; }

function snapshotRow(value: readonly unknown[]): ContactSqlRow {
  return {
    tenant_id: value[0], purpose: value[1], case_id: value[2], input_version: value[3], policy_version: value[4],
    captured_at: value[5], case_revision: value[6], case_digest: value[7], severity_revision: value[8],
    severity_digest: value[9], contact_revision: value[10], contact_digest: value[11], evidence_revision: value[12],
    evidence_digest: value[13], indicator_revision: value[14], indicator_digest: value[15], snapshot_digest: value[16]
  };
}
