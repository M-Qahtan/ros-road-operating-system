export const EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA = 'ros.epistemic-independence-lease/v1' as const;

export interface EpistemicIndependenceLease {
  readonly schema: typeof EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA;
  readonly leaseId: string;
  readonly independenceClassDigest: string;
  readonly observationIds: readonly string[];
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly eventEpoch: string;
  readonly objectBinding: string;
  readonly roadStateDigest: string;
  readonly sourceLineageDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authority: 'NONE';
}

export type EvidenceClaimValue = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export interface EvidenceClaim {
  readonly claimId: string;
  readonly observationId: string;
  readonly objectBinding: string;
  readonly claimType: string;
  readonly value: EvidenceClaimValue;
  readonly confidence: number;
}

export type EvidenceAssuranceDecision =
  | 'CORROBORATED'
  | 'INSUFFICIENT_INDEPENDENCE'
  | 'CONTRADICTED'
  | 'ABSTAIN';

export interface EvidenceAssuranceResult {
  readonly objectBinding: string;
  readonly claimType: string;
  readonly decision: EvidenceAssuranceDecision;
  readonly effectiveIndependentEvidence: number;
  readonly rawClaimCount: number;
  readonly supportingIndependenceClasses: readonly string[];
  readonly contradictingIndependenceClasses: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function validateEpistemicIndependenceLease(
  lease: EpistemicIndependenceLease,
  trustedNowEpochMs: number,
): readonly string[] {
  const errors: string[] = [];
  if (lease.schema !== EPISTEMIC_INDEPENDENCE_LEASE_SCHEMA) errors.push('UNSUPPORTED_SCHEMA');
  if (!lease.leaseId.trim()) errors.push('MISSING_LEASE_ID');
  if (!SHA256_HEX.test(lease.independenceClassDigest)) errors.push('INVALID_INDEPENDENCE_CLASS_DIGEST');
  if (!SHA256_HEX.test(lease.roadStateDigest)) errors.push('INVALID_ROAD_STATE_DIGEST');
  if (!SHA256_HEX.test(lease.sourceLineageDigest)) errors.push('INVALID_SOURCE_LINEAGE_DIGEST');
  if (lease.observationIds.length === 0) errors.push('MISSING_OBSERVATION_BINDING');
  if (!lease.purpose.trim()) errors.push('MISSING_PURPOSE');
  if (!lease.jurisdiction.trim()) errors.push('MISSING_JURISDICTION');
  if (!lease.eventEpoch.trim()) errors.push('MISSING_EVENT_EPOCH');
  if (!lease.objectBinding.trim()) errors.push('MISSING_OBJECT_BINDING');
  if (lease.authority !== 'NONE') errors.push('AUTHORITY_IMPORT_FORBIDDEN');

  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    errors.push('INVALID_LEASE_TIME');
  } else {
    if (issuedAt > trustedNowEpochMs + 1_000) errors.push('LEASE_FROM_FUTURE');
    if (expiresAt <= trustedNowEpochMs) errors.push('LEASE_EXPIRED');
    if (expiresAt <= issuedAt) errors.push('INVALID_LEASE_WINDOW');
  }

  return errors;
}
