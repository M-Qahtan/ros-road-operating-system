import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresEvidenceRepository } from './postgres-evidence-repository.js';
import { evidenceRevisionDigest } from './evidence-revision.js';
import { EvidenceRecord } from './evidence-types.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from '../persistence/postgres/postgres-types.js';

const EVIDENCE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = 'tenant-riyadh';
const PURPOSE = 'road-safety-response';

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
  const client = new FakeClient((text) => {
    if (text.includes('FROM road_events')) return {
      rows: [{ tenant_id: TENANT_ID, purpose: PURPOSE, case_id: EVENT_ID }], rowCount: 1
    };
    if (text.includes('FROM evidence_objects') && text.includes('ORDER BY id')) return { rows: [], rowCount: 0 };
    if (text.includes('FROM evidence_revision_ledger')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresEvidenceRepository(new FakePool(client));
  await repository.create(record(), audit);
  assert.match(client.queries.find((query) => query.text.includes('FROM road_events'))!.text, /FOR UPDATE/);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO evidence_objects')), true);
  assert.equal(client.queries.some((query) => query.text.includes('INSERT INTO evidence_audit_logs')), true);
  const receipt = client.queries.find((query) => query.text.includes('INSERT INTO evidence_revision_ledger'))!;
  assert.deepEqual(receipt.values.slice(0, 4), [TENANT_ID, PURPOSE, EVENT_ID, 1]);
  assert.equal(client.released, true);
});

test('preservation locks pending metadata and appends audit in one transaction', async () => {
  const digest = evidenceRevisionDigest({ tenantId: TENANT_ID, purpose: PURPOSE, caseId: EVENT_ID }, [record()]);
  const client = new FakeClient((text) => {
    if (text.includes('SELECT road_event_id::text')) return { rows: [{ road_event_id: EVENT_ID }], rowCount: 1 };
    if (text.includes('FROM road_events')) return {
      rows: [{ tenant_id: TENANT_ID, purpose: PURPOSE, case_id: EVENT_ID }], rowCount: 1
    };
    if (text.includes('FROM evidence_objects') && text.includes('ORDER BY id')) return { rows: [row()], rowCount: 1 };
    if (text.includes('FROM evidence_revision_ledger')) return { rows: [{ revision: 1, digest }], rowCount: 1 };
    if (text.includes('FROM evidence_objects') && text.includes('FOR UPDATE')) return { rows: [row()], rowCount: 1 };
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
  assert.equal(client.queries.find((query) => query.text.includes('INSERT INTO evidence_revision_ledger'))!.values[3], 2);
  assert.equal(client.queries.at(-1)?.text, 'COMMIT');
});

test('download intent appends a durable access audit without mutating evidence metadata', async () => {
  const client = new FakeClient(() => ({ rows: [], rowCount: 1 }));
  const repository = new PostgresEvidenceRepository(new FakePool(client));
  await repository.appendAccessAudit(record(), {
    actorId: 'operator-a', traceId: 'trace-download-1',
    action: 'evidence.download_intent_created', occurredAt: new Date('2026-07-25T04:02:00.000Z')
  });
  assert.deepEqual(client.queries.map((query) => query.text.trim().split(/\s+/)[0]), ['BEGIN', 'INSERT', 'COMMIT']);
  assert.match(client.queries[1]!.text, /INSERT INTO evidence_audit_logs/);
  assert.equal(client.queries[1]!.values[3], 'evidence.download_intent_created');
  assert.equal(client.queries.some((query) => query.text.includes('UPDATE evidence_objects')), false);
});

test('missing or drifted Evidence receipt blocks integrity transition before metadata update', async () => {
  for (const ledgerRows of [[], [{ revision: 1, digest: 'f'.repeat(64) }]]) {
    const client = new FakeClient((text) => {
      if (text.includes('SELECT road_event_id::text')) return { rows: [{ road_event_id: EVENT_ID }], rowCount: 1 };
      if (text.includes('FROM road_events')) return {
        rows: [{ tenant_id: TENANT_ID, purpose: PURPOSE, case_id: EVENT_ID }], rowCount: 1
      };
      if (text.includes('FROM evidence_objects') && text.includes('ORDER BY id')) return { rows: [row()], rowCount: 1 };
      if (text.includes('FROM evidence_revision_ledger')) return { rows: ledgerRows, rowCount: ledgerRows.length };
      return { rows: [], rowCount: 1 };
    });
    const repository = new PostgresEvidenceRepository(new FakePool(client));
    await assert.rejects(
      () => repository.markPreserved(
        EVIDENCE_ID, 1024, 'a'.repeat(64), new Date('2026-07-25T04:01:00.000Z'),
        { ...audit, action: 'evidence.preserved' }
      ),
      /Evidence revision receipt/
    );
    assert.equal(client.queries.some((query) => query.text.startsWith('UPDATE evidence_objects')), false);
    assert.equal(client.queries.at(-1)?.text, 'ROLLBACK');
  }
});

test('transition rollback preserves the original failure', async () => {
  const digest = evidenceRevisionDigest({ tenantId: TENANT_ID, purpose: PURPOSE, caseId: EVENT_ID }, [record()]);
  const client = new FakeClient((text) => {
    if (text.includes('SELECT road_event_id::text')) return { rows: [{ road_event_id: EVENT_ID }], rowCount: 1 };
    if (text.includes('FROM road_events')) return {
      rows: [{ tenant_id: TENANT_ID, purpose: PURPOSE, case_id: EVENT_ID }], rowCount: 1
    };
    if (text.includes('FROM evidence_objects') && text.includes('ORDER BY id')) return { rows: [row()], rowCount: 1 };
    if (text.includes('FROM evidence_revision_ledger')) return { rows: [{ revision: 1, digest }], rowCount: 1 };
    if (text.includes('FROM evidence_objects') && text.includes('FOR UPDATE')) return { rows: [row()], rowCount: 1 };
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
