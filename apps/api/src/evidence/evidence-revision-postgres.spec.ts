import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContactSqlConnectionPort, ContactSqlQueryResult, ContactSqlRow } from '../ros-eye/contact-orchestration-postgres.js';
import { PostgresEvidenceRevisionSource } from './evidence-revision-source-postgres.js';
import { evidenceRevisionDigest } from './evidence-revision.js';
import type { EvidenceRecord } from './evidence-types.js';

const CASE_ID = '22222222-2222-4222-8222-222222222222';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
type Handler = (text: string, values: readonly unknown[]) => ContactSqlQueryResult;

class FakeSql implements ContactSqlConnectionPort {
  readonly queries: CapturedQuery[] = [];
  constructor(private readonly handler: Handler) {}
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text, values) as ContactSqlQueryResult<Row>;
  }
}

function evidence(status: EvidenceRecord['status'] = 'PENDING_UPLOAD'): EvidenceRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    roadEventId: CASE_ID,
    objectKey: `road-events/${CASE_ID}/evidence/11111111-1111-4111-8111-111111111111/frame.jpg`,
    originalFilename: 'frame.jpg',
    contentType: 'image/jpeg',
    declaredSizeBytes: 1024,
    ...(status === 'PRESERVED' ? { actualSizeBytes: 1024 } : {}),
    declaredChecksumSha256: 'a'.repeat(64),
    ...(status === 'PRESERVED' ? { verifiedChecksumSha256: 'a'.repeat(64) } : {}),
    status,
    uploadExpiresAt: new Date('2026-09-08T11:10:00.000Z'),
    retention: { retainUntil: new Date('2027-09-08T11:00:00.000Z'), legalHold: false },
    createdBy: 'operator-a',
    createdAt: new Date('2026-09-08T11:00:00.000Z'),
    ...(status === 'PRESERVED' ? { completedAt: new Date('2026-09-08T11:01:00.000Z') } : {})
  };
}

function row(record: EvidenceRecord): ContactSqlRow {
  return {
    id: record.id, road_event_id: record.roadEventId, object_key: record.objectKey,
    original_filename: record.originalFilename, content_type: record.contentType,
    declared_size_bytes: record.declaredSizeBytes, actual_size_bytes: record.actualSizeBytes ?? null,
    declared_checksum_sha256: record.declaredChecksumSha256,
    verified_checksum_sha256: record.verifiedChecksumSha256 ?? null, status: record.status,
    upload_expires_at: record.uploadExpiresAt, retain_until: record.retention.retainUntil,
    legal_hold: record.retention.legalHold, created_by: record.createdBy, created_at: record.createdAt,
    completed_at: record.completedAt ?? null, quarantine_reason: record.quarantineReason ?? null
  };
}

test('Evidence digest changes when integrity state changes and ignores input ordering', () => {
  const pending = evidence();
  const other = { ...pending, id: '33333333-3333-4333-8333-333333333333', objectKey: `${pending.objectKey}-other` };
  assert.equal(evidenceRevisionDigest(SCOPE, [pending, other]), evidenceRevisionDigest(SCOPE, [other, pending]));
  assert.notEqual(evidenceRevisionDigest(SCOPE, [pending]), evidenceRevisionDigest(SCOPE, [evidence('PRESERVED')]));
});

test('source returns SOURCE_LEDGER receipt only when all authoritative evidence matches', async () => {
  const current = evidence('PRESERVED');
  const digest = evidenceRevisionDigest(SCOPE, [current]);
  const sql = new FakeSql((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
    if (text.includes('FROM evidence_objects')) return { rows: [row(current)], rowCount: 1 };
    if (text.includes('FROM evidence_revision_ledger')) return { rows: [{ revision: 2, digest }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  assert.deepEqual(await new PostgresEvidenceRevisionSource().load(sql, SCOPE), {
    authority: 'SOURCE_LEDGER', revision: 2, digest
  });
  assert.deepEqual(sql.queries[0]?.values, [SCOPE.tenantId, SCOPE.purpose, CASE_ID]);
});

test('source fails closed for missing receipt and digest drift', async () => {
  const current = evidence();
  for (const ledgerRows of [[], [{ revision: 1, digest: 'f'.repeat(64) }]]) {
    const sql = new FakeSql((text) => {
      if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
      if (text.includes('FROM evidence_objects')) return { rows: [row(current)], rowCount: 1 };
      if (text.includes('FROM evidence_revision_ledger')) return { rows: ledgerRows, rowCount: ledgerRows.length };
      return { rows: [], rowCount: 0 };
    });
    if (ledgerRows.length === 0) assert.equal(await new PostgresEvidenceRevisionSource().load(sql, SCOPE), null);
    else await assert.rejects(() => new PostgresEvidenceRevisionSource().load(sql, SCOPE), /does not match/);
  }
});

test('source does not invent a revision for empty evidence and rejects orphan ledger state', async () => {
  for (const ledgerRows of [[], [{ revision: 1, digest: 'a'.repeat(64) }]]) {
    const sql = new FakeSql((text) => {
      if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
      if (text.includes('FROM evidence_objects')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM evidence_revision_ledger')) return { rows: ledgerRows, rowCount: ledgerRows.length };
      return { rows: [], rowCount: 0 };
    });
    if (ledgerRows.length === 0) assert.equal(await new PostgresEvidenceRevisionSource().load(sql, SCOPE), null);
    else await assert.rejects(() => new PostgresEvidenceRevisionSource().load(sql, SCOPE), /without authoritative evidence/);
  }
});

test('cross-purpose scope is hidden before evidence metadata is read', async () => {
  const sql = new FakeSql(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await new PostgresEvidenceRevisionSource().load(sql, { ...SCOPE, purpose: 'other-purpose' }), null);
  assert.equal(sql.queries.length, 1);
});
