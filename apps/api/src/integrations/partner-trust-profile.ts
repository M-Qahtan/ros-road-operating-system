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

const PURPOSE_BY_PARTNER: Readonly<Record<IntegrationPartner, IntegrationPurpose>> = {
  EMERGENCY: 'EMERGENCY_COORDINATION',
  TRAFFIC: 'TRAFFIC_COORDINATION',
  ROAD_OPERATOR: 'TRAFFIC_COORDINATION',
  INSURANCE: 'INSURANCE_COORDINATION',
  TOWING: 'TOWING_COORDINATION',
  ROUTING: 'ROUTE_COORDINATION'
};

export interface PartnerMtlsCertificatePin {
  readonly fingerprintSha256: string;
  readonly notBeforeEpochSeconds: number;
  readonly notAfterEpochSeconds: number;
  readonly revokedAtEpochSeconds?: number;
}

export interface PartnerJwsVerificationKey {
  readonly kid: string;
  readonly publicKey: KeyObject;
  readonly notBeforeEpochSeconds: number;
  readonly notAfterEpochSeconds: number;
  readonly revokedAtEpochSeconds?: number;
}

/**
 * Runtime trust material for an approved partner sandbox profile.
 * This object contains public verification material only; no private key or live credential is required.
 */
export interface PartnerJwsMtlsTrustProfile {
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  readonly environment: 'SANDBOX';
  readonly sandboxEndpointBaseUrl: string;
  readonly peerCertificates: readonly PartnerMtlsCertificatePin[];
  readonly verificationKeys: readonly PartnerJwsVerificationKey[];
}

export interface DetachedPartnerJwsInput {
  readonly rawBody: string;
  readonly detachedJws: string;
  /** Digest exposed by an already validated TLS stack/termination layer. */
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
  if (value.length < 1 || value.length > maximum || value !== value.trim() || !TOKEN_PATTERN.test(value)) {
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

function requireSandboxEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new PartnerTrustVerificationError('Partner sandbox endpoint must be a valid URL'); }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new PartnerTrustVerificationError('Partner sandbox endpoint must use HTTPS and include a hostname');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PartnerTrustVerificationError(
      'Partner sandbox endpoint must not contain credentials, query parameters or a fragment'
    );
  }
  return url.toString().replace(/\/$/, '');
}

function requireFingerprint(value: string, field: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new PartnerTrustVerificationError(`${field} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function fingerprintsEqual(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function requireStrongRs256Key(key: KeyObject): KeyObject {
  if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa') {
    throw new PartnerTrustVerificationError('Partner JWS verification key must be a public RSA key');
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== 'number' || modulusLength < MIN_RSA_MODULUS_BITS) {
    throw new PartnerTrustVerificationError(`Partner JWS RSA verification key must be at least ${MIN_RSA_MODULUS_BITS} bits`);
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

function normalizeValidityWindow(
  notBeforeEpochSeconds: number,
  notAfterEpochSeconds: number,
  revokedAtEpochSeconds: number | undefined,
  label: string
) {
  const notBefore = requireSafeEpoch(notBeforeEpochSeconds, `${label} notBefore`);
  const notAfter = requireSafeEpoch(notAfterEpochSeconds, `${label} notAfter`);
  if (notAfter <= notBefore) throw new PartnerTrustVerificationError(`${label} notAfter must be later than notBefore`);
  const revokedAt = revokedAtEpochSeconds === undefined
    ? undefined
    : requireSafeEpoch(revokedAtEpochSeconds, `${label} revokedAt`);
  return { notBefore, notAfter, revokedAt };
}

function validateProfile(profile: PartnerJwsMtlsTrustProfile): PartnerJwsMtlsTrustProfile {
  const profileId = requireToken(profile.profileId, 'profileId', MAX_PROFILE_ID_CHARACTERS);
  const tenantId = requireText(profile.tenantId, 'tenantId');
  const purpose = requireText(profile.purpose, 'purpose') as IntegrationPurpose;
  const expectedPurpose = PURPOSE_BY_PARTNER[profile.partner];
  if (purpose !== expectedPurpose) {
    throw new PartnerTrustVerificationError(`${profile.partner} trust profile requires purpose ${expectedPurpose}`);
  }
  if (profile.environment !== 'SANDBOX') {
    throw new PartnerTrustVerificationError('Only SANDBOX partner trust profiles are enabled');
  }
  const endpoint = requireSandboxEndpoint(profile.sandboxEndpointBaseUrl);

  if (profile.peerCertificates.length < 1 || profile.peerCertificates.length > 4) {
    throw new PartnerTrustVerificationError('Partner mTLS profile must contain between 1 and 4 certificate pins');
  }
  const fingerprints = new Set<string>();
  const peerCertificates = profile.peerCertificates.map((certificate) => {
    const fingerprint = requireFingerprint(certificate.fingerprintSha256, 'Pinned mTLS peer certificate fingerprint');
    if (fingerprints.has(fingerprint)) {
      throw new PartnerTrustVerificationError('Partner mTLS certificate pins must be unique');
    }
    fingerprints.add(fingerprint);
    const window = normalizeValidityWindow(
      certificate.notBeforeEpochSeconds,
      certificate.notAfterEpochSeconds,
      certificate.revokedAtEpochSeconds,
      'mTLS certificate pin'
    );
    return Object.freeze({
      fingerprintSha256: fingerprint,
      notBeforeEpochSeconds: window.notBefore,
      notAfterEpochSeconds: window.notAfter,
      ...(window.revokedAt === undefined ? {} : { revokedAtEpochSeconds: window.revokedAt })
    });
  });

  if (profile.verificationKeys.length < 1 || profile.verificationKeys.length > 4) {
    throw new PartnerTrustVerificationError('Partner JWS profile must contain between 1 and 4 verification keys');
  }
  const kids = new Set<string>();
  const verificationKeys = profile.verificationKeys.map((key) => {
    const kid = requireToken(key.kid, 'kid', MAX_KID_CHARACTERS);
    if (kids.has(kid)) throw new PartnerTrustVerificationError(`Partner JWS profile contains duplicate kid ${kid}`);
    kids.add(kid);
    const window = normalizeValidityWindow(
      key.notBeforeEpochSeconds,
      key.notAfterEpochSeconds,
      key.revokedAtEpochSeconds,
      'JWS key'
    );
    return Object.freeze({
      kid,
      publicKey: requireStrongRs256Key(key.publicKey),
      notBeforeEpochSeconds: window.notBefore,
      notAfterEpochSeconds: window.notAfter,
      ...(window.revokedAt === undefined ? {} : { revokedAtEpochSeconds: window.revokedAt })
    });
  });

  return Object.freeze({
    profileId,
    partner: profile.partner,
    tenantId,
    purpose,
    environment: 'SANDBOX',
    sandboxEndpointBaseUrl: endpoint,
    peerCertificates: Object.freeze(peerCertificates),
    verificationKeys: Object.freeze(verificationKeys)
  });
}

function assertActiveWindow(
  nowEpochSeconds: number,
  notBeforeEpochSeconds: number,
  notAfterEpochSeconds: number,
  revokedAtEpochSeconds: number | undefined,
  label: string
): void {
  if (nowEpochSeconds < notBeforeEpochSeconds || nowEpochSeconds >= notAfterEpochSeconds) {
    throw new PartnerTrustVerificationError(`${label} is outside its accepted validity window`);
  }
  if (revokedAtEpochSeconds !== undefined && nowEpochSeconds >= revokedAtEpochSeconds) {
    throw new PartnerTrustVerificationError(`${label} is revoked`);
  }
}

function verifyCertificatePin(
  profile: PartnerJwsMtlsTrustProfile,
  presentedFingerprint: string,
  nowEpochSeconds: number
): void {
  const fingerprint = requireFingerprint(presentedFingerprint, 'Presented mTLS peer certificate fingerprint');
  const certificate = profile.peerCertificates.find((candidate) =>
    fingerprintsEqual(fingerprint, candidate.fingerprintSha256)
  );
  if (certificate === undefined) {
    throw new PartnerTrustVerificationError('mTLS peer certificate is not pinned for this partner profile');
  }
  assertActiveWindow(
    nowEpochSeconds,
    certificate.notBeforeEpochSeconds,
    certificate.notAfterEpochSeconds,
    certificate.revokedAtEpochSeconds,
    'Pinned mTLS peer certificate'
  );
}

function chooseKey(
  profile: PartnerJwsMtlsTrustProfile,
  kid: string,
  nowEpochSeconds: number
): PartnerJwsVerificationKey {
  const key = profile.verificationKeys.find((candidate) => candidate.kid === kid);
  if (key === undefined) throw new PartnerTrustVerificationError('Partner JWS signing key is not trusted');
  assertActiveWindow(
    nowEpochSeconds,
    key.notBeforeEpochSeconds,
    key.notAfterEpochSeconds,
    key.revokedAtEpochSeconds,
    'Partner JWS signing key'
  );
  return key;
}

/**
 * Verifies the ROS detached-JWS callback profile after an mTLS layer has exposed
 * the validated peer certificate fingerprint.
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

  verifyCertificatePin(profile, input.peerCertificateSha256, now);

  const parts = input.detachedJws.split('.');
  if (parts.length !== 3 || parts[0] === '' || parts[1] !== '' || parts[2] === '') {
    throw new PartnerTrustVerificationError('Partner JWS must use detached compact serialization');
  }
  const [encodedHeader, , encodedSignature] = parts as [string, string, string];
  const header = parseHeader(encodedHeader);
  if (header.alg !== 'RS256') throw new PartnerTrustVerificationError('Partner JWS alg must be exactly RS256');
  if (header.typ !== JWS_TYPE) throw new PartnerTrustVerificationError(`Partner JWS typ must be ${JWS_TYPE}`);
  if (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.length > 0)) {
    throw new PartnerTrustVerificationError('Partner JWS critical headers are not supported');
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
