import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EvidenceAccessDeniedError,
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
const SAFE_FILENAME_PATTERN = /[^A-Za-z0-9._-]+/g;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
  'application/json', 'application/octet-stream'
]);
const MAX_SIZE_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_TTL_MS = 5 * 60 * 1000;

export interface CreateEvidenceIntentInput {
  readonly roadEventId: string;
  readonly actorId: string;
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
    const actorId = requireIdentifier(input.actorId, 'actorId');
    const traceId = requireIdentifier(input.traceId, 'traceId');
    if (!(await this.authorization.canAccess(actorId, roadEventId, 'UPLOAD'))) throw new EvidenceAccessDeniedError('RoadEvent evidence upload is not authorized');
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) throw new EvidenceValidationError('contentType is not allowed');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_SIZE_BYTES) {
      throw new EvidenceValidationError(`sizeBytes must be between 1 and ${MAX_SIZE_BYTES}`);
    }
    const checksum = requireChecksum(input.checksumSha256);
    const filename = sanitizeFilename(input.filename);
    const now = this.now();
    if (!Number.isFinite(input.retention.retainUntil.getTime()) || input.retention.retainUntil <= now) {
      throw new EvidenceValidationError('retainUntil must be in the future');
    }
    const id = this.createId();
    const objectKey = `road-events/${roadEventId}/evidence/${id}/${filename}`;
    const uploadExpiresAt = new Date(now.getTime() + this.uploadTtlMs);
    const record: EvidenceRecord = {
      id, roadEventId, objectKey, originalFilename: filename,
      contentType: input.contentType, declaredSizeBytes: input.sizeBytes,
      declaredChecksumSha256: checksum, status: 'PENDING_UPLOAD', uploadExpiresAt,
      retention: { retainUntil: new Date(input.retention.retainUntil), legalHold: input.retention.legalHold },
      createdBy: actorId, createdAt: now
    };
    const upload = await this.storage.createUploadRequest(objectKey, input.contentType, input.sizeBytes, checksum, uploadExpiresAt);
    await this.repository.create(record, { actorId, traceId, action: 'evidence.upload_intent_created', occurredAt: now });
    return { evidence: record, upload };
  }

  async completeUpload(evidenceId: string, actorId: string, traceId: string): Promise<EvidenceRecord> {
    const record = await this.requireAuthorized(evidenceId, actorId, 'UPLOAD');
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
        actorId, traceId, action: 'evidence.quarantined', reason, occurredAt: now
      });
    }
    return this.repository.markPreserved(record.id, object.sizeBytes, object.checksumSha256.toLowerCase(), now, {
      actorId, traceId, action: 'evidence.preserved', occurredAt: now
    });
  }

  async createDownloadRequest(evidenceId: string, actorId: string): Promise<SignedObjectRequest> {
    const record = await this.requireAuthorized(evidenceId, actorId, 'DOWNLOAD');
    if (record.status !== 'PRESERVED') throw new EvidenceUnavailableError(`Evidence is ${record.status}`);
    return this.storage.createDownloadRequest(record.objectKey, new Date(this.now().getTime() + this.downloadTtlMs));
  }

  private async requireAuthorized(evidenceId: string, actorId: string, action: 'UPLOAD' | 'DOWNLOAD'): Promise<EvidenceRecord> {
    requireIdentifier(evidenceId, 'evidenceId');
    const normalizedActor = requireIdentifier(actorId, 'actorId');
    const record = await this.repository.findById(evidenceId);
    if (record === undefined) throw new EvidenceNotFoundError('Evidence was not found');
    if (!(await this.authorization.canAccess(normalizedActor, record.roadEventId, action))) {
      throw new EvidenceAccessDeniedError('Cross-event evidence access is not authorized');
    }
    return record;
  }
}
