import assert from 'node:assert/strict';
import { evaluateRosHeart, type RosHeartEvaluationInput } from './ros-heart.js';

const baseline = (): RosHeartEvaluationInput => ({
  evidence: { present: true, fresh: true, quality: 'TRUSTED' },
  authority: { present: true, valid: true },
  purpose: { present: true, matches: true },
  audit: { available: true },
  scope: { tenantMatches: true, jurisdictionMatches: true },
  integrity: { replayDetected: false, compromised: false, degraded: false },
  requestedOutput: 'ADVISORY'
});

const expectNoExecutionAuthority = (input: RosHeartEvaluationInput, disposition: ReturnType<typeof evaluateRosHeart>['disposition'], reasonCode: string) => {
  const result = evaluateRosHeart(input);
  assert.equal(result.disposition, disposition);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.authority, 'NONE');
  assert.equal(result.executionAuthorized, false);
};

expectNoExecutionAuthority(baseline(), 'ALLOW_ADVISORY', 'advisory_prerequisites_satisfied');

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

console.log('ROS Heart fail-closed contract tests passed');
