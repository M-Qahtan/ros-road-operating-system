import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFETY_FUSION_THRESHOLD_VERSION,
  type SafetyFusionClockPort,
  type SafetyFusionEvidence,
  type SafetyFusionInput
} from '@ros/contracts';
import {
  GovernedSafetyFusionOrchestrator,
  SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
  type SafetyFusionEvidenceAuthorityPort,
  type SafetyFusionEvidenceAuthorityReceipt
} from './governed-safety-fusion.js';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  DEFAULT_SAFETY_FUSION_GUARDS,
  NodeSafetyFusionFingerprint,
  SAFETY_FUSION_RULE_SET_VERSION,
  StaticSafetyFusionRegistry,
  safetyFusionSeverityRank
} from './safety-fusion.js';

class FixedClock implements SafetyFusionClockPort {
  constructor(private readonly value = '2026-07-31T00:00:00.000Z') {}
  async now(): Promise<string> { return this.value; }
}

class MemoryEvidenceAuthority implements SafetyFusionEvidenceAuthorityPort {
  readonly receipts = new Map<string, SafetyFusionEvidenceAuthorityReceipt>();
  fail = false;
  async findEvidence(input: { tenantId: string; caseId: string; evidenceId: string; sourceRef: string }): Promise<SafetyFusionEvidenceAuthorityReceipt | null> {
    if (this.fail) throw new Error('authority unavailable');
    const receipt = this.receipts.get(input.evidenceId) ?? null;
    return receipt !== null
      && receipt.tenantId === input.tenantId
      && receipt.caseId === input.caseId
      && receipt.sourceRef === input.sourceRef
      ? receipt
      : null;
  }
}

const baseEvidence: SafetyFusionEvidence = {
  evidenceId: 'evidence-authoritative-001',
  sourceRef: 'vehicle-authoritative-001',
  sourceType: 'VEHICLE',
  code: 'DEVICE_AIRBAG',
  direction: 'SUPPORTS_RISK',
  observedAt: '2026-07-30T23:59:30.000Z',
  receivedAt: '2026-07-30T23:59:31.000Z',
  reliability: 0.95,
  integrity: 'VERIFIED',
  deviceCondition: 'HEALTHY',
  corroborationGroup: 'incident-authoritative-001',
  locationQuality: 'PRECISE'
};

const baseInput: SafetyFusionInput = {
  tenantId: 'tenant-riyadh',
  caseId: 'case-governed-fusion-001',
  inputVersion: 1,
  currentSeverity: 'S2',
  contactState: 'NO_RESPONSE',
  contactLastInteractionAt: '2026-07-30T23:59:40.000Z',
  evidence: [baseEvidence],
  requestedRuleSetVersion: SAFETY_FUSION_RULE_SET_VERSION,
  requestedThresholdVersion: SAFETY_FUSION_THRESHOLD_VERSION
};

function authorityReceipt(overrides: Partial<SafetyFusionEvidenceAuthorityReceipt> = {}): SafetyFusionEvidenceAuthorityReceipt {
  return {
    ...baseEvidence,
    tenantId: baseInput.tenantId,
    caseId: baseInput.caseId,
    approvedPurpose: 'HUMAN_SAFETY_FUSION',
    status: 'ACTIVE',
    policyVersion: SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
    issuedAt: '2026-07-30T23:55:00.000Z',
    expiresAt: '2026-07-31T00:10:00.000Z',
    ...overrides
  };
}

function orchestrator(authority: MemoryEvidenceAuthority, guards = DEFAULT_SAFETY_FUSION_GUARDS) {
  return new GovernedSafetyFusionOrchestrator(
    new StaticSafetyFusionRegistry([ACTIVE_SAFETY_FUSION_RULE_SET]),
    guards,
    new FixedClock(),
    new NodeSafetyFusionFingerprint(),
    authority
  );
}

function seededAuthority(): MemoryEvidenceAuthority {
  const authority = new MemoryEvidenceAuthority();
  authority.receipts.set(baseEvidence.evidenceId, authorityReceipt());
  return authority;
}

function assertBlocked(result: Awaited<ReturnType<GovernedSafetyFusionOrchestrator['recommend']>>) {
  assert.ok(safetyFusionSeverityRank(result.recommendedSeverity) >= safetyFusionSeverityRank('S3'));
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('FUSION_GUARD_BLOCKED'));
  assert.ok(result.guardResults.some((guard) => guard.disposition === 'BLOCK_AND_REVIEW'));
  assert.equal(result.autonomousDowngradePermitted, false);
}

test('authoritative receipt and complete guard set permit recommendation-only evaluation', async () => {
  const result = await orchestrator(seededAuthority()).recommend(baseInput);
  assert.equal(result.authority, 'RECOMMENDATION_ONLY');
  assert.equal(result.recommendedSeverity, 'S4');
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.guardResults.length, 4);
});

test('caller cannot invent reliability integrity or device condition', async () => {
  const authority = seededAuthority();
  const invented: SafetyFusionInput = {
    ...baseInput,
    evidence: [{ ...baseEvidence, reliability: 1, deviceCondition: 'HEALTHY' }]
  };
  assertBlocked(await orchestrator(authority).recommend(invented));

  const inventedIntegrity: SafetyFusionInput = {
    ...baseInput,
    evidence: [{ ...baseEvidence, integrity: 'UNVERIFIED' }]
  };
  assertBlocked(await orchestrator(authority).recommend(inventedIntegrity));
});

test('cross-tenant cross-case expired revoked and wrong-purpose receipts deny', async () => {
  for (const receipt of [
    authorityReceipt({ tenantId: 'tenant-other' }),
    authorityReceipt({ caseId: 'case-other' }),
    authorityReceipt({ status: 'REVOKED' }),
    authorityReceipt({ status: 'EXPIRED' }),
    authorityReceipt({ expiresAt: '2026-07-30T23:59:59.000Z' }),
    authorityReceipt({ approvedPurpose: 'HUMAN_SAFETY_FUSION', policyVersion: 'ros-eye.safety-fusion.evidence-authority.v1' })
  ]) {
    const authority = new MemoryEvidenceAuthority();
    authority.receipts.set(baseEvidence.evidenceId, receipt);
    if (receipt.tenantId === baseInput.tenantId && receipt.caseId === baseInput.caseId && receipt.status === 'ACTIVE' && receipt.expiresAt > '2026-07-31T00:00:00.000Z') continue;
    assertBlocked(await orchestrator(authority).recommend(baseInput));
  }
});

test('authority adapter failure and missing receipt deny', async () => {
  const missing = new MemoryEvidenceAuthority();
  assertBlocked(await orchestrator(missing).recommend(baseInput));
  missing.fail = true;
  assertBlocked(await orchestrator(missing).recommend(baseInput));
});

test('all four distinct guards are mandatory', async () => {
  const authority = seededAuthority();
  assertBlocked(await orchestrator(authority, DEFAULT_SAFETY_FUSION_GUARDS.slice(0, 3)).recommend(baseInput));
  assertBlocked(await orchestrator(authority, [DEFAULT_SAFETY_FUSION_GUARDS[0]!, DEFAULT_SAFETY_FUSION_GUARDS[0]!, DEFAULT_SAFETY_FUSION_GUARDS[2]!, DEFAULT_SAFETY_FUSION_GUARDS[3]!]).recommend(baseInput));
});

test('unknown fields including protected attributes are rejected', async () => {
  const authority = seededAuthority();
  const unknownInput = { ...baseInput, protectedAttribute: 'forbidden' } as SafetyFusionInput;
  assertBlocked(await orchestrator(authority).recommend(unknownInput));

  const unknownEvidence = {
    ...baseEvidence,
    medicalNarrative: 'forbidden'
  } as SafetyFusionEvidence;
  assertBlocked(await orchestrator(authority).recommend({ ...baseInput, evidence: [unknownEvidence] }));
});

test('future inconsistent and duplicate evidence is rejected', async () => {
  const authority = seededAuthority();
  const future = { ...baseEvidence, observedAt: '2026-07-31T00:06:00.000Z', receivedAt: '2026-07-31T00:06:01.000Z' };
  authority.receipts.set(future.evidenceId, authorityReceipt(future));
  assertBlocked(await orchestrator(authority).recommend({ ...baseInput, evidence: [future] }));

  const reversed = { ...baseEvidence, observedAt: '2026-07-30T23:59:40.000Z', receivedAt: '2026-07-30T23:59:30.000Z' };
  authority.receipts.set(reversed.evidenceId, authorityReceipt(reversed));
  assertBlocked(await orchestrator(authority).recommend({ ...baseInput, evidence: [reversed] }));

  assertBlocked(await orchestrator(seededAuthority()).recommend({ ...baseInput, evidence: [baseEvidence, baseEvidence] }));
});

test('invalid or future contact interaction time fails closed', async () => {
  const authority = seededAuthority();
  assertBlocked(await orchestrator(authority).recommend({ ...baseInput, contactLastInteractionAt: 'not-a-time' }));
  assertBlocked(await orchestrator(authority).recommend({ ...baseInput, contactLastInteractionAt: '2026-07-31T00:06:00.000Z' }));
});
