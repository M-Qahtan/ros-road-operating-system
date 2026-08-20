import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CallbackAuthenticationError,
  CallbackHmacKey,
  CallbackHmacKeyProvider,
  CallbackPrincipalBinding,
  CallbackReplayStore,
  VerifyCallbackInput,
  computeCallbackSignatureHex,
  verifyCallbackHmac
} from './callback-auth.js';

const NOW = 1_800_000_000;
const BINDING: CallbackPrincipalBinding = {
  clientId: 'traffic-sandbox',
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION'
};
const OTHER_BINDING: CallbackPrincipalBinding = {
  clientId: 'insurance-sandbox',
  tenantId: 'riyadh-pilot',
  purpose: 'INSURANCE_COORDINATION'
};
const OLD_SECRET = 'old-test-only-0123456789abcdef0123456789abcdef';
const NEW_SECRET = 'new-test-only-0123456789abcdef0123456789abcdef';

class MemoryReplayStore implements CallbackReplayStore {
  private readonly claimed = new Set<string>();
  async claim(
    binding: CallbackPrincipalBinding,
    _keyId: string,
    nonce: string,
    _expiresAtEpochSeconds: number
  ): Promise<boolean> {
    const id = JSON.stringify([binding.clientId, binding.tenantId, binding.purpose, nonce]);
    if (this.claimed.has(id)) return false;
    this.claimed.add(id);
    return true;
  }
}

class MemoryKeyProvider implements CallbackHmacKeyProvider {
  constructor(private readonly keys: Readonly<Record<string, CallbackHmacKey>>) {}
  async resolve(binding: CallbackPrincipalBinding, keyId: string): Promise<CallbackHmacKey | undefined> {
    if (
      binding.clientId !== BINDING.clientId ||
      binding.tenantId !== BINDING.tenantId ||
      binding.purpose !== BINDING.purpose
    ) return undefined;
    return this.keys[keyId];
  }
}

const keyProvider = new MemoryKeyProvider({
  'key-old': { secret: OLD_SECRET, validFromEpochSeconds: NOW - 600, validUntilEpochSeconds: NOW + 60 },
  'key-new': { secret: NEW_SECRET, validFromEpochSeconds: NOW - 60, validUntilEpochSeconds: NOW + 3600 }
});

function signedInput(
  overrides: Partial<Omit<VerifyCallbackInput, 'signatureHex'>> = {},
  secret = NEW_SECRET
): VerifyCallbackInput {
  const unsigned: Omit<VerifyCallbackInput, 'signatureHex'> = {
    binding: BINDING,
    keyId: 'key-new',
    body: '{"status":"accepted"}',
    nonce: 'nonce-abcdefghijklmnop',
    timestampEpochSeconds: NOW,
    ...overrides
  };
  return { ...unsigned, signatureHex: computeCallbackSignatureHex(secret, unsigned) };
}

test('accepts a fresh bound callback exactly once', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput();
  await verifyCallbackHmac(input, keyProvider, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(input, keyProvider, store, { nowEpochSeconds: NOW }),
    /already been used for this principal/
  );
});

test('rejects body binding and key-id tampering', async () => {
  const store = new MemoryReplayStore();
  const signed = signedInput();
  await assert.rejects(
    verifyCallbackHmac({ ...signed, body: '{"status":"rejected"}' }, keyProvider, store, { nowEpochSeconds: NOW }),
    /signature verification failed/
  );
  await assert.rejects(
    verifyCallbackHmac({ ...signed, binding: OTHER_BINDING }, keyProvider, store, { nowEpochSeconds: NOW }),
    /signing key is not trusted/
  );
  await assert.rejects(
    verifyCallbackHmac({ ...signed, keyId: 'key-old' }, keyProvider, store, { nowEpochSeconds: NOW }),
    /signature verification failed/
  );
});

test('length-prefixed canonicalization prevents nonce/body delimiter reinterpretation', async () => {
  const store = new MemoryReplayStore();
  const original = signedInput({ nonce: 'nonce-abcdefghijkl.b', body: 'c' });
  await assert.rejects(
    verifyCallbackHmac(
      { ...original, nonce: 'nonce-abcdefghijkl', body: 'b.c' },
      keyProvider,
      store,
      { nowEpochSeconds: NOW }
    ),
    /signature verification failed/
  );
});

test('nonce replay remains blocked across accepted key rotation', async () => {
  const store = new MemoryReplayStore();
  const nonce = 'rotation-nonce-abcdef123456';
  const oldInput = signedInput({ keyId: 'key-old', nonce }, OLD_SECRET);
  const newInput = signedInput({ keyId: 'key-new', nonce }, NEW_SECRET);
  await verifyCallbackHmac(oldInput, keyProvider, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(newInput, keyProvider, store, { nowEpochSeconds: NOW }),
    /already been used for this principal/
  );
});

test('different exact principals may use the same opaque nonce without cross-partner denial', async () => {
  const store = new MemoryReplayStore();
  const nonce = 'shared-nonce-abcdef1234567';
  assert.equal(await store.claim(BINDING, 'key-new', nonce, NOW + 300), true);
  assert.equal(await store.claim(OTHER_BINDING, 'key-new', nonce, NOW + 300), true);
});

test('rejects stale future and key-validity violations', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac(
      signedInput({ timestampEpochSeconds: NOW - 301, nonce: 'stale-nonce-abcdef123456' }),
      keyProvider,
      store,
      { nowEpochSeconds: NOW }
    ),
    /timestamp is stale/
  );
  await assert.rejects(
    verifyCallbackHmac(
      signedInput({ timestampEpochSeconds: NOW + 31, nonce: 'future-nonce-abcdef12345' }),
      keyProvider,
      store,
      { nowEpochSeconds: NOW }
    ),
    /too far in the future/
  );
  const expiredKeyProvider = new MemoryKeyProvider({
    expired: { secret: NEW_SECRET, validFromEpochSeconds: NOW - 600, validUntilEpochSeconds: NOW }
  });
  const expired = signedInput({ keyId: 'expired', nonce: 'expired-key-nonce-abcdef12' });
  await assert.rejects(
    verifyCallbackHmac(expired, expiredKeyProvider, store, { nowEpochSeconds: NOW }),
    /not valid for this timestamp/
  );
});

test('fails closed on key-provider or replay-store outage', async () => {
  const keyOutage: CallbackHmacKeyProvider = { resolve: async () => { throw new Error('kms unavailable'); } };
  await assert.rejects(
    verifyCallbackHmac(signedInput(), keyOutage, new MemoryReplayStore(), { nowEpochSeconds: NOW }),
    /signing-key resolution is unavailable/
  );
  const replayOutage: CallbackReplayStore = { claim: async () => { throw new Error('postgres unavailable'); } };
  await assert.rejects(
    verifyCallbackHmac(signedInput({ nonce: 'outage-nonce-abcdef123456' }), keyProvider, replayOutage, { nowEpochSeconds: NOW }),
    /replay protection is unavailable/
  );
});

test('rejects malformed signature weak key material invalid nonce and oversized body', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac({ ...signedInput(), signatureHex: 'bad' }, keyProvider, store, { nowEpochSeconds: NOW }),
    CallbackAuthenticationError
  );
  assert.throws(
    () => computeCallbackSignatureHex('too-short', {
      binding: BINDING,
      keyId: 'key-new',
      body: '{}',
      timestampEpochSeconds: NOW,
      nonce: 'valid-nonce-abcdef123456'
    }),
    /at least 32 bytes/
  );
  assert.throws(
    () => computeCallbackSignatureHex(NEW_SECRET, {
      binding: BINDING,
      keyId: 'key-new',
      body: '{}',
      timestampEpochSeconds: NOW,
      nonce: 'short'
    }),
    /between 16 and 256/
  );
  assert.throws(
    () => computeCallbackSignatureHex(NEW_SECRET, {
      binding: BINDING,
      keyId: 'key-new',
      body: 'x'.repeat(1024 * 1024 + 1),
      timestampEpochSeconds: NOW,
      nonce: 'oversize-nonce-abcdef1234'
    }),
    /exceeds/
  );
});
