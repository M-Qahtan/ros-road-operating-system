import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION,
  assessRecommendationSnapshotBinding,
  type CurrentInputRevisions,
  type RecommendationSnapshotBinding,
  type SafetyFusionInputSnapshot,
  type SafetyFusionRecommendation
} from '@ros/contracts';

const digest = (character: string): string => character.repeat(64);
const revision = (value: number, character: string) => ({ revision: value, digest: digest(character) });

const recommendation = (): SafetyFusionRecommendation => ({
  tenantId: 'tenant-a', caseId: 'case-a', inputVersion: 11, evaluatedAt: '2026-09-08T04:01:00.000Z',
  currentSeverity: 'S4', recommendedSeverity: 'S4', score: 90, confidence: 0.8, uncertainty: 0.2,
  reasonCodes: [], missingEvidenceFlags: [], contributions: [], guardResults: [], requiresHumanReview: true,
  authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false, autonomousClosurePermitted: false,
  autonomousDispatchPermitted: false, policyVersion: 'ros-eye.safety-fusion.v1',
  ruleSetVersion: 'test.v1', thresholdVersion: 'ros-eye.safety-fusion.thresholds.v1',
  deterministicFingerprint: digest('a')
});

const snapshot = (): SafetyFusionInputSnapshot => ({
  policyVersion: SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION,
  tenantId: 'tenant-a', caseId: 'case-a', inputVersion: 11, capturedAt: '2026-09-08T04:00:00.000Z',
  case: revision(7, 'b'), severity: revision(3, 'c'), contact: revision(4, 'd'),
  evidence: revision(9, 'e'), indicators: revision(2, 'f'), snapshotDigest: digest('1')
});

const binding = (): RecommendationSnapshotBinding => ({
  policyVersion: SAFETY_FUSION_INPUT_SNAPSHOT_POLICY_VERSION, inputVersion: 11,
  recommendationFingerprint: digest('a'), sourceSnapshotDigest: digest('1'), boundAt: '2026-09-08T04:01:01.000Z'
});

const current = (): CurrentInputRevisions => {
  const source = snapshot();
  return {
    tenantId: source.tenantId, caseId: source.caseId, case: source.case, severity: source.severity,
    contact: source.contact, evidence: source.evidence, indicators: source.indicators
  };
};

test('verifies exact recommendation, snapshot and current authoritative revision binding', () => {
  assert.deepEqual(assessRecommendationSnapshotBinding(recommendation(), snapshot(), binding(), current()), {
    status: 'VERIFIED', reason: 'VERIFIED', sourceSnapshotDigest: digest('1')
  });
});

test('a changed, corrected or revoked component invalidates the prior binding', () => {
  for (const changed of [
    { ...current(), case: revision(8, 'b') },
    { ...current(), severity: revision(3, '2') },
    { ...current(), contact: revision(5, 'd') },
    { ...current(), contact: null },
    { ...current(), evidence: revision(10, 'e') },
    { ...current(), evidence: revision(9, '3') },
    { ...current(), indicators: revision(3, 'f') }
  ]) {
    assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), binding(), changed).reason, 'CURRENT_INPUT_CHANGED');
  }
});

test('missing or malformed receipts never become verified', () => {
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), null, binding(), current()).status, 'UNVERIFIED');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), null, current()).status, 'UNVERIFIED');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), binding(), null).status, 'UNVERIFIED');
  assert.equal(assessRecommendationSnapshotBinding(null, snapshot(), binding(), current()).reason, 'INVALID_BINDING');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), { ...snapshot(), snapshotDigest: 'invalid' }, binding(), current()).reason, 'INVALID_BINDING');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), { ...binding(), boundAt: 'invalid' }, current()).reason, 'INVALID_BINDING');
});

test('scope, source identity and chronology mismatches fail closed', () => {
  assert.equal(assessRecommendationSnapshotBinding({ ...recommendation(), tenantId: 'tenant-b' }, snapshot(), binding(), current()).reason, 'SCOPE_MISMATCH');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), { ...binding(), recommendationFingerprint: digest('9') }, current()).reason, 'SOURCE_MISMATCH');
  assert.equal(assessRecommendationSnapshotBinding({ ...recommendation(), inputVersion: 12 }, snapshot(), binding(), current()).reason, 'SOURCE_MISMATCH');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), { ...snapshot(), capturedAt: '2026-09-08T04:02:00.000Z' }, binding(), current()).reason, 'SOURCE_MISMATCH');
  assert.equal(assessRecommendationSnapshotBinding(recommendation(), snapshot(), { ...binding(), boundAt: '2026-09-08T04:00:30.000Z' }, current()).reason, 'SOURCE_MISMATCH');
});
