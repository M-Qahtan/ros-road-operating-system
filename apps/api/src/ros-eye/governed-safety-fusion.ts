import {
  type SafetyFusionClockPort,
  type SafetyFusionEvidence,
  type SafetyFusionFingerprintPort,
  type SafetyFusionGuardKind,
  type SafetyFusionGuardPort,
  type SafetyFusionInput,
  type SafetyFusionRecommendation,
  type SafetyFusionRegistryPort
} from '@ros/contracts';
import { SafetyFusionService } from './safety-fusion.js';

export const SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION = 'ros-eye.safety-fusion.evidence-authority.v1' as const;
export const SAFETY_FUSION_ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000;

const REQUIRED_GUARDS: readonly SafetyFusionGuardKind[] = [
  'ADVERSARIAL_INPUT',
  'DATA_QUALITY',
  'DRIFT',
  'OUT_OF_DISTRIBUTION'
];

const INPUT_KEYS = new Set([
  'tenantId', 'caseId', 'inputVersion', 'currentSeverity', 'contactState',
  'contactLastInteractionAt', 'evidence', 'requestedRuleSetVersion', 'requestedThresholdVersion'
]);

const EVIDENCE_KEYS = new Set([
  'evidenceId', 'sourceRef', 'sourceType', 'code', 'direction', 'observedAt',
  'receivedAt', 'reliability', 'integrity', 'deviceCondition',
  'corroborationGroup', 'locationQuality'
]);

export interface SafetyFusionEvidenceAuthorityReceipt extends SafetyFusionEvidence {
  readonly tenantId: string;
  readonly caseId: string;
  readonly approvedPurpose: 'HUMAN_SAFETY_FUSION';
  readonly status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  readonly policyVersion: typeof SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SafetyFusionEvidenceAuthorityPort {
  findEvidence(input: {
    readonly tenantId: string;
    readonly caseId: string;
    readonly evidenceId: string;
    readonly sourceRef: string;
  }): Promise<SafetyFusionEvidenceAuthorityReceipt | null>;
}

export class GovernedSafetyFusionOrchestrator {
  constructor(
    private readonly registry: SafetyFusionRegistryPort,
    private readonly guards: readonly SafetyFusionGuardPort[],
    private readonly clock: SafetyFusionClockPort,
    private readonly fingerprint: SafetyFusionFingerprintPort,
    private readonly evidenceAuthority: SafetyFusionEvidenceAuthorityPort
  ) {}

  async recommend(input: SafetyFusionInput): Promise<SafetyFusionRecommendation> {
    const trustedNow = await trustedTime(this.clock);
    const guardConfigurationValid = validGuardConfiguration(this.guards);
    const shapeValid = trustedNow !== null && strictInputShape(input) && validContactTime(input, trustedNow);

    if (!guardConfigurationValid || !shapeValid) {
      return this.blocked(input, trustedNow ?? '1970-01-01T00:00:00.000Z', guardConfigurationValid ? 'input_contract_invalid' : 'required_guard_set_invalid');
    }

    const uniqueEvidenceIds = new Set(input.evidence.map((item) => item.evidenceId));
    if (uniqueEvidenceIds.size !== input.evidence.length) {
      return this.blocked(input, trustedNow, 'duplicate_evidence_id');
    }

    const authoritativeEvidence: SafetyFusionEvidence[] = [];
    for (const requested of input.evidence) {
      let receipt: SafetyFusionEvidenceAuthorityReceipt | null;
      try {
        receipt = await this.evidenceAuthority.findEvidence({
          tenantId: input.tenantId,
          caseId: input.caseId,
          evidenceId: requested.evidenceId,
          sourceRef: requested.sourceRef
        });
      } catch {
        return this.blocked(input, trustedNow, 'evidence_authority_unavailable');
      }

      if (!validAuthorityReceipt(receipt, requested, input, trustedNow)) {
        return this.blocked(input, trustedNow, 'evidence_authority_receipt_invalid');
      }
      authoritativeEvidence.push(toEvidence(receipt));
    }

    const authoritativeInput: SafetyFusionInput = Object.freeze({
      ...input,
      evidence: Object.freeze(authoritativeEvidence.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)))
    });

    const service = new SafetyFusionService(
      this.registry,
      this.guards,
      new FixedSafetyFusionClock(trustedNow),
      this.fingerprint
    );
    return service.recommend(authoritativeInput);
  }

  private async blocked(input: SafetyFusionInput, trustedNow: string, reasonCode: string): Promise<SafetyFusionRecommendation> {
    const blockingGuard: SafetyFusionGuardPort = {
      kind: 'DATA_QUALITY',
      async evaluate(candidate) {
        return {
          kind: 'DATA_QUALITY',
          disposition: 'BLOCK_AND_REVIEW',
          reasonCode,
          guardVersion: 'ros-eye.safety-fusion.guard.governed-boundary.v1',
          evaluatedInputVersion: Number.isInteger(candidate.inputVersion) ? candidate.inputVersion : 0
        };
      }
    };
    const safeGuards = validGuardConfiguration(this.guards)
      ? [...this.guards.filter((guard) => guard.kind !== 'DATA_QUALITY'), blockingGuard]
      : [blockingGuard];
    const service = new SafetyFusionService(
      this.registry,
      safeGuards,
      new FixedSafetyFusionClock(trustedNow),
      this.fingerprint
    );
    return service.recommend(input);
  }
}

class FixedSafetyFusionClock implements SafetyFusionClockPort {
  constructor(private readonly value: string) {}
  async now(): Promise<string> { return this.value; }
}

function validGuardConfiguration(guards: readonly SafetyFusionGuardPort[]): boolean {
  if (guards.length !== REQUIRED_GUARDS.length) return false;
  const kinds = guards.map((guard) => guard.kind).sort();
  return REQUIRED_GUARDS.every((kind, index) => kinds[index] === kind);
}

function strictInputShape(input: SafetyFusionInput): boolean {
  if (!exactKeys(input as unknown as Record<string, unknown>, INPUT_KEYS)) return false;
  if (!Array.isArray(input.evidence)) return false;
  return input.evidence.every((item) => exactKeys(item as unknown as Record<string, unknown>, EVIDENCE_KEYS));
}

function validContactTime(input: SafetyFusionInput, trustedNow: string): boolean {
  if (input.contactLastInteractionAt === null) return input.contactState === 'NOT_STARTED' || input.contactState === 'CREATED';
  const value = Date.parse(input.contactLastInteractionAt);
  const now = Date.parse(trustedNow);
  return Number.isFinite(value) && value <= now + SAFETY_FUSION_ALLOWED_CLOCK_SKEW_MS;
}

function validAuthorityReceipt(
  receipt: SafetyFusionEvidenceAuthorityReceipt | null,
  requested: SafetyFusionEvidence,
  input: SafetyFusionInput,
  trustedNow: string
): receipt is SafetyFusionEvidenceAuthorityReceipt {
  if (receipt === null) return false;
  if (receipt.tenantId !== input.tenantId || receipt.caseId !== input.caseId) return false;
  if (receipt.approvedPurpose !== 'HUMAN_SAFETY_FUSION' || receipt.status !== 'ACTIVE') return false;
  if (receipt.policyVersion !== SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION) return false;
  if (!validTime(receipt.issuedAt) || !validTime(receipt.expiresAt)) return false;
  const now = Date.parse(trustedNow);
  if (Date.parse(receipt.issuedAt) > now + SAFETY_FUSION_ALLOWED_CLOCK_SKEW_MS || Date.parse(receipt.expiresAt) <= now) return false;
  if (!sameEvidence(receipt, requested)) return false;
  const observedAt = Date.parse(receipt.observedAt);
  const receivedAt = Date.parse(receipt.receivedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(receivedAt)) return false;
  if (observedAt > receivedAt || receivedAt > now + SAFETY_FUSION_ALLOWED_CLOCK_SKEW_MS) return false;
  return true;
}

function sameEvidence(receipt: SafetyFusionEvidenceAuthorityReceipt, requested: SafetyFusionEvidence): boolean {
  return EVIDENCE_KEYS.size === Object.keys(requested).length
    && receipt.evidenceId === requested.evidenceId
    && receipt.sourceRef === requested.sourceRef
    && receipt.sourceType === requested.sourceType
    && receipt.code === requested.code
    && receipt.direction === requested.direction
    && receipt.observedAt === requested.observedAt
    && receipt.receivedAt === requested.receivedAt
    && receipt.reliability === requested.reliability
    && receipt.integrity === requested.integrity
    && receipt.deviceCondition === requested.deviceCondition
    && receipt.corroborationGroup === requested.corroborationGroup
    && receipt.locationQuality === requested.locationQuality;
}

function toEvidence(receipt: SafetyFusionEvidenceAuthorityReceipt): SafetyFusionEvidence {
  return Object.freeze({
    evidenceId: receipt.evidenceId,
    sourceRef: receipt.sourceRef,
    sourceType: receipt.sourceType,
    code: receipt.code,
    direction: receipt.direction,
    observedAt: receipt.observedAt,
    receivedAt: receipt.receivedAt,
    reliability: receipt.reliability,
    integrity: receipt.integrity,
    deviceCondition: receipt.deviceCondition,
    corroborationGroup: receipt.corroborationGroup,
    locationQuality: receipt.locationQuality
  });
}

function exactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function validTime(value: string): boolean { return Number.isFinite(Date.parse(value)); }

async function trustedTime(clock: SafetyFusionClockPort): Promise<string | null> {
  try {
    const value = await clock.now();
    return validTime(value) ? value : null;
  } catch {
    return null;
  }
}
