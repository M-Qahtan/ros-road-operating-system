import { createHash, createHmac } from 'node:crypto';
import {
  EvidenceObjectStorage,
  SignedObjectRequest,
  StoredObjectMetadata
} from './evidence-types.js';
import { MinioEvidenceStorageAdapter } from './minio-storage-adapter.js';

const MIN_CREDENTIAL_MARGIN_MS = 30_000;
const ECS_TASK_CREDENTIALS_ORIGIN = 'http://169.254.170.2';
const ECS_TASK_CREDENTIALS_PATH_PREFIX = '/v2/credentials/';
const ECS_TASK_CREDENTIALS_TIMEOUT_MS = 2_000;
const MAX_ECS_TASK_CREDENTIAL_RESPONSE_BYTES = 16 * 1024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export interface ObjectStorageCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiresAt?: Date;
}

export interface ObjectStorageCredentialProviderPort {
  resolve(): Promise<ObjectStorageCredentials>;
}

export interface EvidenceObjectStorageRuntime extends EvidenceObjectStorage {
  checkReadiness(signal?: AbortSignal): Promise<void>;
}

export interface ObjectStorageRuntimeOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly production: boolean;
  readonly credentialProvider: ObjectStorageCredentialProviderPort;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export class ObjectStorageRuntimeConfigurationError extends Error {
  override readonly name = 'ObjectStorageRuntimeConfigurationError';
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ObjectStorageRuntimeConfigurationError(`${name} is required`);
  return value;
}

function requireEndpoint(raw: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ObjectStorageRuntimeConfigurationError('OBJECT_STORAGE_ENDPOINT is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ObjectStorageRuntimeConfigurationError('OBJECT_STORAGE_ENDPOINT must use HTTP or HTTPS');
  }
  if (production && url.protocol !== 'https:') {
    throw new ObjectStorageRuntimeConfigurationError('Production object storage must use HTTPS');
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new ObjectStorageRuntimeConfigurationError(
      'OBJECT_STORAGE_ENDPOINT must be a credential-free origin without query parameters or fragment'
    );
  }
  return url.toString().replace(/\/$/, '');
}

function validCredentialText(value: string, field: string, minimum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > 4096) {
    throw new ObjectStorageRuntimeConfigurationError(`${field} is invalid`);
  }
  return normalized;
}

function parseExpiry(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const expiry = new Date(raw);
  if (!Number.isFinite(expiry.getTime())) {
    throw new ObjectStorageRuntimeConfigurationError('OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT must be an ISO timestamp');
  }
  return expiry;
}

function requireFreshTemporaryCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string | undefined,
  expiresAt: Date | undefined,
  now: Date
): ObjectStorageCredentials {
  if (sessionToken === undefined || expiresAt === undefined) {
    throw new ObjectStorageRuntimeConfigurationError(
      'Production object storage requires temporary session credentials with an explicit expiry'
    );
  }
  if (expiresAt.getTime() <= now.getTime() + MIN_CREDENTIAL_MARGIN_MS) {
    throw new ObjectStorageRuntimeConfigurationError('Object-storage credentials are expired or too close to expiry');
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAt: new Date(expiresAt)
  };
}

export class EnvironmentObjectStorageCredentialProvider implements ObjectStorageCredentialProviderPort {
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly production: boolean,
    private readonly now: () => Date = () => new Date()
  ) {}

  async resolve(): Promise<ObjectStorageCredentials> {
    const accessKeyId = validCredentialText(
      required(this.environment, 'OBJECT_STORAGE_ACCESS_KEY'),
      'OBJECT_STORAGE_ACCESS_KEY',
      1
    );
    const secretAccessKey = validCredentialText(
      required(this.environment, 'OBJECT_STORAGE_SECRET_KEY'),
      'OBJECT_STORAGE_SECRET_KEY',
      8
    );
    const sessionTokenRaw = this.environment.OBJECT_STORAGE_SESSION_TOKEN?.trim();
    const sessionToken = sessionTokenRaw === undefined || sessionTokenRaw === ''
      ? undefined
      : validCredentialText(sessionTokenRaw, 'OBJECT_STORAGE_SESSION_TOKEN', 8);
    const expiresAt = parseExpiry(this.environment.OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT);

    if (this.production) {
      return requireFreshTemporaryCredentials(
        accessKeyId,
        secretAccessKey,
        sessionToken,
        expiresAt,
        this.now()
      );
    }
    if (expiresAt !== undefined && expiresAt.getTime() <= this.now().getTime() + MIN_CREDENTIAL_MARGIN_MS) {
      throw new ObjectStorageRuntimeConfigurationError('Object-storage credentials are expired or too close to expiry');
    }

    return {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
      ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt) })
    };
  }
}

function ecsTaskCredentialEndpoint(environment: NodeJS.ProcessEnv): string {
  const relativeUri = required(environment, 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI');
  if (
    CONTROL_CHARACTER_PATTERN.test(relativeUri) ||
    !relativeUri.startsWith(ECS_TASK_CREDENTIALS_PATH_PREFIX) ||
    relativeUri.includes('\\') ||
    relativeUri.includes('?') ||
    relativeUri.includes('#') ||
    relativeUri.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new ObjectStorageRuntimeConfigurationError(
      'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI is outside the approved ECS task-role credential path'
    );
  }

  const endpoint = new URL(relativeUri, ECS_TASK_CREDENTIALS_ORIGIN);
  if (
    endpoint.origin !== ECS_TASK_CREDENTIALS_ORIGIN ||
    !endpoint.pathname.startsWith(ECS_TASK_CREDENTIALS_PATH_PREFIX) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ObjectStorageRuntimeConfigurationError(
      'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI resolved outside the approved ECS task-role endpoint'
    );
  }
  return endpoint.toString();
}

function credentialResponseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ObjectStorageRuntimeConfigurationError('ECS task-role credential response is malformed');
  }
  return value as Record<string, unknown>;
}

function credentialResponseField(record: Record<string, unknown>, field: string, minimum: number): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new ObjectStorageRuntimeConfigurationError(`ECS task-role credential response is missing ${field}`);
  }
  return validCredentialText(value, `ECS_${field}`, minimum);
}

/**
 * Resolves automatically rotated ECS/Fargate task-role credentials from the
 * link-local container credential endpoint. Only the ECS relative-URI contract
 * is accepted; caller-controlled full credential URLs are deliberately rejected.
 */
export class EcsTaskRoleObjectStorageCredentialProvider implements ObjectStorageCredentialProviderPort {
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async resolve(): Promise<ObjectStorageCredentials> {
    const endpoint = ecsTaskCredentialEndpoint(this.environment);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ECS_TASK_CREDENTIALS_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal
      });
    } catch {
      throw new ObjectStorageRuntimeConfigurationError('ECS task-role credential request failed');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ObjectStorageRuntimeConfigurationError(
        `ECS task-role credential endpoint returned status ${response.status}`
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declaredBytes = Number(contentLength);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_ECS_TASK_CREDENTIAL_RESPONSE_BYTES) {
        throw new ObjectStorageRuntimeConfigurationError('ECS task-role credential response is oversized');
      }
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_ECS_TASK_CREDENTIAL_RESPONSE_BYTES) {
      throw new ObjectStorageRuntimeConfigurationError('ECS task-role credential response is oversized');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ObjectStorageRuntimeConfigurationError('ECS task-role credential response is not valid JSON');
    }
    const record = credentialResponseObject(parsed);
    const accessKeyId = credentialResponseField(record, 'AccessKeyId', 1);
    const secretAccessKey = credentialResponseField(record, 'SecretAccessKey', 8);
    const sessionToken = credentialResponseField(record, 'Token', 8);
    const expiration = credentialResponseField(record, 'Expiration', 1);
    const expiresAt = parseExpiry(expiration);

    return requireFreshTemporaryCredentials(
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiresAt,
      this.now()
    );
  }
}

function defaultCredentialProvider(
  environment: NodeJS.ProcessEnv,
  production: boolean,
  credentialFetchImpl?: typeof fetch
): ObjectStorageCredentialProviderPort {
  const relativeUri = environment.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim();
  if (relativeUri !== undefined && relativeUri !== '') {
    return new EcsTaskRoleObjectStorageCredentialProvider(
      environment,
      credentialFetchImpl ?? fetch
    );
  }
  if ((environment.AWS_CONTAINER_CREDENTIALS_FULL_URI ?? '').trim() !== '') {
    throw new ObjectStorageRuntimeConfigurationError(
      'AWS_CONTAINER_CREDENTIALS_FULL_URI is not accepted by ROS; use ECS relative task-role credentials or inject a trusted provider'
    );
  }
  return new EnvironmentObjectStorageCredentialProvider(environment, production);
}

/**
 * Resolves credentials for every signed operation. This keeps EvidenceService
 * independent from the credential source and allows IAM/STS rotation without
 * changing evidence domain logic.
 */
export class RotatingMinioEvidenceStorageAdapter implements EvidenceObjectStorage {
  private readonly now: () => Date;

  constructor(private readonly options: ObjectStorageRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    requireEndpoint(options.endpoint, options.production);
    if (!options.region.trim() || !options.bucket.trim()) {
      throw new ObjectStorageRuntimeConfigurationError('Object-storage region and bucket are required');
    }
  }

  async createUploadRequest(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    checksumSha256: string,
    expiresAt: Date
  ): Promise<SignedObjectRequest> {
    const adapter = await this.adapterFor(expiresAt);
    return adapter.createUploadRequest(objectKey, contentType, sizeBytes, checksumSha256, expiresAt);
  }

  async createDownloadRequest(objectKey: string, expiresAt: Date): Promise<SignedObjectRequest> {
    const adapter = await this.adapterFor(expiresAt);
    return adapter.createDownloadRequest(objectKey, expiresAt);
  }

  async inspect(objectKey: string): Promise<StoredObjectMetadata | undefined> {
    const adapter = await this.adapterFor(new Date(this.now().getTime() + 60_000));
    return adapter.inspect(objectKey);
  }

  async quarantine(objectKey: string, quarantineKey: string): Promise<void> {
    const adapter = await this.adapterFor(new Date(this.now().getTime() + 60_000));
    return adapter.quarantine(objectKey, quarantineKey);
  }

  async checkReadiness(signal?: AbortSignal): Promise<void> {
    const adapter = await this.adapterFor(new Date(this.now().getTime() + 30_000));
    await adapter.checkReadiness(signal);
  }

  private async adapterFor(operationExpiresAt: Date): Promise<MinioEvidenceStorageAdapter> {
    if (!Number.isFinite(operationExpiresAt.getTime())) {
      throw new ObjectStorageRuntimeConfigurationError('Object-storage operation expiry is invalid');
    }
    const credentials = await this.options.credentialProvider.resolve();
    if (
      credentials.expiresAt !== undefined &&
      credentials.expiresAt.getTime() <= operationExpiresAt.getTime() + MIN_CREDENTIAL_MARGIN_MS
    ) {
      throw new ObjectStorageRuntimeConfigurationError(
        'Temporary object-storage credentials do not outlive the signed operation safety margin'
      );
    }
    return new MinioEvidenceStorageAdapter({
      endpoint: requireEndpoint(this.options.endpoint, this.options.production),
      region: this.options.region,
      bucket: this.options.bucket,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
      now: this.now
    });
  }
}

export function createEvidenceObjectStorageForRuntime(
  environment: NodeJS.ProcessEnv,
  dependencies: {
    readonly credentialProvider?: ObjectStorageCredentialProviderPort;
    readonly fetchImpl?: typeof fetch;
    readonly credentialFetchImpl?: typeof fetch;
  } = {}
): EvidenceObjectStorageRuntime {
  const production = (environment.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const now = () => new Date();
  const provider = dependencies.credentialProvider ?? defaultCredentialProvider(
    environment,
    production,
    dependencies.credentialFetchImpl
  );
  return new RotatingMinioEvidenceStorageAdapter({
    endpoint: requireEndpoint(required(environment, 'OBJECT_STORAGE_ENDPOINT'), production),
    region: required(environment, 'OBJECT_STORAGE_REGION'),
    bucket: required(environment, 'OBJECT_STORAGE_BUCKET'),
    production,
    credentialProvider: provider,
    ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl }),
    now
  });
}
