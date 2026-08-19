import { createPublicKey, KeyObject } from 'node:crypto';
import { OidcVerificationKeyProviderPort } from './oidc-rs256-verifier.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_KID_LENGTH = 128;
const DEFAULT_MAXIMUM_KEYS = 64;

interface JwksKeyRecord {
  readonly kid?: unknown;
  readonly kty?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly key_ops?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
}

interface JwksDocument {
  readonly keys?: unknown;
}

export interface JwksDocumentFetcherPort {
  fetchJwks(): Promise<unknown>;
}

export interface CachedJwksProviderOptions {
  readonly cacheTtlSeconds: number;
  readonly minimumRefreshIntervalSeconds?: number;
  readonly maximumKeys?: number;
  readonly nowEpochSeconds?: () => number;
}

export class JwksProviderError extends Error {
  override readonly name = 'JwksProviderError';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new JwksProviderError(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new JwksProviderError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function canonicalKid(value: string): string {
  const kid = value.trim();
  if (kid.length === 0 || kid.length > MAX_KID_LENGTH) {
    throw new JwksProviderError(`JWKS kid must contain between 1 and ${MAX_KID_LENGTH} characters`);
  }
  return kid;
}

function canonicalBase64Url(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    throw new JwksProviderError(`JWKS RSA ${field} must be canonical base64url`);
  }
  return value;
}

function parseKeyOperations(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new JwksProviderError('JWKS key_ops must be a string array when present');
  }
  return value.map((item) => (item as string).trim());
}

function toRs256Key(record: JwksKeyRecord): { readonly kid: string; readonly key: KeyObject } | undefined {
  if (record.kty !== 'RSA') return undefined;
  if (record.alg !== undefined && record.alg !== 'RS256') return undefined;
  if (record.use !== undefined && record.use !== 'sig') return undefined;

  const operations = parseKeyOperations(record.key_ops);
  if (operations !== undefined && !operations.includes('verify')) return undefined;

  if (typeof record.kid !== 'string') throw new JwksProviderError('Eligible JWKS RSA key is missing kid');
  const kid = canonicalKid(record.kid);
  const n = canonicalBase64Url(record.n, 'modulus');
  const e = canonicalBase64Url(record.e, 'exponent');

  try {
    const key = createPublicKey({
      key: { kty: 'RSA', n, e },
      format: 'jwk'
    });
    return { kid, key };
  } catch {
    throw new JwksProviderError(`JWKS RSA key ${kid} could not be imported`);
  }
}

function parseJwks(document: unknown, maximumKeys: number): Map<string, KeyObject> {
  if (!isRecord(document)) throw new JwksProviderError('JWKS document must be an object');
  const keys = (document as JwksDocument).keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new JwksProviderError('JWKS document must contain a non-empty keys array');
  }
  if (keys.length > maximumKeys) {
    throw new JwksProviderError(`JWKS document exceeds the configured ${maximumKeys}-key limit`);
  }

  const parsed = new Map<string, KeyObject>();
  for (const raw of keys) {
    if (!isRecord(raw)) throw new JwksProviderError('JWKS key entries must be objects');
    const candidate = toRs256Key(raw as JwksKeyRecord);
    if (candidate === undefined) continue;
    if (parsed.has(candidate.kid)) {
      throw new JwksProviderError(`JWKS contains duplicate kid ${candidate.kid}`);
    }
    parsed.set(candidate.kid, candidate.key);
  }

  if (parsed.size === 0) {
    throw new JwksProviderError('JWKS contains no usable RS256 verification keys');
  }
  return parsed;
}

/**
 * Fail-closed RS256 JWKS cache.
 *
 * - A missing kid forces an early refresh after the configured minimum interval,
 *   enabling deterministic key rotation without waiting for the cache TTL.
 * - Refresh atomically replaces the entire key set, so a key removed by the
 *   authoritative JWKS is immediately revoked from the cache.
 * - Expired keys are never served when refresh fails; outages therefore deny
 *   verification rather than silently extending stale trust.
 * - Concurrent refreshes are collapsed into one fetch to avoid a refresh storm.
 */
export class CachedJwksRs256KeyProvider implements OidcVerificationKeyProviderPort {
  private readonly cacheTtlSeconds: number;
  private readonly minimumRefreshIntervalSeconds: number;
  private readonly maximumKeys: number;
  private readonly nowEpochSeconds: () => number;
  private keys = new Map<string, KeyObject>();
  private expiresAtEpochSeconds = 0;
  private lastRefreshAttemptEpochSeconds = 0;
  private refreshInFlight: Promise<void> | undefined;

  constructor(
    private readonly fetcher: JwksDocumentFetcherPort,
    options: CachedJwksProviderOptions
  ) {
    this.cacheTtlSeconds = positiveInteger(options.cacheTtlSeconds, 'cacheTtlSeconds');
    this.minimumRefreshIntervalSeconds = nonNegativeInteger(
      options.minimumRefreshIntervalSeconds ?? 5,
      'minimumRefreshIntervalSeconds'
    );
    this.maximumKeys = positiveInteger(options.maximumKeys ?? DEFAULT_MAXIMUM_KEYS, 'maximumKeys');
    this.nowEpochSeconds = options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async resolveRs256PublicKey(rawKid: string): Promise<KeyObject | undefined> {
    const kid = canonicalKid(rawKid);
    const now = this.readClock();

    if (this.keys.size === 0 || now >= this.expiresAtEpochSeconds) {
      await this.refresh(now);
    }

    const cached = this.keys.get(kid);
    if (cached !== undefined) return cached;

    if (now - this.lastRefreshAttemptEpochSeconds < this.minimumRefreshIntervalSeconds) {
      return undefined;
    }

    await this.refresh(now);
    return this.keys.get(kid);
  }

  private readClock(): number {
    const now = this.nowEpochSeconds();
    if (!Number.isSafeInteger(now) || now < 1) {
      throw new JwksProviderError('JWKS provider clock is invalid');
    }
    return now;
  }

  private async refresh(now: number): Promise<void> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;

    this.lastRefreshAttemptEpochSeconds = now;
    const refresh = this.performRefresh(now).finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  private async performRefresh(now: number): Promise<void> {
    let document: unknown;
    try {
      document = await this.fetcher.fetchJwks();
    } catch {
      throw new JwksProviderError('JWKS refresh failed; refusing stale or unknown signing keys');
    }

    const nextKeys = parseJwks(document, this.maximumKeys);
    this.keys = nextKeys;
    this.expiresAtEpochSeconds = now + this.cacheTtlSeconds;
  }
}
