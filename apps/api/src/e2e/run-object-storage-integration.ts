import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEvidenceObjectStorageForRuntime } from '../evidence/object-storage-runtime.js';

const OBJECT_KEY = 'road-events/runtime-proof/evidence/object-storage-proof.json';
const QUARANTINE_KEY = 'quarantine/runtime-proof/object-storage-proof.json';
const CONTENT_TYPE = 'application/json';
const BODY = JSON.stringify({ source: 'ros-object-storage-integration', safe: true });
const CHECKSUM = createHash('sha256').update(BODY, 'utf8').digest('hex');

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${operation} failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return response;
}

async function run(): Promise<void> {
  const storage = createEvidenceObjectStorageForRuntime(process.env);
  const upload = await storage.createUploadRequest(
    OBJECT_KEY,
    CONTENT_TYPE,
    Buffer.byteLength(BODY, 'utf8'),
    CHECKSUM,
    new Date(Date.now() + 120_000)
  );

  await requireOk(await fetch(upload.url, {
    method: 'PUT',
    headers: { ...upload.requiredHeaders },
    body: BODY
  }), 'presigned PUT');

  const metadata = await storage.inspect(OBJECT_KEY);
  assert.deepEqual(metadata, {
    sizeBytes: Buffer.byteLength(BODY, 'utf8'),
    contentType: CONTENT_TYPE,
    checksumSha256: CHECKSUM
  });

  const download = await storage.createDownloadRequest(OBJECT_KEY, new Date(Date.now() + 120_000));
  const downloaded = await requireOk(await fetch(download.url), 'presigned GET');
  assert.equal(await downloaded.text(), BODY);

  await storage.quarantine(OBJECT_KEY, QUARANTINE_KEY);
  assert.equal(await storage.inspect(OBJECT_KEY), undefined);
  const quarantined = await storage.inspect(QUARANTINE_KEY);
  assert.ok(quarantined !== undefined);
  assert.equal(quarantined.sizeBytes, Buffer.byteLength(BODY, 'utf8'));
  assert.equal(quarantined.contentType, CONTENT_TYPE);
  assert.equal(quarantined.checksumSha256, CHECKSUM);

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    uploadChecksumVerified: true,
    downloadVerified: true,
    quarantineCopyVerified: true,
    originalRemoved: true
  }) + '\n');
}

await run();
