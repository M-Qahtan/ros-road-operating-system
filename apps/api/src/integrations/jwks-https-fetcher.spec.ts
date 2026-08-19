import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HttpsJwksDocumentFetcher,
  JwksHttpFetchPort,
  JwksHttpResponsePort
} from './jwks-https-fetcher.js';

function response(
  body: string,
  options: { readonly ok?: boolean; readonly status?: number; readonly contentType?: string; readonly contentLength?: string } = {}
): JwksHttpResponsePort {
  const headers = new Map<string, string>();
  headers.set('content-type', options.contentType ?? 'application/jwk-set+json');
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body
  };
}

test('fetches the exact configured HTTPS JWKS URL with redirects disabled', async () => {
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

test('constructor rejects non-HTTPS, credential-bearing and fragment URLs', () => {
  assert.throws(() => new HttpsJwksDocumentFetcher('http://identity.example.test/jwks'), /must use HTTPS/);
  assert.throws(() => new HttpsJwksDocumentFetcher('https://user:pass@identity.example.test/jwks'), /must not contain credentials/);
  assert.throws(() => new HttpsJwksDocumentFetcher('https://identity.example.test/jwks#fragment'), /must not contain a fragment/);
});

test('fails closed on request errors, non-success responses and non-JSON content', async () => {
  const outage = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => { throw new Error('network unavailable'); }
  });
  await assert.rejects(outage.fetchJwks(), /HTTPS request failed/);

  const unavailable = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('{}', { ok: false, status: 503 })
  });
  await assert.rejects(unavailable.fetchJwks(), /status 503/);

  const html = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('<html/>', { contentType: 'text/html' })
  });
  await assert.rejects(html.fetchJwks(), /must be JSON/);
});

test('enforces response size limits from headers and actual bytes', async () => {
  const declaredLarge = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    maximumBodyBytes: 10,
    fetch: async () => response('{}', { contentLength: '11' })
  });
  await assert.rejects(declaredLarge.fetchJwks(), /size limit/);

  const actualLarge = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    maximumBodyBytes: 10,
    fetch: async () => response('{"keys":[]}')
  });
  await assert.rejects(actualLarge.fetchJwks(), /size limit/);
});

test('rejects malformed JSON instead of passing an untrusted document downstream', async () => {
  const fetcher = new HttpsJwksDocumentFetcher('https://identity.example.test/jwks', {
    fetch: async () => response('{not-json}')
  });
  await assert.rejects(fetcher.fetchJwks(), /not valid JSON/);
});
