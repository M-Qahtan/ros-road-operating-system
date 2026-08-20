import assert from 'node:assert/strict';
import test from 'node:test';
import { MinioEvidenceStorageAdapter } from './minio-storage-adapter.js';

const NOW = new Date('2026-07-25T04:00:00.000Z');

function adapter(
  fetchImpl: typeof fetch = async () => new Response(null, { status: 200 }),
  overrides: Partial<ConstructorParameters<typeof MinioEvidenceStorageAdapter>[0]> = {}
) {
  return new MinioEvidenceStorageAdapter({
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'ros-evidence',
    accessKeyId: 'ros-local',
    secretAccessKey: 'local-secret-password',
    now: () => new Date(NOW),
    fetchImpl,
    ...overrides
  });
}

function metadataHeaders(checksumHex: string) {
  return {
    'content-length': '2048',
    'content-type': 'application/json',
    'x-amz-checksum-sha256': Buffer.from(checksumHex, 'hex').toString('base64')
  };
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

test('temporary credentials include the session token in the canonical presigned query', async () => {
  const request = await adapter(undefined, {
    sessionToken: 'temporary-session-token-material'
  }).createDownloadRequest(
    'road-events/event/evidence/id/frame.jpg',
    new Date('2026-07-25T04:01:00.000Z')
  );
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('X-Amz-Security-Token'), 'temporary-session-token-material');
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
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

test('quarantine verifies destination metadata and checksum before deleting the original object', async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const checksum = 'c'.repeat(64);
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, url: String(input) });
    if (method === 'HEAD') return new Response(null, { status: 200, headers: metadataHeaders(checksum) });
    return new Response(null, { status: 200 });
  };

  await adapter(fetchImpl).quarantine('road-events/event/evidence/id/file', 'quarantine/id');

  assert.deepEqual(requests.map((request) => request.method), ['HEAD', 'PUT', 'HEAD', 'DELETE']);
  assert.match(requests[0]!.url, /road-events\/event\/evidence\/id\/file/);
  assert.match(requests[1]!.url, /quarantine\/id/);
  assert.match(requests[2]!.url, /quarantine\/id/);
  assert.match(requests[3]!.url, /road-events\/event\/evidence\/id\/file/);
});

test('quarantine retains the original when copied evidence metadata does not match', async () => {
  const requests: string[] = [];
  let headCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const method = init?.method ?? 'GET';
    requests.push(method);
    if (method === 'HEAD') {
      headCount += 1;
      const checksum = headCount === 1 ? 'c'.repeat(64) : 'd'.repeat(64);
      return new Response(null, { status: 200, headers: metadataHeaders(checksum) });
    }
    return new Response(null, { status: 200 });
  };

  await assert.rejects(
    adapter(fetchImpl).quarantine('road-events/event/evidence/id/file', 'quarantine/id'),
    /verification failed; original object was retained/
  );
  assert.deepEqual(requests, ['HEAD', 'PUT', 'HEAD']);
});

test('rejects unsafe object-key path segments and endpoint decorations', async () => {
  await assert.rejects(
    adapter().createDownloadRequest('road-events/../secret', new Date('2026-07-25T04:01:00.000Z')),
    /unsafe path segment/
  );
  assert.throws(
    () => adapter(undefined, { endpoint: 'http://user:pass@127.0.0.1:9000' }),
    /must not contain credentials/
  );
  assert.throws(
    () => adapter(undefined, { endpoint: 'http://127.0.0.1:9000?debug=true' }),
    /must not contain credentials, query parameters or a fragment/
  );
});

test('rejects malformed temporary session credentials', () => {
  assert.throws(
    () => adapter(undefined, { sessionToken: 'short' }),
    /session token is invalid/
  );
});
