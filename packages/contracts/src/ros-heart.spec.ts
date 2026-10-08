import assert from 'node:assert/strict';
import {
  evaluateRosHeart,
  evaluateRosHeartBound,
  type RosHeartBinding,
  type RosHeartBindingPorts,
  type RosHeartDecision,
  type RosHeartEvaluationInput,
  type RosHeartTrustedSnapshot
} from './ros-heart.js';

const baseline = (): RosHeartEvaluationInput => ({
  evidence: { present: true, fresh: true, quality: 'TRUSTED' },
  authority: { present: true, valid: true },
  purpose: { present: true, matches: true },
  audit: { available: true },
  scope: { tenantMatches: true, jurisdictionMatches: true },
  integrity: { replayDetected: false, compromised: false, degraded: false },
  requestedOutput: 'ADVISORY'
});

const expectNoExecutionAuthority = (
  input: RosHeartEvaluationInput,
  disposition: RosHeartDecision['disposition'],
  reasonCode: string
) => {
  const result = evaluateRosHeart(input);
  assert.equal(result.disposition, disposition);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.executionAuthorized, false);
};

// Boolean-only callers must NOT be able to mint even an advisory allowance.
expectNoExecutionAuthority(baseline(), 'REQUEST_HUMAN_REVIEW', 'trusted_binding_required');

for (const requestedOutput of ['EMERGENCY_DISPATCH', 'TRAFFIC_SIGNAL_ACTUATION', 'DIRECT_VEHICLE_CONTROL'] as const) {
  expectNoExecutionAuthority({ ...baseline(), requestedOutput }, 'VETO', 'prohibited_effect_requested');
}

expectNoExecutionAuthority({ ...baseline(), audit: { available: false } }, 'VETO', 'audit_unavailable');
expectNoExecutionAuthority({ ...baseline(), integrity: { replayDetected: true, compromised: false, degraded: false } }, 'VETO', 'replay_detected');
expectNoExecutionAuthority({ ...baseline(), integrity: { replayDetected: false, compromised: true, degraded: false } }, 'VETO', 'component_compromised');
expectNoExecutionAuthority({ ...baseline(), integrity: { replayDetected: false, compromised: false, degraded: true } }, 'REQUEST_HUMAN_REVIEW', 'dependency_degraded');
expectNoExecutionAuthority({ ...baseline(), scope: { tenantMatches: false, jurisdictionMatches: true } }, 'VETO', 'tenant_scope_mismatch');
expectNoExecutionAuthority({ ...baseline(), scope: { tenantMatches: true, jurisdictionMatches: false } }, 'VETO', 'jurisdiction_scope_mismatch');
expectNoExecutionAuthority({ ...baseline(), purpose: { present: false, matches: false } }, 'VETO', 'purpose_missing_or_mismatch');
expectNoExecutionAuthority({ ...baseline(), evidence: { present: false, fresh: true, quality: 'MISSING' } }, 'REQUEST_MORE_EVIDENCE', 'evidence_missing');
expectNoExecutionAuthority({ ...baseline(), evidence: { present: true, fresh: false, quality: 'TRUSTED' } }, 'REQUEST_MORE_EVIDENCE', 'evidence_stale');
for (const quality of ['AMBIGUOUS', 'CONFLICTING'] as const) {
  expectNoExecutionAuthority({ ...baseline(), evidence: { present: true, fresh: true, quality } }, 'REQUEST_HUMAN_REVIEW', 'evidence_unresolved');
}
expectNoExecutionAuthority({ ...baseline(), authority: { present: false, valid: false } }, 'REQUEST_HUMAN_REVIEW', 'authority_missing_or_invalid');
expectNoExecutionAuthority({ ...baseline(), authority: { present: true, valid: false } }, 'REQUEST_HUMAN_REVIEW', 'authority_missing_or_invalid');
expectNoExecutionAuthority({ ...baseline(), requestedOutput: 'HUMAN_REVIEW' }, 'REQUEST_HUMAN_REVIEW', 'human_review_requested');

const NOW = Date.parse('2026-10-08T04:00:00.000Z');
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

const claim: RosHeartBinding = {
  roadEventId: 'event-001',
  humanSafetyCaseId: 'case-001',
  caseVersion: 7,
  humanSafetyState: 'HUMAN_REVIEW',
  humanSafetySeverity: 'S3',
  severityAssessmentVersion: 5,
  evidenceRevision: 3,
  indicatorRevision: 2,
  crsDigest: DIGEST_A,
  crsVersion: 2,
  crsExpiresAt: '2026-10-08T04:10:00.000Z',
  recommendationDigest: DIGEST_B,
  recommendationVersion: 4,
  recommendationExpiresAt: '2026-10-08T04:05:00.000Z',
  recommendationAuthority: 'NONE',
  directVehicleControl: false,
  policyDigest: DIGEST_C,
  policyVersion: 'heart.policy.v1',
  actorId: 'operator-001',
  actorRole: 'OPERATOR',
  traceId: 'trace-001',
  idempotencyKey: 'key-001',
  tenantId: 'tenant-001',
  purpose: 'HUMAN_SAFETY',
  jurisdiction: 'SA-RIYADH'
};

const trusted: RosHeartTrustedSnapshot = {
  binding: claim,
  checks: {
    evidence: baseline().evidence,
    authority: baseline().authority,
    purpose: baseline().purpose,
    audit: baseline().audit,
    scope: baseline().scope,
    integrity: baseline().integrity
  }
};

function ports(snapshot: RosHeartTrustedSnapshot | null = trusted): RosHeartBindingPorts {
  return {
    resolveTrustedSnapshot: async () => snapshot,
    consumeIdempotency: async () => 'CONSUMED',
    persistDecisionAudit: async () => 'PERSISTED',
    trustedNowEpochMs: () => NOW
  };
}

async function expectBound(
  boundClaim: RosHeartBinding,
  testPorts: RosHeartBindingPorts,
  disposition: RosHeartDecision['disposition'],
  reasonCode: string,
  requestedOutput: RosHeartEvaluationInput['requestedOutput'] = 'ADVISORY'
) {
  const result = await evaluateRosHeartBound({ claim: boundClaim, requestedOutput }, testPorts);
  assert.equal(result.disposition, disposition);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.executionAuthorized, false);
}

// Only the trusted-bound, fresh, replay-consumed and durably audited path can
// return ALLOW_ADVISORY. Even this result has NO execution authority.
await expectBound(claim, ports(), 'ALLOW_ADVISORY', 'advisory_prerequisites_satisfied');

const mismatches: ReadonlyArray<readonly [keyof RosHeartBinding, unknown]> = [
  ['roadEventId', 'event-other'], ['humanSafetyCaseId', 'case-other'],
  ['caseVersion', 8], ['humanSafetyState', 'ESCALATED'],
  ['humanSafetySeverity', 'S4'], ['severityAssessmentVersion', 6],
  ['evidenceRevision', 4], ['indicatorRevision', 3],
  ['crsDigest', DIGEST_B], ['crsVersion', 3],
  ['crsExpiresAt', '2026-10-08T04:09:00.000Z'],
  ['recommendationDigest', DIGEST_C], ['recommendationVersion', 5],
  ['recommendationExpiresAt', '2026-10-08T04:06:00.000Z'],
  ['policyDigest', DIGEST_B], ['policyVersion', 'heart.policy.v2'],
  ['actorId', 'other-actor'], ['actorRole', 'SUPERVISOR'],
  ['traceId', 'other-trace'], ['idempotencyKey', 'other-key'],
  ['tenantId', 'other-tenant'], ['purpose', 'TRAFFIC_OPTIMIZATION'],
  ['jurisdiction', 'SA-JEDDAH']
];

for (const [key, replacement] of mismatches) {
  const modified = { ...claim, [key]: replacement } as RosHeartBinding;
  await expectBound(modified, ports(), 'VETO', 'binding_mismatch_' + key);
}

await expectBound(claim, ports(null), 'VETO', 'trusted_snapshot_missing');
await expectBound({ ...claim, crsDigest: 'bad' }, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, policyVersion: '' }, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, caseVersion: 0 }, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, severityAssessmentVersion: 0 }, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, indicatorRevision: -1 }, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, humanSafetySeverity: 'S5' } as unknown as RosHeartBinding, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, humanSafetyState: 'NOT_A_STATE' } as unknown as RosHeartBinding, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, directVehicleControl: true } as unknown as RosHeartBinding, ports(), 'VETO', 'binding_invalid');
await expectBound({ ...claim, recommendationAuthority: 'EXECUTE' } as unknown as RosHeartBinding, ports(), 'VETO', 'binding_invalid');

const expired = { ...trusted, binding: { ...claim, crsExpiresAt: '2026-10-08T03:59:59.000Z' } };
await expectBound(expired.binding, ports(expired), 'REQUEST_MORE_EVIDENCE', 'binding_expired');
const expiredRecommendation = { ...trusted, binding: { ...claim, recommendationExpiresAt: '2026-10-08T03:59:59.000Z' } };
await expectBound(expiredRecommendation.binding, ports(expiredRecommendation), 'REQUEST_MORE_EVIDENCE', 'binding_expired');

await expectBound(claim, { ...ports(), consumeIdempotency: async () => 'DUPLICATE' }, 'VETO', 'idempotency_not_consumed');
await expectBound(claim, { ...ports(), consumeIdempotency: async () => 'UNAVAILABLE' }, 'VETO', 'idempotency_not_consumed');
await expectBound(claim, { ...ports(), persistDecisionAudit: async () => 'FAILED' }, 'VETO', 'audit_not_persisted');
await expectBound(claim, { ...ports(), resolveTrustedSnapshot: async () => { throw new Error('offline'); } }, 'VETO', 'trusted_binding_dependency_failure');
await expectBound(claim, { ...ports(), trustedNowEpochMs: () => Number.NaN }, 'VETO', 'trusted_clock_invalid');
await expectBound(claim, { ...ports(), trustedNowEpochMs: () => { throw new Error('clock unavailable'); } }, 'VETO', 'trusted_binding_dependency_failure');

await expectBound(claim, ports({ ...trusted, checks: { ...trusted.checks, evidence: { present: true, fresh: false, quality: 'TRUSTED' } } }), 'REQUEST_MORE_EVIDENCE', 'evidence_stale');
await expectBound(claim, ports({ ...trusted, checks: { ...trusted.checks, integrity: { replayDetected: false, compromised: true, degraded: false } } }), 'VETO', 'component_compromised');
await expectBound(claim, ports(), 'VETO', 'prohibited_effect_requested', 'DIRECT_VEHICLE_CONTROL');
await expectBound(claim, ports(), 'VETO', 'prohibited_effect_requested', 'EMERGENCY_DISPATCH');
await expectBound(claim, ports(), 'VETO', 'prohibited_effect_requested', 'TRAFFIC_SIGNAL_ACTUATION');

console.log('ROS Heart trusted context-binding negative gate: PASS');
