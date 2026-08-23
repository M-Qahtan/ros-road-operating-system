import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_PROFILE_ID_CHARACTERS = 128;
const MIN_NONCE_CHARACTERS = 16;
const MAX_NONCE_CHARACTERS = 256;
const MAX_CALLBACK_BODY_BYTES = 1024 * 1024;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const NONCE_PATTERN = /^[A-Za-z0-9._~:-]+$/;

export interface CallbackReplayStore {
  claim(profileId: string, nonce: string, expiresAtEpochSeconds: number): Promise<boolean>;
}

/**
 * Trusted integration profile selected by ROS routing/configuration before request verification.
 * Never construct this object from callback request headers, query parameters or body fields.
 */
export interface TrustedCallbackProfile {
  readonly profileId: string;
  readonly secret: string;
}

export interface VerifyCallbackInput {
  /** Exact raw request body decoded as UTF-8; do not parse/re-serialize before verification. */
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

function requireProfileId(value: string): string {
  if (
    value.length < 1 ||
    value.length > MAX_PROFILE_ID_CHARACTERS ||
    value !== value.trim() ||
    !PROFILE_ID_PATTERN.test(value)
  ) {
    throw new CallbackAuthenticationError(
      `Callback profileId must be a canonical token between 1 and ${MAX_PROFILE_ID_CHARACTERS} characters`
    );
  }
  return value;
}

function requireNonce(value: string): string {
  if (
    value.length < MIN_NONCE_CHARACTERS ||
    value.length > MAX_NONCE_CHARACTERS ||
    value !== value.trim() ||
    !NONCE_PATTERN.test(value)
  ) {
    throw new CallbackAuthenticationError(
      `Callback nonce must be a canonical token between ${MIN_NONCE_CHARACTERS} and ${MAX_NONCE_CHARACTERS} characters`
    );
  }
  return value;
}

function requireBody(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_CALLBACK_BODY_BYTES) {
    throw new CallbackAuthenticationError('Callback body exceeds the 1 MiB authentication limit');
  }
  return value;
}

function requireSecret(value: string): string {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 32 || bytes > 4096) {
    throw new CallbackAuthenticationError('Callback HMAC secret must contain between 32 and 4096 bytes');
  }
  return value;
}

function requireWindow(value: number, field: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CallbackAuthenticationError(`${field} is invalid`);
  }
  return value;
}

function requireTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CallbackAuthenticationError('Callback timestamp is invalid');
  }
  return value;
}

function canonicalSignedMaterial(
  profileId: string,
  body: string,
  timestampEpochSeconds: number,
  nonce: string
): string {
  // JSON array framing avoids delimiter ambiguity while preserving the exact raw body string.
  return JSON.stringify([
    requireTimestamp(timestampEpochSeconds),
    requireProfileId(profileId),
    requireNonce(nonce),
    requireBody(body)
  ]);
}

export function computeCallbackSignatureHex(
  profile: TrustedCallbackProfile,
  body: string,
  timestampEpochSeconds: number,
  nonce: string
): string {
  const profileId = requireProfileId(profile.profileId);
  return createHmac('sha256', requireSecret(profile.secret))
    .update(canonicalSignedMaterial(profileId, body, timestampEpochSeconds, nonce), 'utf8')
    .digest('hex');
}

export async function verifyCallbackHmac(
  input: VerifyCallbackInput,
  profile: TrustedCallbackProfile,
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
  const timestamp = requireTimestamp(input.timestampEpochSeconds);
  const profileId = requireProfileId(profile.profileId);
  const nonce = requireNonce(input.nonce);
  const body = requireBody(input.body);

  const age = now - timestamp;
  if (age > maxAge) throw new CallbackAuthenticationError('Callback timestamp is stale');
  if (age < -maxFutureSkew) throw new CallbackAuthenticationError('Callback timestamp is too far in the future');

  const expected = normalizeHex(computeCallbackSignatureHex(profile, body, timestamp, nonce));
  const supplied = normalizeHex(input.signatureHex);
  if (!timingSafeEqual(expected, supplied)) {
    throw new CallbackAuthenticationError('Callback signature verification failed');
  }

  const expiresAt = timestamp + maxAge + maxFutureSkew;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new CallbackAuthenticationError('Callback replay retention window is invalid');
  }

  let claimed: boolean;
  try {
    claimed = await replayStore.claim(profileId, nonce, expiresAt);
  } catch {
    throw new CallbackAuthenticationError('Callback replay protection is unavailable');
  }
  if (!claimed) throw new CallbackAuthenticationError('Callback nonce has already been used for this profile');
}
