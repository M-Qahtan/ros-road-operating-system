import { createHash } from 'node:crypto';
import type { EvidenceRecord } from './evidence-types.js';

export interface EvidenceRevisionScope {
  readonly tenantId: string;
  readonly purpose: string;
  readonly caseId: string;
}

export function evidenceRevisionDigest(
  scope: EvidenceRevisionScope,
  records: readonly EvidenceRecord[]
): string {
  const material = {
    policyVersion: 'ros.evidence-revision.v1',
    tenantId: scope.tenantId,
    purpose: scope.purpose,
    caseId: scope.caseId,
    evidence: [...records]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => ({
        id: record.id,
        objectKey: record.objectKey,
        originalFilename: record.originalFilename,
        contentType: record.contentType,
        declaredSizeBytes: record.declaredSizeBytes,
        actualSizeBytes: record.actualSizeBytes ?? null,
        declaredChecksumSha256: record.declaredChecksumSha256,
        verifiedChecksumSha256: record.verifiedChecksumSha256 ?? null,
        status: record.status,
        uploadExpiresAt: record.uploadExpiresAt.toISOString(),
        retainUntil: record.retention.retainUntil.toISOString(),
        legalHold: record.retention.legalHold,
        createdBy: record.createdBy,
        createdAt: record.createdAt.toISOString(),
        completedAt: record.completedAt?.toISOString() ?? null,
        quarantineReason: record.quarantineReason ?? null
      }))
  };
  return createHash('sha256').update(canonicalize(material), 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
}
