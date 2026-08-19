import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_NONCE_CHARACTERS = 256;

export interface CallbackReplayStore {
  claim(nonce: string, expiresAtEpochSeconds: number): Promise<boolean>;
}

export interface VerifyCallbackInput {
  readonly body: string;
  readonly timestampEpochSeconds: number;
  readonly nonce: string;
  readonly signatureHex: string;
}

export interface VerifyCallbackOptions {
  readonly nowEpochSeconds?: number;
  readonly maxAgeSeconds?: number;
  readonly maxFutureSkewSeconds?: number;
}

export class CallbackAuthenticationError extends Error {
  override readonly name = 'CallbackAuthenticationError';
}

function normalizeHex(value: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new CallbackAuthenticationError('Callback signature must be a 64-character SHA-256 hex digest');
  }
  return Buffer.from(value, 'hex');
}

function requireNonce(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > MAX_NONCE_CHARACTERS) {
    throw new CallbackAuthenticationError(
      `Callback nonce must contain between 1 and ${MAX_NONCE_CHARACTERS} characters`
    );
  }
  return normalized;
}

function requireWindow(value: number, field: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CallbackAuthenticationError(`${field} is invalid`);
  }
  return value;
}

export function computeCallbackSignatureHex(
  secret: string,
  body: string,
  timestampEpochSeconds: number,
  nonce: string
): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new CallbackAuthenticationError('Callback HMAC secret must contain at least 32 bytes');
  }
  if (!Number.isSafeInteger(timestampEpochSeconds) || timestampEpochSeconds <= 0) {
    throw new CallbackAuthenticationError('Callback timestamp is invalid');
  }
  const normalizedNonce = requireNonce(nonce);

  return createHmac('sha256', secret)
    .update(`${timestampEpochSeconds}.${normalizedNonce}.${body}`, 'utf8')
    .digest('hex');
}

export async function verifyCallbackHmac(
  input: VerifyCallbackInput,
  secret: string,
  replayStore: CallbackReplayStore,
  options: VerifyCallbackOptions = {}
): Promise<void> {
  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = requireWindow(options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS, 'Callback max age', false);
  const maxFutureSkew = requireWindow(
    options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS,
    'Callback future skew',
    true
  );

  if (!Number.isSafeInteger(now) || now <= 0) throw new CallbackAuthenticationError('Verifier clock is invalid');
  if (!Number.isSafeInteger(input.timestampEpochSeconds) || input.timestampEpochSeconds <= 0) {
    throw new CallbackAuthenticationError('Callback timestamp is invalid');
  }
  const normalizedNonce = requireNonce(input.nonce);

  const age = now - input.timestampEpochSeconds;
  if (age > maxAge) throw new CallbackAuthenticationError('Callback timestamp is stale');
  if (age < -maxFutureSkew) throw new CallbackAuthenticationError('Callback timestamp is too far in the future');

  const expected = normalizeHex(
    computeCallbackSignatureHex(secret, input.body, input.timestampEpochSeconds, normalizedNonce)
  );
  const supplied = normalizeHex(input.signatureHex);
  if (!timingSafeEqual(expected, supplied)) {
    throw new CallbackAuthenticationError('Callback signature verification failed');
  }

  const expiresAt = input.timestampEpochSeconds + maxAge + maxFutureSkew;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new CallbackAuthenticationError('Callback replay retention window is invalid');
  }

  let claimed: boolean;
  try {
    claimed = await replayStore.claim(normalizedNonce, expiresAt);
  } catch {
    throw new CallbackAuthenticationError('Callback replay protection is unavailable');
  }
  if (!claimed) {
    throw new CallbackAuthenticationError('Callback nonce has already been used');
  }
}
