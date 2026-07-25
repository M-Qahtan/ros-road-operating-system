export type EvidenceStatus = 'PENDING_UPLOAD' | 'SCANNING' | 'PRESERVED' | 'QUARANTINED';
export type EvidenceAccessAction = 'UPLOAD' | 'DOWNLOAD';

export interface EvidenceRetentionPolicy {
  readonly retainUntil: Date;
  readonly legalHold: boolean;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly roadEventId: string;
  readonly objectKey: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly declaredSizeBytes: number;
  readonly actualSizeBytes?: number;
  readonly declaredChecksumSha256: string;
  readonly verifiedChecksumSha256?: string;
  readonly status: EvidenceStatus;
  readonly uploadExpiresAt: Date;
  readonly retention: EvidenceRetentionPolicy;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly completedAt?: Date;
  readonly quarantineReason?: string;
}

export interface EvidenceAuditContext {
  readonly actorId: string;
  readonly traceId: string;
  readonly action: string;
  readonly reason?: string;
  readonly occurredAt?: Date;
}

export interface EvidenceRepository {
  create(record: EvidenceRecord, audit: EvidenceAuditContext): Promise<void>;
  findById(id: string): Promise<EvidenceRecord | undefined>;
  markPreserved(
    id: string,
    actualSizeBytes: number,
    verifiedChecksumSha256: string,
    completedAt: Date,
    audit: EvidenceAuditContext
  ): Promise<EvidenceRecord>;
  markQuarantined(id: string, reason: string, occurredAt: Date, audit: EvidenceAuditContext): Promise<EvidenceRecord>;
}

export interface RoadEventEvidenceAuthorization {
  canAccess(actorId: string, roadEventId: string, action: EvidenceAccessAction): Promise<boolean>;
}

export interface StoredObjectMetadata {
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly contentType: string;
}

export interface SignedObjectRequest {
  readonly url: string;
  readonly expiresAt: Date;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

export interface EvidenceObjectStorage {
  createUploadRequest(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    checksumSha256: string,
    expiresAt: Date
  ): Promise<SignedObjectRequest>;
  createDownloadRequest(objectKey: string, expiresAt: Date): Promise<SignedObjectRequest>;
  inspect(objectKey: string): Promise<StoredObjectMetadata | undefined>;
  quarantine(objectKey: string, quarantineKey: string): Promise<void>;
}

export type MalwareScanResult =
  | { readonly outcome: 'CLEAN' }
  | { readonly outcome: 'MALICIOUS'; readonly reason: string }
  | { readonly outcome: 'ERROR'; readonly reason: string };

export interface MalwareScanner {
  scan(objectKey: string): Promise<MalwareScanResult>;
}

export class EvidenceValidationError extends Error { override readonly name = 'EvidenceValidationError'; }
export class EvidenceAccessDeniedError extends Error { override readonly name = 'EvidenceAccessDeniedError'; }
export class EvidenceNotFoundError extends Error { override readonly name = 'EvidenceNotFoundError'; }
export class EvidenceExpiredError extends Error { override readonly name = 'EvidenceExpiredError'; }
export class EvidenceIntegrityError extends Error { override readonly name = 'EvidenceIntegrityError'; }
export class EvidenceUnavailableError extends Error { override readonly name = 'EvidenceUnavailableError'; }
