import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EvidenceAccessDeniedError,
  EvidenceAccessPrincipal,
  EvidenceExpiredError,
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  EvidenceObjectStorage,
  EvidenceRecord,
  EvidenceRepository,
  EvidenceUnavailableError,
  EvidenceValidationError,
  MalwareScanner,
  RoadEventEvidenceAuthorization,
  SignedObjectRequest
} from './evidence-types.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ACCESS_ATTRIBUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_FILENAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
  'application/json', 'application/octet-stream'
]);
const MAX_SIZE_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MVP_STORAGE_RETENTION_DAYS = 365;
const MVP_STORAGE_RETENTION_MS = MVP_STORAGE_RETENTION_DAYS * DAY_MS;

export interface CreateEvidenceIntentInput {
  readonly roadEventId: string;
  readonly principal: EvidenceAccessPrincipal;
  readonly traceId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly retention: { readonly retainUntil: Date; readonly legalHold: boolean };
}

export interface EvidenceUploadIntent {
  readonly evidence: EvidenceRecord;
  readonly upload: SignedObjectRequest;
}

export interface EvidenceServiceOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly uploadTtlMs?: number;
  readonly downloadTtlMs?: number;
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) throw new EvidenceValidationError(`${field} is invalid`);
  return normalized;
}

function requirePrincipal(principal: EvidenceAccessPrincipal): EvidenceAccessPrincipal {
  const actorId = requireIdentifier(principal.actorId, 'actorId');
  const tenantId = requireIdentifier(principal.tenantId, 'tenantId');
  const purpose = requireIdentifier(principal.purpose, 'purpose');
  if (!ACCESS_ATTRIBUTE_PATTERN.test(tenantId) || !ACCESS_ATTRIBUTE_PATTERN.test(purpose)) {
    throw new EvidenceValidationError('Evidence access scope is invalid');
  }
  return { actorId, tenantId, purpose };
}

function requireChecksum(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new EvidenceValidationError('checksumSha256 must be a 64-character hexadecimal digest');
  return normalized;
}

function checksumsEqual(left: string, right: string): boolean {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.toLowerCase(), 'hex'), Buffer.from(right.toLowerCase(), 'hex'));
}

function sanitizeFilename(filename: string): string {
  const leaf = filename.trim().split(/[\\/]/).at(-1)?.replace(SAFE_FILENAME_PATTERN, '_') ?? '';
  if (leaf.length === 0 || leaf.length > 160) throw new EvidenceValidationError('filename is invalid');
  return leaf;
}

function requireMvpBoundedRetention(
  retention: CreateEvidenceIntentInput['retention'],
  now: Date
): EvidenceRecord['retention'] {
  const retainUntil = new Date(retention.retainUntil);
  if (!Number.isFinite(retainUntil.getTime()) || retainUntil <= now) {
    throw new EvidenceValidationError('retainUntil must be in the future');
  }
  if (retention.legalHold) {
    throw new EvidenceValidationError('legalHold is not supported by MVP_BOUNDED_RETENTION');
  }
  if (retainUntil.getTime() > now.getTime() + MVP_STORAGE_RETENTION_MS) {
    throw new EvidenceValidationError(
      `retainUntil exceeds the ${MVP_STORAGE_RETENTION_DAYS}-day MVP storage guarantee`
    );
  }
  return { retainUntil, legalHold: false };
}

export class EvidenceService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly uploadTtlMs: number;
  private readonly downloadTtlMs: number;

  constructor(
    private readonly repository: EvidenceRepository,
    private readonly storage: EvidenceObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly authorization: RoadEventEvidenceAuthorization,
    options: EvidenceServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.uploadTtlMs = options.uploadTtlMs ?? MAX_UPLOAD_TTL_MS;
    this.downloadTtlMs = options.downloadTtlMs ?? MAX_DOWNLOAD_TTL_MS;
    if (!Number.isSafeInteger(this.uploadTtlMs) || this.uploadTtlMs < 1 || this.uploadTtlMs > MAX_UPLOAD_TTL_MS) {
      throw new RangeError('uploadTtlMs is outside the permitted range');
    }
    if (!Number.isSafeInteger(this.downloadTtlMs) || this.downloadTtlMs < 1 || this.downloadTtlMs > MAX_DOWNLOAD_TTL_MS) {
      throw new RangeError('downloadTtlMs is outside the permitted range');
    }
  }

  async createUploadIntent(input: CreateEvidenceIntentInput): Promise<EvidenceUploadIntent> {
    const roadEventId = requireIdentifier(input.roadEventId, 'roadEventId');
    const principal = requirePrincipal(input.principal);
    const traceId = requireIdentifier(input.traceId, 'traceId');
    if (!(await this.authorization.canAccess(principal, roadEventId, 'UPLOAD'))) {
      throw new EvidenceAccessDeniedError('RoadEvent evidence upload is not authorized');
    }
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) throw new EvidenceValidationError('contentType is not allowed');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_SIZE_BYTES) {
      throw new EvidenceValidationError(`sizeBytes must be between 1 and ${MAX_SIZE_BYTES}`);
    }
    const checksum = requireChecksum(input.checksumSha256);
    const filename = sanitizeFilename(input.filename);
    const now = this.now();
    const retention = requireMvpBoundedRetention(input.retention, now);
    const id = this.createId();
    const objectKey = `road-events/${roadEventId}/evidence/${id}/${filename}`;
    const uploadExpiresAt = new Date(now.getTime() + this.uploadTtlMs);
    const record: EvidenceRecord = {
      id, roadEventId, objectKey, originalFilename: filename,
      contentType: input.contentType, declaredSizeBytes: input.sizeBytes,
      declaredChecksumSha256: checksum, status: 'PENDING_UPLOAD', uploadExpiresAt,
      retention,
      createdBy: principal.actorId, createdAt: now
    };
    const upload = await this.storage.createUploadRequest(objectKey, input.contentType, input.sizeBytes, checksum, uploadExpiresAt);
    await this.repository.create(record, { actorId: principal.actorId, traceId, action: 'evidence.upload_intent_created', occurredAt: now });
    return { evidence: record, upload };
  }

  async assertRoadEventAccess(
    roadEventId: string,
    principal: EvidenceAccessPrincipal,
    action: 'UPLOAD' | 'DOWNLOAD'
  ): Promise<void> {
    const scopedRoadEventId = requireIdentifier(roadEventId, 'roadEventId');
    const access = requirePrincipal(principal);
    if (!(await this.authorization.canAccess(access, scopedRoadEventId, action))) {
      throw new EvidenceAccessDeniedError('RoadEvent evidence access is not authorized');
    }
  }

  async getAuthorizedMetadata(
    evidenceId: string,
    principal: EvidenceAccessPrincipal,
    action: 'UPLOAD' | 'DOWNLOAD'
  ): Promise<EvidenceRecord> {
    return this.requireAuthorized(evidenceId, requirePrincipal(principal), action);
  }

  async completeUpload(evidenceId: string, principal: EvidenceAccessPrincipal, traceId: string): Promise<EvidenceRecord> {
    const access = requirePrincipal(principal);
    const record = await this.requireAuthorized(evidenceId, access, 'UPLOAD');
    const now = this.now();
    if (record.status !== 'PENDING_UPLOAD') throw new EvidenceValidationError(`Evidence cannot complete from ${record.status}`);
    if (now > record.uploadExpiresAt) throw new EvidenceExpiredError('Evidence upload intent expired');
    const object = await this.storage.inspect(record.objectKey);
    if (object === undefined) throw new EvidenceIntegrityError('Uploaded object was not found');
    if (object.contentType !== record.contentType || object.sizeBytes !== record.declaredSizeBytes) {
      throw new EvidenceIntegrityError('Uploaded object metadata does not match the intent');
    }
    if (!checksumsEqual(object.checksumSha256, record.declaredChecksumSha256)) {
      throw new EvidenceIntegrityError('Uploaded object checksum does not match the intent');
    }
    const scan = await this.scanner.scan(record.objectKey);
    if (scan.outcome !== 'CLEAN') {
      const reason = scan.reason.trim().slice(0, 500) || 'scanner rejected object';
      await this.storage.quarantine(record.objectKey, `quarantine/${record.id}`);
      return this.repository.markQuarantined(record.id, reason, now, {
        actorId: access.actorId, traceId, action: 'evidence.quarantined', reason, occurredAt: now
      });
    }
    return this.repository.markPreserved(record.id, object.sizeBytes, object.checksumSha256.toLowerCase(), now, {
      actorId: access.actorId, traceId, action: 'evidence.preserved', occurredAt: now
    });
  }

  async createDownloadRequest(
    evidenceId: string,
    principal: EvidenceAccessPrincipal,
    traceId: string
  ): Promise<SignedObjectRequest> {
    const access = requirePrincipal(principal);
    const scopedTraceId = requireIdentifier(traceId, 'traceId');
    const record = await this.requireAuthorized(evidenceId, access, 'DOWNLOAD');
    if (record.status !== 'PRESERVED') throw new EvidenceUnavailableError(`Evidence is ${record.status}`);
    const occurredAt = this.now();
    // Presigning is side-effect free in the storage adapter. Persist the audit
    // after successful signing but before returning the capability to a caller;
    // an audit failure therefore fails closed and never discloses the URL.
    const request = await this.storage.createDownloadRequest(
      record.objectKey,
      new Date(occurredAt.getTime() + this.downloadTtlMs)
    );
    await this.repository.appendAccessAudit(record, {
      actorId: access.actorId,
      traceId: scopedTraceId,
      action: 'evidence.download_intent_created',
      occurredAt
    });
    return request;
  }

  private async requireAuthorized(
    evidenceId: string,
    principal: EvidenceAccessPrincipal,
    action: 'UPLOAD' | 'DOWNLOAD'
  ): Promise<EvidenceRecord> {
    requireIdentifier(evidenceId, 'evidenceId');
    const record = await this.repository.findById(evidenceId);
    if (record === undefined || !(await this.authorization.canAccess(principal, record.roadEventId, action))) {
      // Do not disclose whether a cross-scope evidence identifier exists.
      throw new EvidenceNotFoundError('Evidence was not found');
    }
    return record;
  }
}
