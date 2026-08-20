import { KeyObject, verify } from 'node:crypto';
import { OidcTokenVerifierPort, VerifiedOidcClaims } from './integration-principal.js';

const MAX_TOKEN_BYTES = 16 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_RSA_MODULUS_BITS = 2048;

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
  readonly crit?: unknown;
}

interface JwtPayload {
  readonly sub?: unknown;
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly azp?: unknown;
  readonly client_id?: unknown;
  readonly tenant_id?: unknown;
  readonly purpose?: unknown;
  readonly amr?: unknown;
  readonly iat?: unknown;
  readonly exp?: unknown;
}

export interface OidcVerificationKeyProviderPort {
  resolveRs256PublicKey(kid: string): Promise<KeyObject | undefined>;
}

export class OidcTokenVerificationError extends Error {
  override readonly name = 'OidcTokenVerificationError';
}

function requireBase64Url(segment: string, field: string): string {
  if (!BASE64URL_PATTERN.test(segment)) {
    throw new OidcTokenVerificationError(`JWT ${field} is not canonical base64url`);
  }
  return segment;
}

function decodeJson<T>(segment: string, field: string): T {
  requireBase64Url(segment, field);
  try {
    const decoded = Buffer.from(segment, 'base64url').toString('utf8');
    const value = JSON.parse(decoded) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as T;
  } catch (error) {
    if (error instanceof OidcTokenVerificationError) throw error;
    throw new OidcTokenVerificationError(`JWT ${field} is not valid base64url JSON`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OidcTokenVerificationError(`JWT ${field} claim is required`);
  }
  return value.trim();
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new OidcTokenVerificationError(`JWT ${field} claim must be a positive integer`);
  }
  return value;
}

function parseAudience(value: unknown): string | readonly string[] {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    return value.map((item) => (item as string).trim());
  }
  throw new OidcTokenVerificationError('JWT aud claim is required');
}

function parseAuthenticationMethods(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new OidcTokenVerificationError('JWT amr claim must be a string array');
  }
  return value.map((item) => (item as string).trim());
}

function assertStrongRs256Key(publicKey: KeyObject): void {
  if (publicKey.type !== 'public') throw new OidcTokenVerificationError('JWT verification key must be public');
  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new OidcTokenVerificationError('JWT verification key must be RSA');
  }
  const modulusLength = publicKey.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== 'number' || modulusLength < MIN_RSA_MODULUS_BITS) {
    throw new OidcTokenVerificationError(`JWT RSA verification key must be at least ${MIN_RSA_MODULUS_BITS} bits`);
  }
}

export class Rs256OidcTokenVerifier implements OidcTokenVerifierPort {
  constructor(private readonly keys: OidcVerificationKeyProviderPort) {}

  async verifyBearerToken(token: string): Promise<VerifiedOidcClaims> {
    if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
      throw new OidcTokenVerificationError('JWT exceeds maximum allowed size');
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new OidcTokenVerificationError('JWT must contain header, payload and signature');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = decodeJson<JwtHeader>(encodedHeader, 'header');

    if (header.alg !== 'RS256') throw new OidcTokenVerificationError('JWT alg must be exactly RS256');
    if (header.typ !== undefined && header.typ !== 'JWT') {
      throw new OidcTokenVerificationError('JWT typ is not supported');
    }
    if (header.crit !== undefined) {
      if (!Array.isArray(header.crit) || header.crit.length > 0) {
        throw new OidcTokenVerificationError('JWT critical headers are not supported');
      }
    }
    const kid = requiredString(header.kid, 'kid');
    const publicKey = await this.keys.resolveRs256PublicKey(kid);
    if (publicKey === undefined) throw new OidcTokenVerificationError('JWT signing key is not trusted');
    assertStrongRs256Key(publicKey);

    requireBase64Url(encodedSignature, 'signature');
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (signature.length === 0) throw new OidcTokenVerificationError('JWT signature is empty');

    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii');
    if (!verify('RSA-SHA256', signingInput, publicKey, signature)) {
      throw new OidcTokenVerificationError('JWT signature verification failed');
    }

    const payload = decodeJson<JwtPayload>(encodedPayload, 'payload');
    const clientId =
      typeof payload.azp === 'string' && payload.azp.trim().length > 0
        ? payload.azp.trim()
        : requiredString(payload.client_id, 'client_id/azp');

    return Object.freeze({
      subject: requiredString(payload.sub, 'sub'),
      issuer: requiredString(payload.iss, 'iss'),
      audience: parseAudience(payload.aud),
      clientId,
      tenantId: requiredString(payload.tenant_id, 'tenant_id'),
      purpose: requiredString(payload.purpose, 'purpose'),
      authenticationMethods: parseAuthenticationMethods(payload.amr),
      issuedAtEpochSeconds: requiredInteger(payload.iat, 'iat'),
      expiresAtEpochSeconds: requiredInteger(payload.exp, 'exp')
    });
  }
}
