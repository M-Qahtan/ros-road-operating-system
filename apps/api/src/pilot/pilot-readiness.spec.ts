import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PilotReadinessInput,
  evaluatePilotReadiness
} from './pilot-readiness.js';

function completeEngineering() {
  return {
    exactHeadVerificationGreen: true,
    runtimeResilienceEvidenceComplete: true,
    integrationTrustBoundaryDocumented: true,
    fieldValidationMatrixDefined: true,
    multilingualAccessibilityPlanDefined: true,
    kpiMeasurementPlanDefined: true,
    shadowCanaryRollbackPlanDefined: true,
    privacyConsentPlanDefined: true,
    fieldRunbooksDefined: true,
    evidenceCapturePlanDefined: true
  } as const;
}

function completeField() {
  return {
    representativeRealDeviceCriticalFlowsPassed: true,
    gpsDegradationSafeStateVerified: true,
    networkLossSafeStateVerified: true,
    restartReconnectSafeStateVerified: true,
    operatorOverloadSafeStateVerified: true,
    screenReaderCriticalFlowsPassed: true,
    killSwitchTested: true,
    rollbackTested: true,
    evidenceIntegrityVerified: true,
    humanReviewAvailableForS3S4: true,
    duplicateLogicalActionsObserved: 0,
    staleStateUnsafeActionsObserved: 0,
    unresolvedP0P1Hazards: 0
  } as const;
}

function completeExternal() {
  return {
    candidateGeographyApproved: true,
    candidateDateWindowApproved: true,
    realParticipantProtocolApproved: true,
    dataSharingApproved: true,
    privacyLegalReviewApproved: true,
    independentSafetySecurityReviewApproved: true,
    operationsSupportModelApproved: true,
    anyRequiredPartnerSandboxApproved: true
  } as const;
}

function safeAuthority() {
  return {
    shadowOnlyEnforced: true,
    abstainOnUncertaintyEnforced: true,
    s3S4HumanAuthorityEnforced: true,
    realEmergencyDispatchEnabled: false,
    publicRoadAutonomousInterventionEnabled: false,
    liveCameraProgramEnabled: false,
    vehicleActuationEnabled: false,
    clinicalOrLegalAutomationEnabled: false
  } as const;
}

function fixture(overrides: Partial<PilotReadinessInput> = {}): PilotReadinessInput {
  return {
    engineering: completeEngineering(),
    field: completeField(),
    external: completeExternal(),
    authority: safeAuthority(),
    ...overrides
  };
}

test('engineering package alone never becomes a real-pilot authorization', () => {
  const result = evaluatePilotReadiness(fixture({
    field: {
      ...completeField(),
      representativeRealDeviceCriticalFlowsPassed: false,
      screenReaderCriticalFlowsPassed: false,
      killSwitchTested: false,
      rollbackTested: false
    },
    external: {
      ...completeExternal(),
      candidateGeographyApproved: false,
      candidateDateWindowApproved: false,
      realParticipantProtocolApproved: false,
      dataSharingApproved: false,
      privacyLegalReviewApproved: false,
      independentSafetySecurityReviewApproved: false,
      operationsSupportModelApproved: false,
      anyRequiredPartnerSandboxApproved: false
    }
  }));

  assert.equal(result.decision, 'ENGINEERING_PACKAGE_READY_FOR_INDEPENDENT_REVIEW');
  assert.equal(result.engineeringPackageComplete, true);
  assert.equal(result.fieldEvidenceComplete, false);
  assert.equal(result.externalGatesComplete, false);
  assert.equal(result.activationAuthorized, false);
  assert.equal(result.founderFinalAuthorizationRequired, true);
  assert.ok(result.fieldEvidenceMissing.length >= 4);
  assert.ok(result.externalGatesMissing.length >= 8);
});

test('all preparation evidence can only become ready for governed approval, never automatic activation', () => {
  const result = evaluatePilotReadiness(fixture());
  assert.equal(result.decision, 'READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL');
  assert.equal(result.engineeringPackageComplete, true);
  assert.equal(result.fieldEvidenceComplete, true);
  assert.equal(result.externalGatesComplete, true);
  assert.equal(result.hardSafetyStop, false);
  assert.equal(result.activationAuthorized, false);
  assert.equal(result.founderFinalAuthorizationRequired, true);
});

test('any unresolved P0/P1 hazard is a hard NO-GO even when every checkbox is true', () => {
  const result = evaluatePilotReadiness(fixture({
    field: { ...completeField(), unresolvedP0P1Hazards: 1 }
  }));
  assert.equal(result.decision, 'NO_GO');
  assert.equal(result.hardSafetyStop, true);
  assert.match(result.blockingReasons.join(' | '), /unresolved P0\/P1 hazards/);
});

test('duplicate logical action or unsafe stale-state action is a hard NO-GO', () => {
  const duplicate = evaluatePilotReadiness(fixture({
    field: { ...completeField(), duplicateLogicalActionsObserved: 1 }
  }));
  assert.equal(duplicate.decision, 'NO_GO');
  assert.match(duplicate.blockingReasons.join(' | '), /duplicate logical actions/);

  const stale = evaluatePilotReadiness(fixture({
    field: { ...completeField(), staleStateUnsafeActionsObserved: 1 }
  }));
  assert.equal(stale.decision, 'NO_GO');
  assert.match(stale.blockingReasons.join(' | '), /unsafe actions from stale state/);
});

test('breaking SHADOW_ONLY or S3/S4 human authority is always a hard NO-GO', () => {
  const shadow = evaluatePilotReadiness(fixture({
    authority: { ...safeAuthority(), shadowOnlyEnforced: false }
  }));
  assert.equal(shadow.decision, 'NO_GO');
  assert.match(shadow.blockingReasons.join(' | '), /SHADOW_ONLY/);

  const human = evaluatePilotReadiness(fixture({
    authority: { ...safeAuthority(), s3S4HumanAuthorityEnforced: false }
  }));
  assert.equal(human.decision, 'NO_GO');
  assert.match(human.blockingReasons.join(' | '), /S3\/S4 human authority/);
});

test('forbidden live capabilities are hard NO-GO regardless of other evidence', () => {
  for (const patch of [
    { realEmergencyDispatchEnabled: true },
    { publicRoadAutonomousInterventionEnabled: true },
    { liveCameraProgramEnabled: true },
    { vehicleActuationEnabled: true },
    { clinicalOrLegalAutomationEnabled: true }
  ]) {
    const result = evaluatePilotReadiness(fixture({
      authority: { ...safeAuthority(), ...patch }
    }));
    assert.equal(result.decision, 'NO_GO');
    assert.equal(result.hardSafetyStop, true);
    assert.equal(result.activationAuthorized, false);
  }
});

test('invalid evidence counters fail closed instead of being silently normalized', () => {
  assert.throws(() => evaluatePilotReadiness(fixture({
    field: { ...completeField(), duplicateLogicalActionsObserved: -1 }
  })), /non-negative safe integer/);
  assert.throws(() => evaluatePilotReadiness(fixture({
    field: { ...completeField(), unresolvedP0P1Hazards: Number.NaN }
  })), /non-negative safe integer/);
});
