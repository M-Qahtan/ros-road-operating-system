import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROLLED_PILOT_READINESS_DECISION,
  ControlledPilotReadinessEvidence,
  evaluateControlledPilotReadiness
} from './controlled-pilot-readiness.js';

const COMPLETE_EVIDENCE: ControlledPilotReadinessEvidence = {
  p0WorkflowsDemonstratedEndToEnd: true,
  criticalSecurityFindingsClosed: true,
  backupRestoreVerified: true,
  auditReconstructionComplete: true,
  operatorsPassedSimulations: true,
  allAgencyInteractionsSimulated: true,
  runtimeReadyForStaging: true,
  integrationSandboxReady: true,
  representativeDeviceTestsPassed: true,
  accessibilityAndHumanFactorsPassed: true,
  loadSoakChaosEvidencePassed: true,
  privacyImpactReviewComplete: true,
  externalApprovalsComplete: true,
  controlledGeographyDefined: true,
  measurableStopCriteriaDefined: true,
  rollbackPlanVerified: true,
  humanAuthorityBoundaryVerified: true,
  unresolvedP0P1Hazards: 0
};

test('complete evidence is ready only for governed approval review', () => {
  const result = evaluateControlledPilotReadiness(COMPLETE_EVIDENCE);
  assert.equal(result.decision, CONTROLLED_PILOT_READINESS_DECISION.READY_FOR_APPROVAL_REVIEW);
  assert.equal(result.authorizationGranted, false);
  assert.deepEqual(result.failedGates, []);
});

test('missing field-device evidence fails closed', () => {
  const result = evaluateControlledPilotReadiness({
    ...COMPLETE_EVIDENCE,
    representativeDeviceTestsPassed: false
  });
  assert.equal(result.decision, CONTROLLED_PILOT_READINESS_DECISION.NOT_READY);
  assert.match(result.failedGates.join('\n'), /field-device/);
});

test('any unresolved P0 or P1 hazard blocks readiness', () => {
  const result = evaluateControlledPilotReadiness({
    ...COMPLETE_EVIDENCE,
    unresolvedP0P1Hazards: 1
  });
  assert.equal(result.decision, CONTROLLED_PILOT_READINESS_DECISION.NOT_READY);
  assert.match(result.failedGates.join('\n'), /Unresolved P0\/P1 hazards/);
});

test('missing external approvals cannot be treated as pilot authorization', () => {
  const result = evaluateControlledPilotReadiness({
    ...COMPLETE_EVIDENCE,
    externalApprovalsComplete: false
  });
  assert.equal(result.decision, CONTROLLED_PILOT_READINESS_DECISION.NOT_READY);
  assert.equal(result.authorizationGranted, false);
  assert.match(result.failedGates.join('\n'), /external approvals/);
});

test('invalid hazard counts fail closed', () => {
  const result = evaluateControlledPilotReadiness({
    ...COMPLETE_EVIDENCE,
    unresolvedP0P1Hazards: -1
  });
  assert.equal(result.decision, CONTROLLED_PILOT_READINESS_DECISION.NOT_READY);
  assert.match(result.failedGates.join('\n'), /hazard count is invalid/);
});
