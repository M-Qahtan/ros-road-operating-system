import assert from 'node:assert/strict';
import { evaluatePilotReadiness } from '../pilot/pilot-readiness.js';

function run(): void {
  const currentPreparation = evaluatePilotReadiness({
    engineering: {
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
    },
    field: {
      representativeRealDeviceCriticalFlowsPassed: false,
      gpsDegradationSafeStateVerified: false,
      networkLossSafeStateVerified: false,
      restartReconnectSafeStateVerified: false,
      operatorOverloadSafeStateVerified: false,
      screenReaderCriticalFlowsPassed: false,
      killSwitchTested: false,
      rollbackTested: false,
      evidenceIntegrityVerified: false,
      humanReviewAvailableForS3S4: false,
      duplicateLogicalActionsObserved: 0,
      staleStateUnsafeActionsObserved: 0,
      unresolvedP0P1Hazards: 0
    },
    external: {
      candidateGeographyApproved: false,
      candidateDateWindowApproved: false,
      realParticipantProtocolApproved: false,
      dataSharingApproved: false,
      privacyLegalReviewApproved: false,
      independentSafetySecurityReviewApproved: false,
      operationsSupportModelApproved: false,
      anyRequiredPartnerSandboxApproved: false
    },
    authority: {
      shadowOnlyEnforced: true,
      abstainOnUncertaintyEnforced: true,
      s3S4HumanAuthorityEnforced: true,
      realEmergencyDispatchEnabled: false,
      publicRoadAutonomousInterventionEnabled: false,
      liveCameraProgramEnabled: false,
      vehicleActuationEnabled: false,
      clinicalOrLegalAutomationEnabled: false
    }
  });

  assert.equal(currentPreparation.decision, 'ENGINEERING_PACKAGE_READY_FOR_INDEPENDENT_REVIEW');
  assert.equal(currentPreparation.engineeringPackageComplete, true);
  assert.equal(currentPreparation.fieldEvidenceComplete, false);
  assert.equal(currentPreparation.externalGatesComplete, false);
  assert.equal(currentPreparation.hardSafetyStop, false);
  assert.equal(currentPreparation.activationAuthorized, false);
  assert.equal(currentPreparation.founderFinalAuthorizationRequired, true);
  assert.ok(currentPreparation.fieldEvidenceMissing.length > 0);
  assert.ok(currentPreparation.externalGatesMissing.length > 0);

  const hypotheticalAllEvidence = evaluatePilotReadiness({
    engineering: {
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
    },
    field: {
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
    },
    external: {
      candidateGeographyApproved: true,
      candidateDateWindowApproved: true,
      realParticipantProtocolApproved: true,
      dataSharingApproved: true,
      privacyLegalReviewApproved: true,
      independentSafetySecurityReviewApproved: true,
      operationsSupportModelApproved: true,
      anyRequiredPartnerSandboxApproved: true
    },
    authority: {
      shadowOnlyEnforced: true,
      abstainOnUncertaintyEnforced: true,
      s3S4HumanAuthorityEnforced: true,
      realEmergencyDispatchEnabled: false,
      publicRoadAutonomousInterventionEnabled: false,
      liveCameraProgramEnabled: false,
      vehicleActuationEnabled: false,
      clinicalOrLegalAutomationEnabled: false
    }
  });

  assert.equal(hypotheticalAllEvidence.decision, 'READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL');
  assert.equal(hypotheticalAllEvidence.activationAuthorized, false);
  assert.equal(hypotheticalAllEvidence.founderFinalAuthorizationRequired, true);

  const forbiddenAuthority = evaluatePilotReadiness({
    ...hypotheticalAllEvidenceToInput(),
    authority: {
      ...hypotheticalAllEvidenceToInput().authority,
      realEmergencyDispatchEnabled: true
    }
  });
  assert.equal(forbiddenAuthority.decision, 'NO_GO');
  assert.equal(forbiddenAuthority.hardSafetyStop, true);
  assert.equal(forbiddenAuthority.activationAuthorized, false);

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    currentDecision: currentPreparation.decision,
    engineeringPackageComplete: currentPreparation.engineeringPackageComplete,
    realDeviceEvidenceComplete: currentPreparation.fieldEvidenceComplete,
    externalGatesComplete: currentPreparation.externalGatesComplete,
    currentActivationAuthorized: currentPreparation.activationAuthorized,
    hypotheticalApprovalReadinessStillNotActivation: hypotheticalAllEvidence.activationAuthorized === false,
    forbiddenAuthorityForcesNoGo: forbiddenAuthority.decision === 'NO_GO',
    shadowOnlyEnforced: true,
    abstainOnUncertaintyEnforced: true,
    s3S4HumanAuthorityEnforced: true,
    publicRoadLaunchAuthorized: false
  }) + '\n');
}

function hypotheticalAllEvidenceToInput() {
  return {
    engineering: {
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
    },
    field: {
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
    },
    external: {
      candidateGeographyApproved: true,
      candidateDateWindowApproved: true,
      realParticipantProtocolApproved: true,
      dataSharingApproved: true,
      privacyLegalReviewApproved: true,
      independentSafetySecurityReviewApproved: true,
      operationsSupportModelApproved: true,
      anyRequiredPartnerSandboxApproved: true
    },
    authority: {
      shadowOnlyEnforced: true,
      abstainOnUncertaintyEnforced: true,
      s3S4HumanAuthorityEnforced: true,
      realEmergencyDispatchEnabled: false,
      publicRoadAutonomousInterventionEnabled: false,
      liveCameraProgramEnabled: false,
      vehicleActuationEnabled: false,
      clinicalOrLegalAutomationEnabled: false
    }
  } as const;
}

run();
