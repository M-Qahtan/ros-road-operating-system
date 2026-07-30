import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFETY_FUSION_THRESHOLD_VERSION,
  type SafetyFusionClockPort,
  type SafetyFusionEvidence,
  type SafetyFusionFingerprintPort,
  type SafetyFusionGuardPort,
  type SafetyFusionInput,
  type SafetyFusionRuleSetRegistryEntry
} from '@ros/contracts';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  DEFAULT_SAFETY_FUSION_GUARDS,
  NodeSafetyFusionFingerprint,
  SAFETY_FUSION_RULE_SET_VERSION,
  SafetyFusionService,
  StaticSafetyFusionRegistry,
  safetyFusionSeverityRank
} from './safety-fusion.js';

class FixedClock implements SafetyFusionClockPort {
  constructor(private readonly value = '2026-07-31T00:00:00.000Z') {}
  async now(): Promise<string> { return this.value; }
}

class FixedFingerprint implements SafetyFusionFingerprintPort {
  private readonly delegate = new NodeSafetyFusionFingerprint();
  async digest(material: string): Promise<string> { return this.delegate.digest(material); }
}

const baseInput: SafetyFusionInput = {
  tenantId: 'tenant-riyadh',
  caseId: 'case-fusion-001',
  inputVersion: 1,
  currentSeverity: 'S1',
  contactState: 'AWAITING_RESPONSE',
  contactLastInteractionAt: '2026-07-30T23:59:30.000Z',
  evidence: [],
  requestedRuleSetVersion: SAFETY_FUSION_RULE_SET_VERSION,
  requestedThresholdVersion: SAFETY_FUSION_THRESHOLD_VERSION
};

function evidence(overrides: Partial<SafetyFusionEvidence> = {}): SafetyFusionEvidence {
  return {
    evidenceId: 'evidence-001',
    sourceRef: 'source-001',
    sourceType: 'VEHICLE',
    code: 'DEVICE_IMPACT',
    direction: 'SUPPORTS_RISK',
    observedAt: '2026-07-30T23:59:50.000Z',
    receivedAt: '2026-07-30T23:59:51.000Z',
    reliability: 0.95,
    integrity: 'VERIFIED',
    deviceCondition: 'HEALTHY',
    corroborationGroup: 'incident-001',
    locationQuality: 'PRECISE',
    ...overrides
  };
}

function service(
  guards: readonly SafetyFusionGuardPort[] = DEFAULT_SAFETY_FUSION_GUARDS,
  registryEntries: readonly SafetyFusionRuleSetRegistryEntry[] = [ACTIVE_SAFETY_FUSION_RULE_SET],
  clock: SafetyFusionClockPort = new FixedClock()
): SafetyFusionService {
  return new SafetyFusionService(new StaticSafetyFusionRegistry(registryEntries), guards, clock, new FixedFingerprint());
}

test('airbag plus non-response and corroboration produces explainable S4 human review', async () => {
  const input: SafetyFusionInput = {
    ...baseInput,
    contactState: 'NO_RESPONSE',
    evidence: [
      evidence({ evidenceId: 'airbag-001', sourceRef: 'vehicle-001', code: 'DEVICE_AIRBAG' }),
      evidence({ evidenceId: 'person-001', sourceRef: 'person-001', sourceType: 'PERSON', code: 'PERSON_NOT_RESPONDING', reliability: 0.9 })
    ]
  };
  const result = await service().recommend(input);
  assert.equal(result.recommendedSeverity, 'S4');
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.authority, 'RECOMMENDATION_ONLY');
  assert.equal(result.autonomousDowngradePermitted, false);
  assert.equal(result.autonomousClosurePermitted, false);
  assert.equal(result.autonomousDispatchPermitted, false);
  assert.ok(result.reasonCodes.includes('FUSION_DEVICE_AIRBAG'));
  assert.ok(result.reasonCodes.includes('FUSION_NO_RESPONSE'));
  assert.ok(result.reasonCodes.includes('FUSION_CORROBORATED'));
  assert.match(result.deterministicFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('identical versioned input produces an identical recommendation and fingerprint', async () => {
  const input: SafetyFusionInput = {
    ...baseInput,
    evidence: [
      evidence({ evidenceId: 'evidence-b', sourceRef: 'vehicle-b' }),
      evidence({ evidenceId: 'evidence-a', sourceRef: 'person-a', sourceType: 'PERSON', code: 'HELP_REQUESTED' })
    ]
  };
  const first = await service().recommend(input);
  const second = await service().recommend(input);
  assert.deepEqual(first, second);
  assert.equal(first.deterministicFingerprint, second.deterministicFingerprint);
});

test('contradictory inputs increase uncertainty and cannot silently lower risk', async () => {
  const result = await service().recommend({
    ...baseInput,
    currentSeverity: 'S2',
    contactState: 'PARTIAL_RESPONSE',
    evidence: [
      evidence({ evidenceId: 'risk-001', sourceRef: 'device-001', code: 'PERSON_NOT_RESPONDING' }),
      evidence({ evidenceId: 'safe-001', sourceRef: 'person-001', sourceType: 'PERSON', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' })
    ]
  });
  assert.ok(result.uncertainty >= 0.35);
  assert.ok(safetyFusionSeverityRank(result.recommendedSeverity) >= safetyFusionSeverityRank('S2'));
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('FUSION_CONTRADICTORY_INPUTS'));
});

test('stale sparse evidence preserves current severity and requires human review', async () => {
  const result = await service().recommend({
    ...baseInput,
    currentSeverity: 'S3',
    contactState: 'HUMAN_REVIEW',
    evidence: [evidence({ observedAt: '2026-07-30T22:30:00.000Z', receivedAt: '2026-07-30T22:31:00.000Z' })]
  });
  assert.equal(result.recommendedSeverity, 'S3');
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('FUSION_STALE_EVIDENCE'));
  assert.ok(result.reasonCodes.includes('FUSION_SPARSE_EVIDENCE'));
  assert.ok(result.missingEvidenceFlags.includes('MISSING_RECENT_TRUSTED_SOURCE'));
});

test('verified safety evidence cannot autonomously downgrade an S3 case', async () => {
  const result = await service().recommend({
    ...baseInput,
    currentSeverity: 'S3',
    contactState: 'RESPONSE_CONFIRMED',
    evidence: [
      evidence({ evidenceId: 'safe-001', sourceRef: 'person-001', sourceType: 'PERSON', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' }),
      evidence({ evidenceId: 'safe-002', sourceRef: 'operator-001', sourceType: 'OPERATOR', code: 'CHANNEL_HEALTHY', direction: 'SUPPORTS_SAFETY' })
    ]
  });
  assert.equal(result.recommendedSeverity, 'S3');
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('FUSION_AUTONOMOUS_DOWNGRADE_BLOCKED'));
});

test('guard failure fails closed instead of granting a low-risk recommendation', async () => {
  const failingGuard: SafetyFusionGuardPort = {
    kind: 'DRIFT',
    async evaluate() { throw new Error('adapter unavailable'); }
  };
  const result = await service([failingGuard]).recommend({ ...baseInput, evidence: [evidence()] });
  assert.ok(safetyFusionSeverityRank(result.recommendedSeverity) >= safetyFusionSeverityRank('S3'));
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.reasonCodes.includes('FUSION_GUARD_BLOCKED'));
  assert.equal(result.guardResults[0]?.disposition, 'BLOCK_AND_REVIEW');
});

test('unapproved threshold or missing rollback evidence fails closed', async () => {
  const invalidEntry: SafetyFusionRuleSetRegistryEntry = {
    ...ACTIVE_SAFETY_FUSION_RULE_SET,
    rollbackRuleSetVersion: null
  };
  const result = await service(DEFAULT_SAFETY_FUSION_GUARDS, [invalidEntry]).recommend({ ...baseInput, evidence: [evidence()] });
  assert.equal(result.recommendedSeverity, 'S3');
  assert.equal(result.uncertainty, 1);
  assert.equal(result.requiresHumanReview, true);
});

test('conflicting duplicate evidence identifiers are blocked as adversarial input', async () => {
  const result = await service().recommend({
    ...baseInput,
    evidence: [
      evidence({ evidenceId: 'duplicate-001', code: 'DEVICE_IMPACT' }),
      evidence({ evidenceId: 'duplicate-001', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' })
    ]
  });
  assert.ok(result.guardResults.some((guard) => guard.kind === 'ADVERSARIAL_INPUT' && guard.disposition === 'BLOCK_AND_REVIEW'));
  assert.ok(safetyFusionSeverityRank(result.recommendedSeverity) >= safetyFusionSeverityRank('S3'));
  assert.equal(result.requiresHumanReview, true);
});

test('unknown vocabularies and malformed reliability are denied before scoring', async () => {
  const malformed = evidence({ reliability: 1.5 }) as SafetyFusionEvidence;
  const result = await service().recommend({ ...baseInput, evidence: [malformed] });
  assert.equal(result.confidence, 0);
  assert.equal(result.uncertainty, 1);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.contributions.length, 0);
});

test('outputs contain structured contributions only and no raw narrative fields', async () => {
  const result = await service().recommend({ ...baseInput, evidence: [evidence()] });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('medicalNarrative'), false);
  assert.equal(serialized.includes('rawConversation'), false);
  assert.equal(serialized.includes('phoneNumber'), false);
  assert.equal(Object.keys(result.contributions[0] ?? {}).sort().join(','), 'code,deviceConditionFactor,evidenceId,freshnessFactor,integrityFactor,reliabilityFactor,signedContribution,sourceType');
});
