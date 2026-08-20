import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsJwksDocumentFetcher, JwksHttpFetchPort } from './jwks-https-fetcher.js';

function response(
  body: BodyInit | null,
  options: { readonly status?: number; readonly contentType?: string; readonly contentLength?: string } = {}
): Response {
  const headers = new Headers({ 'content-type': options.contentType ?? 'application/jwk-set+json' });
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return new Response(body, { status: options.status ?? 200, headers });
}

test('fetches exact HTTPS JWKS URL with redirects disabled', async () => {
  const calls: Array<{ readonly url: string; readonly redirect: string; readonly accept: string | undefined }> = [];
  const fakeFetch: JwksHttpFetchPort = async (url, init) => {
    calls.push({ url, redirect: init.redirect, accept: init.headers.accept });
    return response('{"keys":[{"kty":"RSA"}]}');
  };
  const fetcher = new HttpsJwksDocumentFetcher('https://identity.example.test/.well-known/jwks.json', {
    fetch: fakeFetch,
    timeoutMs: 500,
    maximumBodyBytes: 4_096
  });
  assert.deepEqual(await fetcher.fetchJwks(), { keys: [{ kty: 'RSA' }] });
  assert.deepEqual(calls, [{
    url: 'https://identity.example.test/.well-known/jwks.json',
    redirect: 'error',
    accept: 'application/jwk-set+json, application/json'
  }]);
});

test('constructor rejects non-HTTPS credential-bearing and fragment URLs', () => {
  assert.throws(() => new HttpsJwksDocumentFetcher('http://identity.example.test/jwks'), /must use HTTPS/);
  assert.throws(() => new HttpsJwksDocumentFetcher('https://user:pass@identity.example.test/jwks'), /must not contain credentials/);
  assert.throws(() => new HttpsJwksDocumentFetcher('https://identity.example.test/jwks#fragment'), /must not contain a fragment/);
});

test('fails closed on request errors non-success responses and non-JSON content', async () => {
  const outage = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => { throw new Error('network unavailable'); }
  });
  await assert.rejects(outage.fetchJwks(), /HTTPS request failed/);

  const unavailable = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('{}', { status: 503 })
  });
  await assert.rejects(unavailable.fetchJwks(), /status 503/);

  const html = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('<html/>', { contentType: 'text/html' })
  });
  await assert.rejects(html.fetchJwks(), /must be JSON/);
});

test('rejects declared body length above configured bound before consuming body', async () => {
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      started = true;
      controller.enqueue(Buffer.from('{}'));
      controller.close();
    }
  });
  const fetcher = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    maximumBodyBytes: 10,
    fetch: async () => response(stream, { contentLength: '11' })
  });
  await assert.rejects(fetcher.fetchJwks(), /size limit/);
  assert.equal(started, true);
});

test('cancels chunked response while streaming once actual bytes cross configured bound', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"keys":'));
      controller.enqueue(encoder.encode('12345678901234567890'));
    },
    cancel() { cancelled = true; }
  });
  const fetcher = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    maximumBodyBytes: 10,
    fetch: async () => response(stream)
  });
  await assert.rejects(fetcher.fetchJwks(), /size limit/);
  assert.equal(cancelled, true);
});

test('rejects malformed JSON instead of passing untrusted document downstream', async () => {
  const fetcher = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('{not-json}')
  });
  await assert.rejects(fetcher.fetchJwks(), /not valid JSON/);
});
