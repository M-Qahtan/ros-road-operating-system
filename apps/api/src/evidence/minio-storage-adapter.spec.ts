import assert from 'node:assert/strict';
import test from 'node:test';
import { MinioEvidenceStorageAdapter } from './minio-storage-adapter.js';

const NOW = new Date('2026-07-25T04:00:00.000Z');

function adapter(fetchImpl: typeof fetch = async () => new Response(null, { status: 200 })) {
  return new MinioEvidenceStorageAdapter({
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'ros-evidence',
    accessKeyId: 'ros-local',
    secretAccessKey: 'local-secret-password',
    now: () => new Date(NOW),
    fetchImpl
  });
}

test('upload request signs required content metadata with a short expiry', async () => {
  const request = await adapter().createUploadRequest(
    'road-events/event/evidence/id/frame.jpg',
    'image/jpeg',
    1024,
    'a'.repeat(64),
    new Date('2026-07-25T04:02:00.000Z')
  );
  const url = new URL(request.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.match(url.searchParams.get('X-Amz-SignedHeaders') ?? '', /content-length;content-type;host;x-amz-checksum-sha256/);
  assert.equal(request.requiredHeaders['content-length'], '1024');
  assert.equal(request.requiredHeaders['content-type'], 'image/jpeg');
  assert.equal(request.requiredHeaders['x-amz-checksum-sha256'], Buffer.from('a'.repeat(64), 'hex').toString('base64'));
});

test('signed request rejects expiry outside the safety bound', async () => {
  await assert.rejects(
    () => adapter().createDownloadRequest('object', new Date('2026-07-25T04:20:00.000Z')),
    RangeError
  );
});

test('inspect normalizes object metadata and checksum', async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, {
    status: 200,
    headers: {
      'content-length': '2048',
      'content-type': 'video/mp4',
      'x-amz-checksum-sha256': Buffer.from('b'.repeat(64), 'hex').toString('base64')
    }
  });
  const metadata = await adapter(fetchImpl).inspect('road-events/event/video.mp4');
  assert.deepEqual(metadata, { sizeBytes: 2048, contentType: 'video/mp4', checksumSha256: 'b'.repeat(64) });
});

test('quarantine copies before deleting the original object', async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ method: init?.method ?? 'GET', url: String(input) });
    return new Response(null, { status: 200 });
  };
  await adapter(fetchImpl).quarantine('road-events/event/evidence/id/file', 'quarantine/id');
  assert.deepEqual(requests.map((request) => request.method), ['PUT', 'DELETE']);
  assert.match(requests[0]!.url, /quarantine\/id/);
  assert.match(requests[1]!.url, /road-events\/event\/evidence\/id\/file/);
});
