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

  async claim(nonce: string): Promise<boolean> {
    if (this.claimed.has(nonce)) return false;
    this.claimed.add(nonce);
    return true;
  }
}

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000;

function signedInput(body = '{"status":"accepted"}', nonce = 'nonce-1', timestamp = NOW) {
  return {
    body,
    nonce,
    timestampEpochSeconds: timestamp,
    signatureHex: computeCallbackSignatureHex(SECRET, body, timestamp, nonce)
  };
}

test('accepts a fresh callback exactly once', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput();
  await verifyCallbackHmac(input, SECRET, store, { nowEpochSeconds: NOW });
  await assert.rejects(
    verifyCallbackHmac(input, SECRET, store, { nowEpochSeconds: NOW }),
    /already been used/
  );
});

test('rejects a tampered callback body', async () => {
  const store = new MemoryReplayStore();
  const signed = signedInput();
  await assert.rejects(
    verifyCallbackHmac({ ...signed, body: '{"status":"rejected"}' }, SECRET, store, { nowEpochSeconds: NOW }),
    /signature verification failed/
  );
});

test('rejects stale callbacks', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput('{}', 'nonce-stale', NOW - 301);
  await assert.rejects(
    verifyCallbackHmac(input, SECRET, store, { nowEpochSeconds: NOW }),
    /timestamp is stale/
  );
});

test('rejects callbacks too far in the future', async () => {
  const store = new MemoryReplayStore();
  const input = signedInput('{}', 'nonce-future', NOW + 31);
  await assert.rejects(
    verifyCallbackHmac(input, SECRET, store, { nowEpochSeconds: NOW }),
    /too far in the future/
  );
});

test('rejects malformed signatures and weak secrets', async () => {
  const store = new MemoryReplayStore();
  await assert.rejects(
    verifyCallbackHmac({ ...signedInput(), signatureHex: 'bad' }, SECRET, store, { nowEpochSeconds: NOW }),
    CallbackAuthenticationError
  );
  assert.throws(
    () => computeCallbackSignatureHex('too-short', '{}', NOW, 'nonce'),
    /at least 32 bytes/
  );
});
