import { createHash, createHmac } from 'node:crypto';
import { EvidenceObjectStorage, SignedObjectRequest, StoredObjectMetadata } from './evidence-types.js';

export interface MinioStorageOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireObjectKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || Buffer.byteLength(normalized, 'utf8') > 1024) {
    throw new TypeError('Object key must contain between 1 and 1024 UTF-8 bytes');
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) throw new TypeError('Object key contains control characters');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError('Object key contains an unsafe path segment');
  }
  return normalized;
}

function encodePath(value: string): string {
  return requireObjectKey(value).split('/').map((part) => encodeURIComponent(part)).join('/');
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalQuery(parameters: Readonly<Record<string, string>>): string {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function requireFutureExpiry(now: Date, expiresAt: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 900) {
    throw new RangeError('Signed request expiration must be between 1 and 900 seconds');
  }
  return seconds;
}

function sameMetadata(left: StoredObjectMetadata, right: StoredObjectMetadata): boolean {
  return left.sizeBytes === right.sizeBytes
    && left.contentType === right.contentType
    && left.checksumSha256 === right.checksumSha256;
}

export class MinioEvidenceStorageAdapter implements EvidenceObjectStorage {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: MinioStorageOptions) {
    this.endpoint = new URL(options.endpoint);
    if (!['http:', 'https:'].includes(this.endpoint.protocol)) throw new TypeError('MinIO endpoint must use HTTP or HTTPS');
    if (this.endpoint.username || this.endpoint.password || this.endpoint.hash || this.endpoint.search) {
      throw new TypeError('MinIO endpoint must not contain credentials, query parameters or a fragment');
    }
    if (options.region.trim().length === 0 || options.bucket.trim().length === 0) throw new TypeError('MinIO region and bucket are required');
    if (options.accessKeyId.trim().length === 0 || options.secretAccessKey.length < 8) throw new TypeError('MinIO credentials are invalid');
    if (options.sessionToken !== undefined && options.sessionToken.trim().length < 8) {
      throw new TypeError('MinIO session token is invalid');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async createUploadRequest(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    checksumSha256: string,
    expiresAt: Date
  ): Promise<SignedObjectRequest> {
    // S3 Object Lock retention requires an explicit upload-integrity algorithm declaration.
    const requiredHeaders = {
      'content-length': String(sizeBytes),
      'content-type': contentType,
      'x-amz-sdk-checksum-algorithm': 'SHA256',
      'x-amz-checksum-sha256': Buffer.from(checksumSha256, 'hex').toString('base64')
    };
    return {
      url: this.presign('PUT', objectKey, expiresAt, requiredHeaders),
      expiresAt: new Date(expiresAt),
      requiredHeaders
    };
  }

  async createDownloadRequest(objectKey: string, expiresAt: Date): Promise<SignedObjectRequest> {
    return { url: this.presign('GET', objectKey, expiresAt, {}), expiresAt: new Date(expiresAt), requiredHeaders: {} };
  }

  async inspect(objectKey: string): Promise<StoredObjectMetadata | undefined> {
    const expiresAt = new Date(this.now().getTime() + 60_000);
    const checksumHeaders = { 'x-amz-checksum-mode': 'ENABLED' };
    const response = await this.fetchImpl(
      this.presign('HEAD', objectKey, expiresAt, checksumHeaders),
      { method: 'HEAD', headers: checksumHeaders }
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Object metadata request failed with status ${response.status}`);
    const size = Number(response.headers.get('content-length'));
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const checksumBase64 = response.headers.get('x-amz-checksum-sha256') ?? '';
    const checksumSha256 = checksumBase64.length === 0 ? '' : Buffer.from(checksumBase64, 'base64').toString('hex');
    if (!Number.isSafeInteger(size) || size < 0 || contentType.length === 0 || checksumSha256.length !== 64) {
      throw new Error('Object storage returned incomplete evidence metadata');
    }
    return { sizeBytes: size, contentType, checksumSha256 };
  }

  async quarantine(objectKey: string, quarantineKey: string): Promise<void> {
    const sourceMetadata = await this.inspect(objectKey);
    if (sourceMetadata === undefined) throw new Error('Object quarantine source does not exist');

    const expiresAt = new Date(this.now().getTime() + 60_000);
    const copySource = `/${this.options.bucket}/${encodePath(objectKey)}`;
    const copy = await this.fetchImpl(this.presign('PUT', quarantineKey, expiresAt, { 'x-amz-copy-source': copySource }), {
      method: 'PUT',
      headers: { 'x-amz-copy-source': copySource }
    });
    if (!copy.ok) throw new Error(`Object quarantine copy failed with status ${copy.status}`);

    const quarantineMetadata = await this.inspect(quarantineKey);
    if (quarantineMetadata === undefined || !sameMetadata(sourceMetadata, quarantineMetadata)) {
      throw new Error('Object quarantine verification failed; original object was retained');
    }

    // Quarantine is intentionally copy-and-retain. EvidenceService marks the
    // record QUARANTINED, so normal downloads are blocked by domain state.
    // Deleting the source would create a delete marker in versioned WORM/S3
    // stores and could obscure retained evidence even though its version remains.
  }

  async checkReadiness(signal?: AbortSignal): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + 30_000);
    const response = await this.fetchImpl(this.presign('HEAD', '', expiresAt, {}), {
      method: 'HEAD',
      ...(signal === undefined ? {} : { signal })
    });
    if (!response.ok) throw new Error(`Object-storage bucket readiness failed with status ${response.status}`);
  }

  private presign(method: string, objectKey: string, expiresAt: Date, headers: Readonly<Record<string, string>>): string {
    const now = this.now();
    const expires = requireFutureExpiry(now, expiresAt);
    const { amzDate, dateStamp } = formatAmzDate(now);
    const credentialScope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const host = this.endpoint.host;
    const bucketUri = `${this.endpoint.pathname.replace(/\/$/, '')}/${encodeURIComponent(this.options.bucket)}`;
    const canonicalUri = `${bucketUri}${objectKey.length === 0 ? '' : `/${encodePath(objectKey)}`}`.replace(/\/+/g, '/');
    const normalizedHeaders: Record<string, string> = { host };
    for (const [key, value] of Object.entries(headers)) normalizedHeaders[key.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
    const signedHeaders = Object.keys(normalizedHeaders).sort().join(';');
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.options.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': signedHeaders
    };
    if (this.options.sessionToken !== undefined) {
      query['X-Amz-Security-Token'] = this.options.sessionToken;
    }
    const canonicalHeaders = Object.entries(normalizedHeaders)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value}\n`)
      .join('');
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery(query),
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD'
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const url = new URL(this.endpoint.toString());
    url.pathname = canonicalUri;
    url.search = `${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
    return url.toString();
  }
}

export const S3_EMPTY_PAYLOAD_SHA256 = EMPTY_PAYLOAD_HASH;
