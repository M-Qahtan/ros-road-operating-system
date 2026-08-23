import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CallbackAuthenticationError,
  CallbackReplayStore,
  TrustedCallbackProfile,
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
const WEAK_HMAC_KEY_MATERIAL = 'too-short';
const NOW = 1_800_000_000;
const TRAFFIC_PROFILE: TrustedCallbackProfile = {
  profileId: 'traffic-sandbox.riyadh',
  secret: TEST_HMAC_KEY_MATERIAL
};
const INSURANCE_PROFILE: TrustedCallbackProfile = {
  profileId: 'insurance-sandbox.riyadh',
  secret: TEST_HMAC_KEY_MATERIAL
};
const NONCE = 'nonce-0000000000000001';

function signedInput(
  profile: TrustedCallbackProfile = TRAFFIC_PROFILE,
  body = '{"status":"accepted"}',
  nonce = NONCE,
  timestamp = NOW
) {
  return {
    body,
    nonce,
    timestampEpochSeconds: timestamp,
    signatureHex: computeCallbackSignatureHex(profile, body, timestamp, nonce)
  };
}

test('accepts a fresh callback exactly once per trusted profile', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput();
  await verifyCallbackHmac(input, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(input, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW }),
    /already been used for this profile/
  );
});

test('trusted profile is outside request input and prevents cross-profile replay even if a secret is reused', async () => {
  const store = new MemoryReplayStore();
  const traffic = signedInput(TRAFFIC_PROFILE);
  await verifyCallbackHmac(traffic, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW });

  await assert.rejects(
    verifyCallbackHmac(traffic, INSURANCE_PROFILE, store, { nowEpochSeconds: NOW }),
    /signature verification failed/
  );

  const properlySignedInsurance = signedInput(INSURANCE_PROFILE);
  await verifyCallbackHmac(properlySignedInsurance, INSURANCE_PROFILE, store, { nowEpochSeconds: NOW });
});

test('request-shaped data cannot override the server-selected profile context', async () => {
  const store = new MemoryReplayStore();
  const signed = signedInput(TRAFFIC_PROFILE);
  const requestWithAttackerFields = {
    ...signed,
    profileId: INSURANCE_PROFILE.profileId
  };

  await verifyCallbackHmac(requestWithAttackerFields, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(requestWithAttackerFields, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW }),
    /already been used for this profile/
  );
});

test('rejects body changes including parse-equivalent whitespace changes', async () => {
  const store = new MemoryReplayStore();
  const signed = signedInput(TRAFFIC_PROFILE, '{"status":"accepted"}');
  await assert.rejects(
    verifyCallbackHmac(
      { ...signed, body: '{ "status": "accepted" }' },
      TRAFFIC_PROFILE,
      store,
      { nowEpochSeconds: NOW }
    ),
    /signature verification failed/
  );
});

test('rejects stale and excessive-future callbacks before replay claim', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac(
      signedInput(TRAFFIC_PROFILE, '{}', 'nonce-0000000000000002', NOW - 301),
      TRAFFIC_PROFILE,
      store,
      { nowEpochSeconds: NOW }
    ),
    /timestamp is stale/
  );
  await assert.rejects(
    verifyCallbackHmac(
      signedInput(TRAFFIC_PROFILE, '{}', 'nonce-0000000000000003', NOW + 31),
      TRAFFIC_PROFILE,
      store,
      { nowEpochSeconds: NOW }
    ),
    /too far in the future/
  );
});

test('rejects malformed signatures, weak secrets and invalid verifier windows', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac({ ...signedInput(), signatureHex: 'bad' }, TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW }),
    CallbackAuthenticationError
  );
  assert.throws(
    () => computeCallbackSignatureHex({ ...TRAFFIC_PROFILE, secret: WEAK_HMAC_KEY_MATERIAL }, '{}', NOW, NONCE),
    /between 32 and 4096 bytes/
  );
  await assert.rejects(
    verifyCallbackHmac(signedInput(), TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW, maxAgeSeconds: 0 }),
    /Callback max age is invalid/
  );
  await assert.rejects(
    verifyCallbackHmac(signedInput(), TRAFFIC_PROFILE, store, { nowEpochSeconds: NOW, maxFutureSkewSeconds: -1 }),
    /Callback future skew is invalid/
  );
});

test('rejects non-canonical trusted profile and nonce tokens', async () => {
  const store = new MemoryReplayStore();
  assert.throws(
    () => computeCallbackSignatureHex({ ...TRAFFIC_PROFILE, profileId: ' traffic ' }, '{}', NOW, NONCE),
    /profileId must be a canonical token/
  );
  assert.throws(
    () => computeCallbackSignatureHex(TRAFFIC_PROFILE, '{}', NOW, 'short'),
    /nonce must be a canonical token/
  );
  await assert.rejects(
    verifyCallbackHmac(
      {
        body: '{}',
        nonce: 'x'.repeat(257),
        timestampEpochSeconds: NOW,
        signatureHex: 'a'.repeat(64)
      },
      TRAFFIC_PROFILE,
      store,
      { nowEpochSeconds: NOW }
    ),
    /nonce must be a canonical token/
  );
});

test('rejects a body over the authentication bound', () => {
  assert.throws(
    () => computeCallbackSignatureHex(
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
      TRAFFIC_PROFILE,
      unavailableStore,
      { nowEpochSeconds: NOW }
    ),
    (error: unknown) =>
      error instanceof CallbackAuthenticationError &&
      /replay protection is unavailable/.test(error.message)
  );
});
