import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import {
  CachedJwksRs256KeyProvider,
  JwksDocumentFetcherPort,
  JwksProviderError
} from './jwks-key-provider.js';

function jwkFor(key: KeyObject, kid: string): Readonly<Record<string, unknown>> {
  const exported = key.export({ format: 'jwk' });
  return { ...exported, kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] };
}

class ScriptedFetcher implements JwksDocumentFetcherPort {
  calls = 0;
  constructor(private readonly responses: Array<unknown | Error>) {}
  async fetchJwks(): Promise<unknown> {
    this.calls += 1;
    const response = this.responses.shift();
    if (response === undefined) throw new Error('No scripted JWKS response remains');
    if (response instanceof Error) throw response;
    return response;
  }
}

const key1 = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
const key2 = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
const document = (...keys: Readonly<Record<string, unknown>>[]) => ({ keys });

test('caches a trusted RS256 key without refetching inside TTL', async () => {
  let now = 1_800_000_000;
  const fetcher = new ScriptedFetcher([document(jwkFor(key1, 'key-1'))]);
  const provider = new CachedJwksRs256KeyProvider(fetcher, { cacheTtlSeconds: 60, minimumRefreshIntervalSeconds: 5, nowEpochSeconds: () => now });
  const first = await provider.resolveRs256PublicKey('key-1');
  now += 30;
  assert.equal(await provider.resolveRs256PublicKey('key-1'), first);
  assert.equal(fetcher.calls, 1);
});

test('unknown kid triggers bounded refresh and authoritative rotation revokes removed key', async () => {
  let now = 1_800_000_000;
  const fetcher = new ScriptedFetcher([document(jwkFor(key1, 'key-1')), document(jwkFor(key2, 'key-2'))]);
  const provider = new CachedJwksRs256KeyProvider(fetcher, { cacheTtlSeconds: 300, minimumRefreshIntervalSeconds: 10, nowEpochSeconds: () => now });
  assert.ok(await provider.resolveRs256PublicKey('key-1'));
  now += 11;
  assert.ok(await provider.resolveRs256PublicKey('key-2'));
  assert.equal(fetcher.calls, 2);
  assert.equal(await provider.resolveRs256PublicKey('key-1'), undefined);
  assert.equal(fetcher.calls, 2);
});

test('expired cache fails closed when JWKS refresh is unavailable', async () => {
  let now = 1_800_000_000;
  const fetcher = new ScriptedFetcher([document(jwkFor(key1, 'key-1')), new Error('identity provider unavailable')]);
  const provider = new CachedJwksRs256KeyProvider(fetcher, { cacheTtlSeconds: 30, minimumRefreshIntervalSeconds: 5, nowEpochSeconds: () => now });
  assert.ok(await provider.resolveRs256PublicKey('key-1'));
  now += 31;
  await assert.rejects(provider.resolveRs256PublicKey('key-1'), (error: unknown) => error instanceof JwksProviderError && /refusing stale/.test(error.message));
  assert.equal(fetcher.calls, 2);
});

test('rejects duplicate kids and malformed eligible RSA keys', async () => {
  const duplicateProvider = new CachedJwksRs256KeyProvider(new ScriptedFetcher([
    document(jwkFor(key1, 'dup'), jwkFor(key2, 'dup'))
  ]), { cacheTtlSeconds: 60, nowEpochSeconds: () => 1_800_000_000 });
  await assert.rejects(duplicateProvider.resolveRs256PublicKey('dup'), /duplicate kid/);

  const malformedProvider = new CachedJwksRs256KeyProvider(new ScriptedFetcher([
    document({ kid: 'bad', kty: 'RSA', alg: 'RS256', use: 'sig', n: '***', e: 'AQAB' })
  ]), { cacheTtlSeconds: 60, nowEpochSeconds: () => 1_800_000_000 });
  await assert.rejects(malformedProvider.resolveRs256PublicKey('bad'), /canonical base64url/);
});

test('ignores keys that are not eligible for RS256 signature verification', async () => {
  const provider = new CachedJwksRs256KeyProvider(new ScriptedFetcher([
    document({ ...jwkFor(key1, 'enc-key'), use: 'enc' }, jwkFor(key2, 'verify-key'))
  ]), { cacheTtlSeconds: 60, minimumRefreshIntervalSeconds: 5, nowEpochSeconds: () => 1_800_000_000 });
  assert.ok(await provider.resolveRs256PublicKey('verify-key'));
  assert.equal(await provider.resolveRs256PublicKey('enc-key'), undefined);
});
