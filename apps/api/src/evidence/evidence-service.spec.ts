import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EvidenceAccessDeniedError,
  EvidenceExpiredError,
  EvidenceIntegrityError,
  EvidenceObjectStorage,
  EvidenceRecord,
  EvidenceRepository,
  EvidenceUnavailableError,
  MalwareScanner,
  RoadEventEvidenceAuthorization,
  SignedObjectRequest,
  StoredObjectMetadata
} from './evidence-types.js';
import { EvidenceService } from './evidence-service.js';

const EVIDENCE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_A = '22222222-2222-4222-8222-222222222222';
const EVENT_B = '33333333-3333-4333-8333-333333333333';
const ACTOR_A = 'operator-a';
const ACTOR_B = 'operator-b';
const TRACE_ID = 'trace-evidence-1';
const CHECKSUM = 'a'.repeat(64);
const NOW = new Date('2026-07-25T04:00:00.000Z');

class MemoryRepository implements EvidenceRepository {
  readonly records = new Map<string, EvidenceRecord>();
  readonly audits: string[] = [];
  async create(record: EvidenceRecord, audit: { readonly action: string }): Promise<void> {
    this.records.set(record.id, record);
    this.audits.push(audit.action);
  }
  async findById(id: string): Promise<EvidenceRecord | undefined> { return this.records.get(id); }
  async markPreserved(
    id: string,
    actualSizeBytes: number,
    verifiedChecksumSha256: string,
    completedAt: Date,
    audit: { readonly action: string }
  ): Promise<EvidenceRecord> {
    const record = this.records.get(id)!;
    const updated: EvidenceRecord = {
      ...record,
      status: 'PRESERVED',
      actualSizeBytes,
      verifiedChecksumSha256,
      completedAt
    };
    this.records.set(id, updated);
    this.audits.push(audit.action);
    return updated;
  }
  async markQuarantined(
    id: string,
    reason: string,
    completedAt: Date,
    audit: { readonly action: string }
  ): Promise<EvidenceRecord> {
    const record = this.records.get(id)!;
    const updated: EvidenceRecord = { ...record, status: 'QUARANTINED', quarantineReason: reason, completedAt };
    this.records.set(id, updated);
    this.audits.push(audit.action);
    return updated;
  }
}

class MemoryStorage implements EvidenceObjectStorage {
  readonly uploadRequests: string[] = [];
  readonly downloadRequests: string[] = [];
  readonly quarantines: Array<{ source: string; target: string }> = [];
  metadata: StoredObjectMetadata | undefined;
  async createUploadRequest(objectKey: string, _type: string, _size: number, _checksum: string, expiresAt: Date): Promise<SignedObjectRequest> {
    this.uploadRequests.push(objectKey);
    return { url: `http://minio.local/${objectKey}?signed=upload`, expiresAt, requiredHeaders: {} };
  }
  async createDownloadRequest(objectKey: string, expiresAt: Date): Promise<SignedObjectRequest> {
    this.downloadRequests.push(objectKey);
    return { url: `http://minio.local/${objectKey}?signed=download`, expiresAt, requiredHeaders: {} };
  }
  async inspect(): Promise<StoredObjectMetadata | undefined> { return this.metadata; }
  async quarantine(source: string, target: string): Promise<void> { this.quarantines.push({ source, target }); }
}

class MemoryAuthorization implements RoadEventEvidenceAuthorization {
  constructor(private readonly grants: ReadonlyMap<string, readonly string[]>) {}
  async canAccess(actorId: string, roadEventId: string): Promise<boolean> {
    return this.grants.get(actorId)?.includes(roadEventId) ?? false;
  }
}

class ConfigurableScanner implements MalwareScanner {
  constructor(private readonly result: Awaited<ReturnType<MalwareScanner['scan']>>) {}
  async scan(): Promise<Awaited<ReturnType<MalwareScanner['scan']>>> { return this.result; }
}

function createHarness(scannerResult: Awaited<ReturnType<MalwareScanner['scan']>> = { outcome: 'CLEAN' }) {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const authorization = new MemoryAuthorization(new Map([
    [ACTOR_A, [EVENT_A]],
    [ACTOR_B, [EVENT_B]]
  ]));
  const service = new EvidenceService(repository, storage, new ConfigurableScanner(scannerResult), authorization, {
    now: () => new Date(NOW),
    createId: () => EVIDENCE_ID,
    uploadTtlMs: 120_000,
    downloadTtlMs: 60_000
  });
  return { repository, storage, service };
}

async function createIntent(harness: ReturnType<typeof createHarness>) {
  return harness.service.createUploadIntent({
    roadEventId: EVENT_A,
    actorId: ACTOR_A,
    traceId: TRACE_ID,
    filename: '../camera frame.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    checksumSha256: CHECKSUM,
    retention: { retainUntil: new Date('2027-07-25T00:00:00.000Z'), legalHold: false }
  });
}

test('upload intent sanitizes filename, binds RoadEvent and returns a short-lived signed request', async () => {
  const harness = createHarness();
  const result = await createIntent(harness);
  assert.equal(result.evidence.id, EVIDENCE_ID);
  assert.equal(result.evidence.roadEventId, EVENT_A);
  assert.equal(result.evidence.originalFilename, 'camera_frame.jpg');
  assert.match(result.evidence.objectKey, new RegExp(`road-events/${EVENT_A}/evidence/${EVIDENCE_ID}/camera_frame.jpg$`));
  assert.equal(result.upload.expiresAt.toISOString(), '2026-07-25T04:02:00.000Z');
  assert.deepEqual(harness.repository.audits, ['evidence.upload_intent_created']);
});

test('completion verifies object metadata and checksum before preservation', async () => {
  const harness = createHarness();
  await createIntent(harness);
  harness.storage.metadata = { sizeBytes: 1024, contentType: 'image/jpeg', checksumSha256: CHECKSUM };
  const completed = await harness.service.completeUpload(EVIDENCE_ID, ACTOR_A, TRACE_ID);
  assert.equal(completed.status, 'PRESERVED');
  assert.equal(completed.actualSizeBytes, 1024);
  assert.equal(completed.verifiedChecksumSha256, CHECKSUM);
  assert.deepEqual(harness.repository.audits, ['evidence.upload_intent_created', 'evidence.preserved']);
});

test('expired intent is rejected before object completion', async () => {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const authorization = new MemoryAuthorization(new Map([[ACTOR_A, [EVENT_A]]]));
  const clock = { now: new Date(NOW) };
  const service = new EvidenceService(repository, storage, new ConfigurableScanner({ outcome: 'CLEAN' }), authorization, {
    now: () => new Date(clock.now), createId: () => EVIDENCE_ID, uploadTtlMs: 1000
  });
  await service.createUploadIntent({
    roadEventId: EVENT_A, actorId: ACTOR_A, traceId: TRACE_ID, filename: 'frame.jpg',
    contentType: 'image/jpeg', sizeBytes: 1024, checksumSha256: CHECKSUM,
    retention: { retainUntil: new Date('2027-01-01T00:00:00.000Z'), legalHold: false }
  });
  storage.metadata = { sizeBytes: 1024, contentType: 'image/jpeg', checksumSha256: CHECKSUM };
  clock.now = new Date('2026-07-25T04:00:02.000Z');
  await assert.rejects(() => service.completeUpload(EVIDENCE_ID, ACTOR_A, TRACE_ID), EvidenceExpiredError);
});

test('tampered size, type or checksum is rejected', async () => {
  for (const metadata of [
    { sizeBytes: 2048, contentType: 'image/jpeg', checksumSha256: CHECKSUM },
    { sizeBytes: 1024, contentType: 'image/png', checksumSha256: CHECKSUM },
    { sizeBytes: 1024, contentType: 'image/jpeg', checksumSha256: 'b'.repeat(64) }
  ]) {
    const harness = createHarness();
    await createIntent(harness);
    harness.storage.metadata = metadata;
    await assert.rejects(() => harness.service.completeUpload(EVIDENCE_ID, ACTOR_A, TRACE_ID), EvidenceIntegrityError);
  }
});

test('malicious or scanner-error objects are quarantined while metadata remains queryable', async () => {
  for (const scannerResult of [
    { outcome: 'MALICIOUS', reason: 'test signature' } as const,
    { outcome: 'ERROR', reason: 'scanner unavailable' } as const
  ]) {
    const harness = createHarness(scannerResult);
    const intent = await createIntent(harness);
    harness.storage.metadata = { sizeBytes: 1024, contentType: 'image/jpeg', checksumSha256: CHECKSUM };
    const completed = await harness.service.completeUpload(EVIDENCE_ID, ACTOR_A, TRACE_ID);
    assert.equal(completed.status, 'QUARANTINED');
    assert.equal((await harness.repository.findById(EVIDENCE_ID))?.objectKey, intent.evidence.objectKey);
    assert.equal(harness.storage.quarantines.length, 1);
    await assert.rejects(() => harness.service.createDownloadRequest(EVIDENCE_ID, ACTOR_A), EvidenceUnavailableError);
  }
});

test('cross-event access is rejected for completion and download', async () => {
  const harness = createHarness();
  await createIntent(harness);
  harness.storage.metadata = { sizeBytes: 1024, contentType: 'image/jpeg', checksumSha256: CHECKSUM };
  await assert.rejects(() => harness.service.completeUpload(EVIDENCE_ID, ACTOR_B, TRACE_ID), EvidenceAccessDeniedError);
  await harness.service.completeUpload(EVIDENCE_ID, ACTOR_A, TRACE_ID);
  await assert.rejects(() => harness.service.createDownloadRequest(EVIDENCE_ID, ACTOR_B), EvidenceAccessDeniedError);
  const download = await harness.service.createDownloadRequest(EVIDENCE_ID, ACTOR_A);
  assert.match(download.url, /signed=download/);
});
