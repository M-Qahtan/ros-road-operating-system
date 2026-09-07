import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestNextEvidence, type NextEvidenceContext, type SafetyFusionRecommendation } from '@ros/contracts';

const NOW = '2026-09-07T04:00:00.000Z';
const evaluatedAt = '2026-09-07T03:59:00.000Z';
const source = (): SafetyFusionRecommendation => ({
  tenantId: 'tenant-a', caseId: 'case-a', inputVersion: 31, evaluatedAt,
  currentSeverity: 'S4', recommendedSeverity: 'S4', score: 95, confidence: 0.8, uncertainty: 0.4,
  reasonCodes: ['FUSION_NO_RESPONSE', 'FUSION_CONTRADICTORY_INPUTS'],
  missingEvidenceFlags: ['MISSING_LOCATION_QUALITY', 'MISSING_CONTACT_OUTCOME', 'MISSING_CORROBORATION'],
  contributions: [],
  guardResults: (['DATA_QUALITY', 'DRIFT', 'OUT_OF_DISTRIBUTION', 'ADVERSARIAL_INPUT'] as const).map((kind) => ({
    kind, disposition: 'CLEAR', reasonCode: 'clear', guardVersion: 'test.v1', evaluatedInputVersion: 31
  })),
  requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
  autonomousClosurePermitted: false, autonomousDispatchPermitted: false,
  policyVersion: 'ros-eye.safety-fusion.v1', ruleSetVersion: 'ros-eye.rules.baseline.v1',
  thresholdVersion: 'ros-eye.safety-fusion.thresholds.v1', deterministicFingerprint: 'a'.repeat(64)
});
const context = (): NextEvidenceContext => ({
  tenantId: 'tenant-a', safetyCase: { id: 'case-a', state: 'NO_RESPONSE', severity: 'S4', version: 7, nextDeadlineAt: null },
  contactSession: { caseId: 'case-a', state: 'NO_RESPONSE', version: 4, lastInteractionAt: '2026-09-07T03:58:00.000Z' },
  recommendation: source(), evidenceState: 'CONFLICTING', contextObservedAt: ['2026-09-07T03:58:30.000Z']
});

test('prioritizes bounded human evidence review without granting action authority or equating versions', () => {
  const input = context();
  const original = structuredClone(input);
  const advice = suggestNextEvidence(input, NOW);
  assert.equal(advice.status, 'SUGGESTED');
  assert.equal(advice.reviewPriority, 'URGENT');
  assert.deepEqual(advice.suggestions, ['REVIEW_CONTACT_OUTCOME', 'REVIEW_CONTRADICTORY_EVIDENCE', 'REVIEW_INDEPENDENT_CORROBORATION']);
  assert.equal(advice.mode, 'SHADOW_ONLY');
  assert.equal(advice.activationAuthorized, false);
  assert.equal(advice.collectionPermitted, false);
  assert.equal(advice.sourceSnapshotStatus, 'UNVERIFIED');
  assert.equal(advice.sourceInputVersion, 31);
  assert.equal(advice.caseVersion, 7);
  assert.equal(advice.sourceFingerprint, source().deterministicFingerprint);
  assert.equal(advice.expiresAt, '2026-09-07T04:04:00.000Z');
  assert.deepEqual(input, original);
});

test('missing fusion never suppresses urgent human review', () => {
  const advice = suggestNextEvidence({ ...context(), recommendation: null }, NOW);
  assert.equal(advice.status, 'ABSTAIN');
  assert.equal(advice.reviewPriority, 'URGENT');
  assert.deepEqual(advice.suggestions, []);
  assert.ok(advice.reasons.includes('NO_RECOMMENDATION'));
});

test('refresh cannot renew source expiry; future and invalid clocks fail closed', () => {
  const first = suggestNextEvidence(context(), NOW);
  const boundary = suggestNextEvidence(context(), '2026-09-07T04:04:00.000Z');
  assert.equal(boundary.status, 'ABSTAIN');
  assert.ok(boundary.reasons.includes('SOURCE_EXPIRED'));
  assert.equal(boundary.expiresAt, first.expiresAt);
  for (const [evaluatedAt, reason] of [
    ['2026-09-07T04:00:00.001Z', 'SOURCE_IN_FUTURE'], ['not-a-time', 'INVALID_RECOMMENDATION']
  ] as const) {
    const advice = suggestNextEvidence({ ...context(), recommendation: { ...source(), evaluatedAt } }, NOW);
    assert.equal(advice.status, 'ABSTAIN');
    assert.ok(advice.reasons.includes(reason));
  }
  const invalidClock = suggestNextEvidence(context(), 'not-a-time');
  assert.equal(invalidClock.status, 'ABSTAIN');
  assert.equal(invalidClock.generatedAt, null);
  assert.equal(invalidClock.reviewPriority, 'URGENT');
});

test('source scope isolation rejects foreign references without echoing them', () => {
  for (const change of [{ tenantId: 'foreign' }, { caseId: 'foreign' }]) {
    const advice = suggestNextEvidence({ ...context(), recommendation: { ...source(), ...change } }, NOW);
    assert.equal(advice.status, 'ABSTAIN');
    assert.ok(advice.reasons.includes('SCOPE_MISMATCH'));
    assert.equal(advice.sourceFingerprint, null);
    assert.equal(advice.sourceInputVersion, null);
    assert.doesNotMatch(JSON.stringify(advice), /foreign/);
  }
});

test('new contact, evidence or audit timestamps reject prior advice and never certify snapshot identity', () => {
  for (const newer of ['2026-09-07T03:59:00.001Z', '2026-09-07T04:00:00.000Z']) {
    const advice = suggestNextEvidence({ ...context(), contextObservedAt: [newer] }, NOW);
    assert.equal(advice.status, 'ABSTAIN');
    assert.ok(advice.reasons.includes('CONTEXT_CHANGED'));
    assert.equal(advice.sourceSnapshotStatus, 'UNVERIFIED');
  }
  const updatedContact = suggestNextEvidence({ ...context(), contactSession: {
    ...context().contactSession!, lastInteractionAt: NOW
  } }, NOW);
  assert.ok(updatedContact.reasons.includes('CONTEXT_CHANGED'));
  const severityChanged = suggestNextEvidence({ ...context(), recommendation: { ...source(), currentSeverity: 'S2' } }, NOW);
  assert.ok(severityChanged.reasons.includes('CONTEXT_CHANGED'));
});

test('blocked guards and quarantined evidence produce human review without acquisition suggestions', () => {
  for (const recommendation of [
    { ...source(), guardResults: source().guardResults.map((guard) => ({ ...guard, disposition: 'BLOCK_AND_REVIEW' as const })) },
    { ...source(), missingEvidenceFlags: ['MISSING_GUARD_CLEARANCE' as const] },
    { ...source(), reasonCodes: ['FUSION_GUARD_BLOCKED' as const] }
  ]) {
    const advice = suggestNextEvidence({ ...context(), recommendation }, NOW);
    assert.equal(advice.status, 'ABSTAIN');
    assert.equal(advice.reviewPriority, 'URGENT');
    assert.ok(advice.reasons.includes('GUARD_REVIEW_REQUIRED'));
    assert.deepEqual(advice.suggestions, []);
    assert.equal(advice.collectionPermitted, false);
  }
  assert.ok(suggestNextEvidence({ ...context(), evidenceState: 'QUARANTINED' }, NOW).reasons.includes('EVIDENCE_QUARANTINED'));
});

test('malformed recommendations fail closed and arbitrary source text never reaches advice', () => {
  const invalid: readonly unknown[] = [
    undefined, 42, {}, { ...source(), guardResults: [null, ...source().guardResults.slice(1)] },
    { ...source(), guardResults: Array(4).fill(source().guardResults[0]) },
    { ...source(), guardResults: source().guardResults.map((guard) => ({ ...guard, evaluatedInputVersion: 1 })) },
    { ...source(), autonomousDispatchPermitted: true }, { ...source(), policyVersion: 'unknown' },
    { ...source(), missingEvidenceFlags: ['UNKNOWN_FLAG'] }, { ...source(), deterministicFingerprint: '<script>secret</script>' }
  ];
  for (const recommendation of invalid) {
    const advice = suggestNextEvidence({ ...context(), recommendation: recommendation as SafetyFusionRecommendation }, NOW);
    assert.equal(advice.status, 'ABSTAIN');
    assert.equal(advice.sourceFingerprint, null);
  }
  const advice = suggestNextEvidence({ ...context(), recommendation: {
    ...source(), guardResults: source().guardResults.map((guard) => ({ ...guard, reasonCode: 'private medical narrative secret@example.com' }))
  } }, NOW);
  assert.equal(advice.status, 'SUGGESTED');
  assert.doesNotMatch(JSON.stringify(advice), /medical|secret@|narrative/);
});

test('current safety context retains urgency independently of recommendation severity and availability', () => {
  const base = { ...context(), recommendation: null, safetyCase: { ...context().safetyCase, severity: 'S1' as const, state: 'CONTACTING' as const } };
  for (const state of ['NO_RESPONSE', 'UNREACHABLE', 'DISCONNECTED'] as const) {
    const advice = suggestNextEvidence({ ...base, contactSession: { ...base.contactSession!, state } }, NOW);
    assert.equal(advice.reviewPriority, 'URGENT');
  }
  const overdue = suggestNextEvidence({ ...base, contactSession: null, safetyCase: { ...base.safetyCase, nextDeadlineAt: NOW } }, NOW);
  assert.equal(overdue.reviewPriority, 'URGENT');
  const historicalDowngrade = suggestNextEvidence({ ...context(), recommendation: { ...source(), recommendedSeverity: 'S0' } }, NOW);
  assert.equal(historicalDowngrade.reviewPriority, 'URGENT');
  assert.equal(historicalDowngrade.activationAuthorized, false);
  assert.equal(suggestNextEvidence({ ...context(), safetyCase: { ...context().safetyCase, state: 'RESOLVED' } }, NOW).status, 'ABSTAIN');
});

test('each supported information gap has bounded review guidance, without claiming optimal acquisition', () => {
  const cases = [
    ['MISSING_CONTACT_OUTCOME', 'REVIEW_CONTACT_OUTCOME'], ['MISSING_RECENT_TRUSTED_SOURCE', 'REVIEW_RECENT_TRUSTED_SOURCE'],
    ['MISSING_CORROBORATION', 'REVIEW_INDEPENDENT_CORROBORATION'], ['MISSING_DEVICE_HEALTH', 'REVIEW_DEVICE_HEALTH'],
    ['MISSING_LOCATION_QUALITY', 'REVIEW_LOCATION_QUALITY']
  ] as const;
  for (const [flag, suggestion] of cases) {
    const advice = suggestNextEvidence({ ...context(), evidenceState: 'TRUSTED',
      contactSession: { ...context().contactSession!, state: 'RESPONSE_CONFIRMED' },
      recommendation: { ...source(), reasonCodes: [], missingEvidenceFlags: [flag] }
    }, NOW);
    assert.deepEqual(advice.suggestions, [suggestion]);
    assert.equal(advice.collectionPermitted, false);
  }
});
