import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { IntegrationPurpose } from './integration-principal.js';

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_NONCE_CHARACTERS = 256;
const MIN_NONCE_CHARACTERS = 16;
const MAX_BODY_BYTES = 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface CallbackPrincipalBinding {
  readonly clientId: string;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
}

export interface CallbackHmacKey {
  readonly secret: string;
  readonly validFromEpochSeconds: number;
  readonly validUntilEpochSeconds: number;
}

export interface CallbackHmacKeyProvider {
  resolve(binding: CallbackPrincipalBinding, keyId: string): Promise<CallbackHmacKey | undefined>;
}

export interface CallbackReplayStore {
  claim(
    binding: CallbackPrincipalBinding,
    contractId: string,
    keyId: string,
    nonce: string,
    expiresAtEpochSeconds: number
  ): Promise<boolean>;
}

export interface VerifyCallbackInput {
  readonly binding: CallbackPrincipalBinding;
  readonly contractId: string;
  readonly keyId: string;
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

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) throw new CallbackAuthenticationError(`${field} is invalid`);
  return normalized;
}

function requireContractId(value: string): string {
  return requireIdentifier(value, 'Callback contractId');
}

function requireKeyId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_KEY_ID.test(normalized)) throw new CallbackAuthenticationError('Callback keyId is invalid');
  return normalized;
}

function requireNonce(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < MIN_NONCE_CHARACTERS ||
    normalized.length > MAX_NONCE_CHARACTERS ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new CallbackAuthenticationError(
      `Callback nonce must contain between ${MIN_NONCE_CHARACTERS} and ${MAX_NONCE_CHARACTERS} safe characters`
    );
  }
  return normalized;
}

function requireEpoch(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new CallbackAuthenticationError(`${field} is invalid`);
  return value;
}

function requireWindow(value: number, field: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) throw new CallbackAuthenticationError(`${field} is invalid`);
  return value;
}

function requireBody(body: string): string {
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new CallbackAuthenticationError(`Callback body exceeds ${MAX_BODY_BYTES} bytes`);
  }
  return body;
}

function normalizeBinding(binding: CallbackPrincipalBinding): CallbackPrincipalBinding {
  return Object.freeze({
    clientId: requireIdentifier(binding.clientId, 'Callback clientId'),
    tenantId: requireIdentifier(binding.tenantId, 'Callback tenantId'),
    purpose: requireIdentifier(binding.purpose, 'Callback purpose') as IntegrationPurpose
  });
}

function encodedField(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, 'utf8')}:${value}`;
}

function canonicalCallback(
  binding: CallbackPrincipalBinding,
  contractId: string,
  keyId: string,
  body: string,
  timestampEpochSeconds: number,
  nonce: string
): string {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  return [
    'ros-callback-hmac-v1',
    encodedField('clientId', binding.clientId),
    encodedField('tenantId', binding.tenantId),
    encodedField('purpose', binding.purpose),
    encodedField('contractId', contractId),
    encodedField('keyId', keyId),
    `timestamp:${timestampEpochSeconds}`,
    encodedField('nonce', nonce),
    `bodySha256:${bodyHash}`
  ].join('\n');
}

function signatureBuffer(value: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new CallbackAuthenticationError('Callback signature must be a 64-character SHA-256 hex digest');
  }
  return Buffer.from(value, 'hex');
}

function validateKey(key: CallbackHmacKey, timestampEpochSeconds: number): string {
  if (Buffer.byteLength(key.secret, 'utf8') < 32) {
    throw new CallbackAuthenticationError('Callback HMAC key material is invalid');
  }
  const validFrom = requireEpoch(key.validFromEpochSeconds, 'Callback key valid-from time');
  const validUntil = requireEpoch(key.validUntilEpochSeconds, 'Callback key valid-until time');
  if (validUntil <= validFrom) throw new CallbackAuthenticationError('Callback HMAC key validity window is invalid');
  if (timestampEpochSeconds < validFrom || timestampEpochSeconds >= validUntil) {
    throw new CallbackAuthenticationError('Callback signing key is not valid for this timestamp');
  }
  return key.secret;
}

export function computeCallbackSignatureHex(
  secret: string,
  input: Omit<VerifyCallbackInput, 'signatureHex'>
): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new CallbackAuthenticationError('Callback HMAC secret must contain at least 32 bytes');
  }
  const binding = normalizeBinding(input.binding);
  const contractId = requireContractId(input.contractId);
  const keyId = requireKeyId(input.keyId);
  const body = requireBody(input.body);
  const timestamp = requireEpoch(input.timestampEpochSeconds, 'Callback timestamp');
  const nonce = requireNonce(input.nonce);
  return createHmac('sha256', secret)
    .update(canonicalCallback(binding, contractId, keyId, body, timestamp, nonce), 'utf8')
    .digest('hex');
}

export async function verifyCallbackHmac(
  input: VerifyCallbackInput,
  keyProvider: CallbackHmacKeyProvider,
  replayStore: CallbackReplayStore,
  options: VerifyCallbackOptions = {}
): Promise<void> {
  const now = requireEpoch(options.nowEpochSeconds ?? Math.floor(Date.now() / 1000), 'Verifier clock');
  const maxAge = requireWindow(options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS, 'Callback max age', false);
  const futureSkew = requireWindow(
    options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS,
    'Callback future skew',
    true
  );
  const binding = normalizeBinding(input.binding);
  const contractId = requireContractId(input.contractId);
  const keyId = requireKeyId(input.keyId);
  const body = requireBody(input.body);
  const timestamp = requireEpoch(input.timestampEpochSeconds, 'Callback timestamp');
  const nonce = requireNonce(input.nonce);

  const age = now - timestamp;
  if (age > maxAge) throw new CallbackAuthenticationError('Callback timestamp is stale');
  if (age < -futureSkew) throw new CallbackAuthenticationError('Callback timestamp is too far in the future');

  let key: CallbackHmacKey | undefined;
  try { key = await keyProvider.resolve(binding, keyId); }
  catch { throw new CallbackAuthenticationError('Callback signing-key resolution is unavailable'); }
  if (key === undefined) throw new CallbackAuthenticationError('Callback signing key is not trusted');
  const secret = validateKey(key, timestamp);

  const expected = signatureBuffer(computeCallbackSignatureHex(secret, {
    binding,
    contractId,
    keyId,
    body,
    timestampEpochSeconds: timestamp,
    nonce
  }));
  const supplied = signatureBuffer(input.signatureHex);
  if (!timingSafeEqual(expected, supplied)) {
    throw new CallbackAuthenticationError('Callback signature verification failed');
  }

  const expiresAt = timestamp + maxAge + futureSkew;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new CallbackAuthenticationError('Callback replay retention window is invalid');
  }

  let claimed: boolean;
  try { claimed = await replayStore.claim(binding, contractId, keyId, nonce, expiresAt); }
  catch { throw new CallbackAuthenticationError('Callback replay protection is unavailable'); }
  if (!claimed) throw new CallbackAuthenticationError('Callback nonce has already been used for this principal');
}
