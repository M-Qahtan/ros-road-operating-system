import {
  SAFETY_FUSION_THRESHOLD_VERSION,
  type SafetyFusionEvaluationFixture,
  type SafetyFusionEvidence,
  type SafetyFusionGuardKind,
  type SafetyFusionGuardResult,
  type SafetyFusionInput
} from '@ros/contracts';
import { SAFETY_FUSION_RULE_SET_VERSION } from './safety-fusion.js';

const EVALUATED_AT = '2026-07-31T00:00:00.000Z';

function evidence(overrides: Partial<SafetyFusionEvidence>): SafetyFusionEvidence {
  return {
    evidenceId: 'fixture-evidence',
    sourceRef: 'fixture-source',
    sourceType: 'SIMULATION',
    code: 'DEVICE_IMPACT',
    direction: 'SUPPORTS_RISK',
    observedAt: '2026-07-30T23:59:45.000Z',
    receivedAt: '2026-07-30T23:59:46.000Z',
    reliability: 0.95,
    integrity: 'VERIFIED',
    deviceCondition: 'HEALTHY',
    corroborationGroup: 'fixture-incident',
    locationQuality: 'PRECISE',
    ...overrides
  };
}

function input(overrides: Partial<SafetyFusionInput>): SafetyFusionInput {
  return {
    tenantId: 'tenant-synthetic',
    caseId: 'case-synthetic',
    inputVersion: 1,
    currentSeverity: 'S1',
    contactState: 'AWAITING_RESPONSE',
    contactLastInteractionAt: '2026-07-30T23:59:30.000Z',
    evidence: [],
    requestedRuleSetVersion: SAFETY_FUSION_RULE_SET_VERSION,
    requestedThresholdVersion: SAFETY_FUSION_THRESHOLD_VERSION,
    ...overrides
  };
}

function clearGuard(kind: SafetyFusionGuardKind, inputVersion = 1): SafetyFusionGuardResult {
  return {
    kind,
    disposition: 'CLEAR',
    reasonCode: 'synthetic_fixture_clear',
    guardVersion: `ros-eye.safety-fusion.guard.${kind.toLowerCase()}.fixture.v1`,
    evaluatedInputVersion: inputVersion
  };
}

const CLEAR_GUARDS: readonly SafetyFusionGuardResult[] = [
  clearGuard('DATA_QUALITY'),
  clearGuard('DRIFT'),
  clearGuard('OUT_OF_DISTRIBUTION'),
  clearGuard('ADVERSARIAL_INPUT')
];

export const SAFETY_FUSION_SYNTHETIC_FIXTURES: readonly SafetyFusionEvaluationFixture[] = Object.freeze([
  Object.freeze({
    fixtureId: 's4-airbag-no-response',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-airbag-no-response',
      contactState: 'NO_RESPONSE',
      evidence: [
        evidence({ evidenceId: 'airbag', sourceRef: 'vehicle', sourceType: 'VEHICLE', code: 'DEVICE_AIRBAG' }),
        evidence({ evidenceId: 'not-responding', sourceRef: 'person', sourceType: 'PERSON', code: 'PERSON_NOT_RESPONDING', reliability: 0.9 })
      ]
    }),
    guardResults: CLEAR_GUARDS,
    expectedMinimumSeverity: 'S4',
    expectedHumanReview: true,
    safetyWeight: 10
  }),
  Object.freeze({
    fixtureId: 's4-rollover-help-requested',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-rollover-help',
      contactState: 'PARTIAL_RESPONSE',
      evidence: [
        evidence({ evidenceId: 'rollover', sourceRef: 'vehicle', sourceType: 'VEHICLE', code: 'DEVICE_ROLLOVER' }),
        evidence({ evidenceId: 'help', sourceRef: 'person', sourceType: 'PERSON', code: 'HELP_REQUESTED' })
      ]
    }),
    guardResults: CLEAR_GUARDS,
    expectedMinimumSeverity: 'S4',
    expectedHumanReview: true,
    safetyWeight: 10
  }),
  Object.freeze({
    fixtureId: 's3-contradictory-response',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-contradictory',
      currentSeverity: 'S2',
      contactState: 'PARTIAL_RESPONSE',
      evidence: [
        evidence({ evidenceId: 'risk', sourceRef: 'device', sourceType: 'PHONE', code: 'PERSON_NOT_RESPONDING' }),
        evidence({ evidenceId: 'safe', sourceRef: 'person', sourceType: 'PERSON', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' })
      ]
    }),
    guardResults: CLEAR_GUARDS,
    expectedMinimumSeverity: 'S3',
    expectedHumanReview: true,
    safetyWeight: 6
  }),
  Object.freeze({
    fixtureId: 's3-stale-sparse-preserves-floor',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-stale-sparse',
      currentSeverity: 'S3',
      contactState: 'HUMAN_REVIEW',
      evidence: [evidence({ evidenceId: 'stale-impact', observedAt: '2026-07-30T22:30:00.000Z', receivedAt: '2026-07-30T22:31:00.000Z' })]
    }),
    guardResults: [
      { ...clearGuard('DATA_QUALITY'), disposition: 'DEGRADED', reasonCode: 'stale_sparse_fixture' },
      clearGuard('DRIFT'), clearGuard('OUT_OF_DISTRIBUTION'), clearGuard('ADVERSARIAL_INPUT')
    ],
    expectedMinimumSeverity: 'S3',
    expectedHumanReview: true,
    safetyWeight: 6
  }),
  Object.freeze({
    fixtureId: 's3-safe-evidence-cannot-downgrade',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-no-autonomous-downgrade',
      currentSeverity: 'S3',
      contactState: 'RESPONSE_CONFIRMED',
      evidence: [
        evidence({ evidenceId: 'responded', sourceRef: 'person', sourceType: 'PERSON', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' }),
        evidence({ evidenceId: 'channel', sourceRef: 'operator', sourceType: 'OPERATOR', code: 'CHANNEL_HEALTHY', direction: 'SUPPORTS_SAFETY' })
      ]
    }),
    guardResults: CLEAR_GUARDS,
    expectedMinimumSeverity: 'S3',
    expectedHumanReview: true,
    safetyWeight: 8
  }),
  Object.freeze({
    fixtureId: 's1-low-risk-corroborated-response',
    evaluatedAt: EVALUATED_AT,
    input: input({
      caseId: 'case-low-risk',
      currentSeverity: 'S1',
      contactState: 'RESPONSE_CONFIRMED',
      evidence: [
        evidence({ evidenceId: 'responded-low', sourceRef: 'person-low', sourceType: 'PERSON', code: 'PERSON_RESPONDED', direction: 'SUPPORTS_SAFETY' }),
        evidence({ evidenceId: 'channel-low', sourceRef: 'operator-low', sourceType: 'OPERATOR', code: 'CHANNEL_HEALTHY', direction: 'SUPPORTS_SAFETY' })
      ]
    }),
    guardResults: CLEAR_GUARDS,
    expectedMinimumSeverity: 'S1',
    expectedHumanReview: false,
    safetyWeight: 1
  })
]);
