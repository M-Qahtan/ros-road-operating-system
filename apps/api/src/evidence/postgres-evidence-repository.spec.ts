import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresEvidenceRepository } from './postgres-evidence-repository.js';
import { EvidenceRecord } from './evidence-types.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';

const EVIDENCE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
class FakeClient implements PostgresClient {
  readonly queries: CapturedQuery[] = [];
  released = false;
  constructor(private readonly handler: (text: string) => PostgresQueryResult<unknown>) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text) as PostgresQueryResult<Row>;
  }
  release(): void { this.released = true; }
}
class FakePool implements PostgresPool {
  constructor(private readonly client: FakeClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

function record(): EvidenceRecord {
  return {
    id: EVIDENCE_ID,
    roadEventId: EVENT_ID,
    objectKey: `road-events/${EVENT_ID}/evidence/${EVIDENCE_ID}/frame.jpg`,
    originalFilename: 'frame.jpg',
    contentType: 'image/jpeg',
    declaredSizeBytes: 1024,
    declaredChecksumSha256: 'a'.repeat(64),
    status: 'PENDING_UPLOAD',
    uploadExpiresAt: new Date('2026-07-25T04:10:00.000Z'),
    retention: { retainUntil: new Date('2027-07-25T00:00:00.000Z'), legalHold: false },
    createdBy: 'operator-a',
    createdAt: new Date('2026-07-25T04:00:00.000Z')
  };
}

function row(status: EvidenceRecord['status'] = 'PENDING_UPLOAD') {
  return {
    id: EVIDENCE_ID,
    road_event_id: EVENT_ID,
    object_key: `road-events/${EVENT_ID}/evidence/${EVIDENCE_ID}/frame.jpg`,
    original_filename: 'frame.jpg',
    content_type: 'image/jpeg',
    declared_size_bytes: '1024',
    actual_size_bytes: status === 'PRESERVED' ? '1024' : null,
    declared_checksum_sha256: 'a'.repeat(64),
    verified_checksum_sha256: status === 'PRESERVED' ? 'a'.repeat(64) : null,
    status,
    upload_expires_at: '2026-07-25T04:10:00.000Z',
    retain_until: '2027-07-25T00:00:00.000Z',
    legal_hold: false,
    created_by: 'operator-a',
    created_at: '2026-07-25T04:00:00.000Z',
    completed_at: status === 'PENDING_UPLOAD' ? null : '2026-07-25T04:01:00.000Z',
    quarantine_reason: null
  };
}

const audit = { actorId: 'operator-a', traceId: 'trace-1', action: 'evidence.upload_intent_created' } as const;

test('create stores metadata and audit atomically', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const repository = new PostgresEvidenceRepository(new FakePool(client));
  await repository.create(record(), audit);
  assert.deepEqual(client.queries.map((query) => query.text.trim().split(/\s+/)[0]), ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
  assert.match(client.queries[1]!.text, /INSERT INTO evidence_objects/);
  assert.match(client.queries[2]!.text, /INSERT INTO evidence_audit_logs/);
  assert.equal(client.released, true);
});

test('preservation locks pending metadata and appends audit in one transaction', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [row()], rowCount: 1 };
    if (text.startsWith('UPDATE evidence_objects')) return { rows: [row('PRESERVED')], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresEvidenceRepository(new FakePool(client));
  const completed = await repository.markPreserved(
    EVIDENCE_ID,
    1024,
    'a'.repeat(64),
    new Date('2026-07-25T04:01:00.000Z'),
    { ...audit, action: 'evidence.preserved' }
  );
  assert.equal(completed.status, 'PRESERVED');
  assert.equal(client.queries.some((query) => query.text.includes('FOR UPDATE')), true);
  assert.equal(client.queries.some((query) => query.text.includes("status = 'PENDING_UPLOAD'")), true);
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
});

test('transition rollback preserves the original failure', async () => {
  const client = new FakeClient((text) => {
    if (text.includes('FOR UPDATE')) return { rows: [row()], rowCount: 1 };
    if (text.startsWith('UPDATE evidence_objects')) throw new Error('database failure');
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresEvidenceRepository(new FakePool(client));
  await assert.rejects(
    () => repository.markQuarantined(EVIDENCE_ID, 'scanner failure', new Date(), { ...audit, action: 'evidence.quarantined' }),
    /database failure/
  );
  assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
});
