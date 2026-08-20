import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CallbackAuthenticationError,
  CallbackReplayStore,
  computeCallbackSignatureHex,
  verifyCallbackHmac
} from './callback-auth.js';

class MemoryReplayStore implements CallbackReplayStore {
  private readonly claimed = new Set<string>();

  async claim(profileId: string, nonce: string): Promise<boolean> {
    const key = `${profileId}\u0000${nonce}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

const TEST_HMAC_KEY_MATERIAL = 'test-only-0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000;
const TRAFFIC_PROFILE = 'traffic-sandbox.riyadh';
const INSURANCE_PROFILE = 'insurance-sandbox.riyadh';
const NONCE = 'nonce-0000000000000001';

function signedInput(
  profileId = TRAFFIC_PROFILE,
  body = '{"status":"accepted"}',
  nonce = NONCE,
  timestamp = NOW,
  secret = TEST_HMAC_KEY_MATERIAL
) {
  return {
    profileId,
    body,
    nonce,
    timestampEpochSeconds: timestamp,
    signatureHex: computeCallbackSignatureHex(secret, profileId, body, timestamp, nonce)
  };
}

test('accepts a fresh callback exactly once per trusted profile', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput();
  await verifyCallbackHmac(input, TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(input, TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW }),
    /already been used for this profile/
  );
});

test('profile is part of signed material and prevents cross-profile replay even if a secret is accidentally reused', async () => {
  const store = new MemoryReplayStore();
  const traffic = signedInput();
  await verifyCallbackHmac(traffic, TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW });

  await assert.rejects(
    verifyCallbackHmac(
      { ...traffic, profileId: INSURANCE_PROFILE },
      TEST_HMAC_KEY_MATERIAL,
      store,
      { nowEpochSeconds: NOW }
    ),
    /signature verification failed/
  );

  const properlySignedInsurance = signedInput(INSURANCE_PROFILE);
  await verifyCallbackHmac(
    properlySignedInsurance,
    TEST_HMAC_KEY_MATERIAL,
    store,
    { nowEpochSeconds: NOW }
  );
});

test('rejects body changes including parse-equivalent whitespace changes', async () => {
  const store = new MemoryReplayStore();
  const signed = signedInput(TRAFFIC_PROFILE, '{"status":"accepted"}');
  await assert.rejects(
    verifyCallbackHmac(
      { ...signed, body: '{ "status": "accepted" }' },
      TEST_HMAC_KEY_MATERIAL,
      store,
      { nowEpochSeconds: NOW }
    ),
    /signature verification failed/
  );
});

test('rejects stale and excessive-future callbacks before replay claim', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac(signedInput(TRAFFIC_PROFILE, '{}', 'nonce-0000000000000002', NOW - 301), TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW }),
    /timestamp is stale/
  );
  await assert.rejects(
    verifyCallbackHmac(signedInput(TRAFFIC_PROFILE, '{}', 'nonce-0000000000000003', NOW + 31), TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW }),
    /too far in the future/
  );
});

test('rejects malformed signatures, weak secrets and invalid verifier windows', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac({ ...signedInput(), signatureHex: 'bad' }, TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW }),
    CallbackAuthenticationError
  );
  assert.throws(
    () => computeCallbackSignatureHex('too-short', TRAFFIC_PROFILE, '{}', NOW, NONCE),
    /between 32 and 4096 bytes/
  );
  await assert.rejects(
    verifyCallbackHmac(signedInput(), TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW, maxAgeSeconds: 0 }),
    /Callback max age is invalid/
  );
  await assert.rejects(
    verifyCallbackHmac(signedInput(), TEST_HMAC_KEY_MATERIAL, store, { nowEpochSeconds: NOW, maxFutureSkewSeconds: -1 }),
    /Callback future skew is invalid/
  );
});

test('rejects non-canonical profile and nonce tokens', async () => {
  const store = new MemoryReplayStore();
  assert.throws(
    () => computeCallbackSignatureHex(TEST_HMAC_KEY_MATERIAL, ' traffic ', '{}', NOW, NONCE),
    /profileId must be a canonical token/
  );
  assert.throws(
    () => computeCallbackSignatureHex(TEST_HMAC_KEY_MATERIAL, TRAFFIC_PROFILE, '{}', NOW, 'short'),
    /nonce must be a canonical token/
  );
  await assert.rejects(
    verifyCallbackHmac(
      {
        profileId: TRAFFIC_PROFILE,
        body: '{}',
        nonce: 'x'.repeat(257),
        timestampEpochSeconds: NOW,
        signatureHex: 'a'.repeat(64)
      },
      TEST_HMAC_KEY_MATERIAL,
      store,
      { nowEpochSeconds: NOW }
    ),
    /nonce must be a canonical token/
  );
});

test('rejects a body over the authentication bound', () => {
  assert.throws(
    () => computeCallbackSignatureHex(
      TEST_HMAC_KEY_MATERIAL,
      TRAFFIC_PROFILE,
      'x'.repeat(1024 * 1024 + 1),
      NOW,
      NONCE
    ),
    /1 MiB authentication limit/
  );
});

test('fails closed when the replay store is unavailable', async () => {
  const unavailableStore: CallbackReplayStore = {
    claim: async () => { throw new Error('database unavailable'); }
  };
  await assert.rejects(
    verifyCallbackHmac(
      signedInput(TRAFFIC_PROFILE, '{}', 'nonce-0000000000000004'),
      TEST_HMAC_KEY_MATERIAL,
      unavailableStore,
      { nowEpochSeconds: NOW }
    ),
    (error: unknown) =>
      error instanceof CallbackAuthenticationError &&
      /replay protection is unavailable/.test(error.message)
  );
});
