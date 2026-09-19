import {
  assessSensorObservationAdmission,
  validateEpistemicIndependenceLease,
  type EpistemicIndependenceLease,
  type EvidenceAssuranceResult,
  type EvidenceClaim,
  type SensorObservationEnvelope,
} from '@ros/contracts';

export interface EvidenceAssuranceInput {
  readonly trustedNowEpochMs: number;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly eventEpoch: string;
  readonly roadStateDigest: string;
  readonly objectBinding: string;
  readonly claimType: string;
  readonly minimumIndependentEvidence: number;
  readonly observations: readonly SensorObservationEnvelope[];
  readonly leases: readonly EpistemicIndependenceLease[];
  readonly claims: readonly EvidenceClaim[];
}

interface QualifiedClaim {
  readonly claim: EvidenceClaim;
  readonly independenceClassDigest: string;
}

export function assessEvidenceClaims(input: EvidenceAssuranceInput): EvidenceAssuranceResult {
  if (!Number.isSafeInteger(input.minimumIndependentEvidence) || input.minimumIndependentEvidence < 1) {
    throw new Error('INVALID_MINIMUM_INDEPENDENT_EVIDENCE');
  }

  const reasonCodes = new Set<string>();
  const observations = new Map<string, SensorObservationEnvelope>();
  for (const observation of input.observations) {
    if (observations.has(observation.observationId)) {
      reasonCodes.add('DUPLICATE_OBSERVATION_ID');
      continue;
    }
    observations.set(observation.observationId, observation);
  }

  const validLeasesByObservation = new Map<string, EpistemicIndependenceLease[]>();
  for (const lease of input.leases) {
    const leaseErrors = validateEpistemicIndependenceLease(lease, input.trustedNowEpochMs);
    if (leaseErrors.length > 0) {
      reasonCodes.add('INVALID_OR_EXPIRED_LEASE');
      continue;
    }
    if (
      lease.purpose !== input.purpose
      || lease.jurisdiction !== input.jurisdiction
      || lease.eventEpoch !== input.eventEpoch
      || lease.roadStateDigest !== input.roadStateDigest
      || lease.objectBinding !== input.objectBinding
    ) {
      reasonCodes.add('LEASE_CONTEXT_MISMATCH');
      continue;
    }
    for (const observationId of lease.observationIds) {
      const existing = validLeasesByObservation.get(observationId) ?? [];
      existing.push(lease);
      validLeasesByObservation.set(observationId, existing);
    }
  }

  const qualified: QualifiedClaim[] = [];
  for (const claim of input.claims) {
    if (claim.objectBinding !== input.objectBinding || claim.claimType !== input.claimType) {
      reasonCodes.add('CLAIM_CONTEXT_MISMATCH');
      continue;
    }
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
      reasonCodes.add('INVALID_CLAIM_CONFIDENCE');
      continue;
    }

    const observation = observations.get(claim.observationId);
    if (!observation) {
      reasonCodes.add('CLAIM_OBSERVATION_NOT_FOUND');
      continue;
    }

    const admission = assessSensorObservationAdmission(observation, input.trustedNowEpochMs);
    if (!admission.usableForCurrentState) {
      reasonCodes.add(`OBSERVATION_${admission.disposition}`);
      continue;
    }

    const matchingLeases = validLeasesByObservation.get(claim.observationId) ?? [];
    if (matchingLeases.length === 0) {
      reasonCodes.add('NO_INDEPENDENCE_LEASE');
      continue;
    }

    const distinctClasses = [...new Set(matchingLeases.map((lease) => lease.independenceClassDigest))];
    if (distinctClasses.length !== 1) {
      reasonCodes.add('AMBIGUOUS_INDEPENDENCE_BINDING');
      continue;
    }

    qualified.push({ claim, independenceClassDigest: distinctClasses[0]! });
  }

  const valuesByClass = new Map<string, Set<EvidenceClaim['value']>>();
  for (const item of qualified) {
    const values = valuesByClass.get(item.independenceClassDigest) ?? new Set<EvidenceClaim['value']>();
    values.add(item.claim.value);
    valuesByClass.set(item.independenceClassDigest, values);
  }

  const supporting: string[] = [];
  const contradicting: string[] = [];
  for (const [independenceClass, values] of valuesByClass) {
    const materialValues = [...values].filter((value) => value !== 'UNKNOWN');
    if (materialValues.length > 1) {
      reasonCodes.add('INTRA_CLASS_CONTRADICTION');
      continue;
    }
    const [value] = materialValues;
    if (value === 'PRESENT') supporting.push(independenceClass);
    if (value === 'ABSENT') contradicting.push(independenceClass);
  }

  supporting.sort();
  contradicting.sort();

  const effectiveIndependentEvidence = new Set([...supporting, ...contradicting]).size;
  let decision: EvidenceAssuranceResult['decision'];

  if (supporting.length > 0 && contradicting.length > 0) {
    decision = 'CONTRADICTED';
    reasonCodes.add('MATERIAL_CONTRADICTION');
  } else if (supporting.length >= input.minimumIndependentEvidence) {
    decision = 'CORROBORATED';
  } else {
    decision = 'INSUFFICIENT_INDEPENDENCE';
    reasonCodes.add('INSUFFICIENT_INDEPENDENT_EVIDENCE');
  }

  return {
    objectBinding: input.objectBinding,
    claimType: input.claimType,
    decision,
    effectiveIndependentEvidence,
    rawClaimCount: input.claims.length,
    supportingIndependenceClasses: supporting,
    contradictingIndependenceClasses: contradicting,
    reasonCodes: [...reasonCodes].sort(),
    authority: 'NONE',
  };
}

export function assuranceRequiresAbstention(result: EvidenceAssuranceResult): boolean {
  return result.decision === 'CONTRADICTED';
}
