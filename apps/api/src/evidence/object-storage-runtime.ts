import {
  EvidenceObjectStorage,
  SignedObjectRequest,
  StoredObjectMetadata
} from './evidence-types.js';
import { MinioEvidenceStorageAdapter } from './minio-storage-adapter.js';

const MIN_CREDENTIAL_MARGIN_MS = 30_000;

export interface ObjectStorageCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiresAt?: Date;
}

export interface ObjectStorageCredentialProviderPort {
  resolve(): Promise<ObjectStorageCredentials>;
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

    if (this.production && (sessionToken === undefined || expiresAt === undefined)) {
      throw new ObjectStorageRuntimeConfigurationError(
        'Production object storage requires temporary session credentials with an explicit expiry'
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

/**
 * Resolves credentials for every signed operation. This keeps EvidenceService
 * independent from the credential source and allows a future IAM/STS metadata
 * provider without changing evidence domain logic.
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
  dependencies: { readonly credentialProvider?: ObjectStorageCredentialProviderPort; readonly fetchImpl?: typeof fetch } = {}
): EvidenceObjectStorage {
  const production = (environment.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const now = () => new Date();
  const provider = dependencies.credentialProvider ?? new EnvironmentObjectStorageCredentialProvider(
    environment,
    production,
    now
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
