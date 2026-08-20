import { KeyObject, timingSafeEqual, verify } from 'node:crypto';
import { IntegrationPurpose } from './integration-principal.js';
import { IntegrationPartner } from './integration-lifecycle.js';

const MAX_JWS_BYTES = 32 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PROFILE_ID_CHARACTERS = 128;
const MAX_KID_CHARACTERS = 128;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MIN_RSA_MODULUS_BITS = 2048;
const JWS_TYPE = 'ros-callback+jws';

export interface PartnerJwsVerificationKey {
  readonly kid: string;
  readonly publicKey: KeyObject;
  readonly notBeforeEpochSeconds: number;
  readonly notAfterEpochSeconds: number;
  readonly revokedAtEpochSeconds?: number;
}

/**
 * Runtime trust material for an approved partner sandbox profile.
 *
 * This object does not create a TLS connection. The peer-certificate digest must
 * come from a TLS termination/client stack that has already completed certificate
 * parsing and chain validation. This layer then enforces ROS's explicit pin and
 * JWS policy before callback data is trusted.
 */
export interface PartnerJwsMtlsTrustProfile {
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  readonly environment: 'SANDBOX';
  readonly peerCertificateSha256Pins: readonly string[];
  readonly verificationKeys: readonly PartnerJwsVerificationKey[];
}

export interface DetachedPartnerJwsInput {
  readonly rawBody: string;
  readonly detachedJws: string;
  readonly peerCertificateSha256: string;
  readonly nowEpochSeconds?: number;
}

interface ProtectedHeader {
  readonly alg?: unknown;
  readonly typ?: unknown;
  readonly kid?: unknown;
  readonly crit?: unknown;
  readonly ros_profile?: unknown;
  readonly ros_tenant?: unknown;
  readonly ros_purpose?: unknown;
}

export class PartnerTrustVerificationError extends Error {
  override readonly name = 'PartnerTrustVerificationError';
}

function requireSafeEpoch(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PartnerTrustVerificationError(`${field} must be a positive epoch-second integer`);
  }
  return value;
}

function requireToken(value: string, field: string, maximum: number): string {
  if (
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    !TOKEN_PATTERN.test(value)
  ) {
    throw new PartnerTrustVerificationError(`${field} must be a canonical token between 1 and ${maximum} characters`);
  }
  return value;
}

function requireText(value: string, field: string, maximum = 128): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new PartnerTrustVerificationError(`${field} must contain between 1 and ${maximum} characters`);
  }
  return normalized;
}

function requireFingerprint(value: string, field: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new PartnerTrustVerificationError(`${field} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function fingerprintsEqual(left: string, right: string): boolean {
  const a = Buffer.from(requireFingerprint(left, 'Presented mTLS peer certificate fingerprint'), 'hex');
  const b = Buffer.from(requireFingerprint(right, 'Pinned mTLS peer certificate fingerprint'), 'hex');
  return timingSafeEqual(a, b);
}

function requireStrongRs256Key(key: KeyObject): KeyObject {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa') {
    throw new PartnerTrustVerificationError('Partner JWS verification key must be a public RSA key');
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== 'number' || modulusLength < MIN_RSA_MODULUS_BITS) {
    throw new PartnerTrustVerificationError(
      `Partner JWS RSA verification key must be at least ${MIN_RSA_MODULUS_BITS} bits`
    );
  }
  return key;
}

function parseHeader(encoded: string): ProtectedHeader {
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new PartnerTrustVerificationError('Partner JWS protected header is not canonical base64url');
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not object');
    return parsed as ProtectedHeader;
  } catch (error) {
    if (error instanceof PartnerTrustVerificationError) throw error;
    throw new PartnerTrustVerificationError('Partner JWS protected header is not valid JSON');
  }
}

function requiredHeaderString(value: unknown, field: string, maximum = 128): string {
  if (typeof value !== 'string') {
    throw new PartnerTrustVerificationError(`Partner JWS ${field} protected header is required`);
  }
  return requireText(value, `Partner JWS ${field}`, maximum);
}

function validateProfile(profile: PartnerJwsMtlsTrustProfile): PartnerJwsMtlsTrustProfile {
  const profileId = requireToken(profile.profileId, 'profileId', MAX_PROFILE_ID_CHARACTERS);
  const tenantId = requireText(profile.tenantId, 'tenantId');
  const purpose = requireText(profile.purpose, 'purpose') as IntegrationPurpose;
  if (profile.environment !== 'SANDBOX') {
    throw new PartnerTrustVerificationError('Only SANDBOX partner trust profiles are enabled');
  }
  if (profile.peerCertificateSha256Pins.length < 1 || profile.peerCertificateSha256Pins.length > 4) {
    throw new PartnerTrustVerificationError('Partner mTLS profile must contain between 1 and 4 certificate pins');
  }
  const pins = profile.peerCertificateSha256Pins.map((pin) => requireFingerprint(pin, 'Pinned mTLS peer certificate fingerprint'));
  if (new Set(pins).size !== pins.length) {
    throw new PartnerTrustVerificationError('Partner mTLS certificate pins must be unique');
  }
  if (profile.verificationKeys.length < 1 || profile.verificationKeys.length > 4) {
    throw new PartnerTrustVerificationError('Partner JWS profile must contain between 1 and 4 verification keys');
  }

  const kids = new Set<string>();
  const keys = profile.verificationKeys.map((key) => {
    const kid = requireToken(key.kid, 'kid', MAX_KID_CHARACTERS);
    if (kids.has(kid)) throw new PartnerTrustVerificationError(`Partner JWS profile contains duplicate kid ${kid}`);
    kids.add(kid);
    const notBefore = requireSafeEpoch(key.notBeforeEpochSeconds, 'JWS key notBefore');
    const notAfter = requireSafeEpoch(key.notAfterEpochSeconds, 'JWS key notAfter');
    if (notAfter <= notBefore) throw new PartnerTrustVerificationError('JWS key notAfter must be later than notBefore');
    const revokedAt = key.revokedAtEpochSeconds === undefined
      ? undefined
      : requireSafeEpoch(key.revokedAtEpochSeconds, 'JWS key revokedAt');
    return Object.freeze({
      kid,
      publicKey: requireStrongRs256Key(key.publicKey),
      notBeforeEpochSeconds: notBefore,
      notAfterEpochSeconds: notAfter,
      ...(revokedAt === undefined ? {} : { revokedAtEpochSeconds: revokedAt })
    });
  });

  return Object.freeze({
    profileId,
    partner: profile.partner,
    tenantId,
    purpose,
    environment: 'SANDBOX',
    peerCertificateSha256Pins: Object.freeze(pins),
    verificationKeys: Object.freeze(keys)
  });
}

function chooseKey(
  profile: PartnerJwsMtlsTrustProfile,
  kid: string,
  nowEpochSeconds: number
): PartnerJwsVerificationKey {
  const key = profile.verificationKeys.find((candidate) => candidate.kid === kid);
  if (key === undefined) throw new PartnerTrustVerificationError('Partner JWS signing key is not trusted');
  if (nowEpochSeconds < key.notBeforeEpochSeconds || nowEpochSeconds >= key.notAfterEpochSeconds) {
    throw new PartnerTrustVerificationError('Partner JWS signing key is outside its accepted validity window');
  }
  if (key.revokedAtEpochSeconds !== undefined && nowEpochSeconds >= key.revokedAtEpochSeconds) {
    throw new PartnerTrustVerificationError('Partner JWS signing key is revoked');
  }
  return key;
}

/**
 * Verifies the ROS detached-JWS callback profile after an mTLS layer has exposed
 * the validated peer certificate fingerprint.
 *
 * Compact form: `<protected-header>..<signature>`.
 * Signing input: `<protected-header>.<base64url(raw-body)>`.
 */
export function verifyDetachedPartnerJwsMtls(
  input: DetachedPartnerJwsInput,
  profileInput: PartnerJwsMtlsTrustProfile
): void {
  const profile = validateProfile(profileInput);
  const now = requireSafeEpoch(input.nowEpochSeconds ?? Math.floor(Date.now() / 1000), 'Verifier clock');
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_BODY_BYTES) {
    throw new PartnerTrustVerificationError('Partner callback body exceeds the 1 MiB trust-verification limit');
  }
  if (Buffer.byteLength(input.detachedJws, 'utf8') > MAX_JWS_BYTES) {
    throw new PartnerTrustVerificationError('Partner detached JWS exceeds the configured size limit');
  }

  const presentedFingerprint = requireFingerprint(
    input.peerCertificateSha256,
    'Presented mTLS peer certificate fingerprint'
  );
  const certificatePinned = profile.peerCertificateSha256Pins.some((pin) => fingerprintsEqual(presentedFingerprint, pin));
  if (!certificatePinned) throw new PartnerTrustVerificationError('mTLS peer certificate is not pinned for this partner profile');

  const parts = input.detachedJws.split('.');
  if (parts.length !== 3 || parts[0] === '' || parts[1] !== '' || parts[2] === '') {
    throw new PartnerTrustVerificationError('Partner JWS must use detached compact serialization');
  }
  const [encodedHeader, , encodedSignature] = parts as [string, string, string];
  const header = parseHeader(encodedHeader);
  if (header.alg !== 'RS256') throw new PartnerTrustVerificationError('Partner JWS alg must be exactly RS256');
  if (header.typ !== JWS_TYPE) throw new PartnerTrustVerificationError(`Partner JWS typ must be ${JWS_TYPE}`);
  if (header.crit !== undefined) {
    if (!Array.isArray(header.crit) || header.crit.length > 0) {
      throw new PartnerTrustVerificationError('Partner JWS critical headers are not supported');
    }
  }

  const kid = requireToken(requiredHeaderString(header.kid, 'kid'), 'kid', MAX_KID_CHARACTERS);
  const protectedProfile = requiredHeaderString(header.ros_profile, 'ros_profile');
  const protectedTenant = requiredHeaderString(header.ros_tenant, 'ros_tenant');
  const protectedPurpose = requiredHeaderString(header.ros_purpose, 'ros_purpose');
  if (
    protectedProfile !== profile.profileId ||
    protectedTenant !== profile.tenantId ||
    protectedPurpose !== profile.purpose
  ) {
    throw new PartnerTrustVerificationError('Partner JWS protected ROS scope does not match the trusted profile');
  }

  if (!BASE64URL_PATTERN.test(encodedSignature)) {
    throw new PartnerTrustVerificationError('Partner JWS signature is not canonical base64url');
  }
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (signature.length === 0) throw new PartnerTrustVerificationError('Partner JWS signature is empty');

  const key = chooseKey(profile, kid, now);
  const encodedPayload = Buffer.from(input.rawBody, 'utf8').toString('base64url');
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
  if (!verify('RSA-SHA256', signingInput, key.publicKey, signature)) {
    throw new PartnerTrustVerificationError('Partner JWS signature verification failed');
  }
}
