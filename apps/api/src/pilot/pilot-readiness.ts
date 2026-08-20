export type PilotReadinessDecision =
  | 'NO_GO'
  | 'ENGINEERING_PACKAGE_READY_FOR_INDEPENDENT_REVIEW'
  | 'READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL';

export interface PilotEngineeringEvidence {
  readonly exactHeadVerificationGreen: boolean;
  readonly runtimeResilienceEvidenceComplete: boolean;
  readonly integrationTrustBoundaryDocumented: boolean;
  readonly fieldValidationMatrixDefined: boolean;
  readonly multilingualAccessibilityPlanDefined: boolean;
  readonly kpiMeasurementPlanDefined: boolean;
  readonly shadowCanaryRollbackPlanDefined: boolean;
  readonly privacyConsentPlanDefined: boolean;
  readonly fieldRunbooksDefined: boolean;
  readonly evidenceCapturePlanDefined: boolean;
}

export interface PilotFieldEvidence {
  readonly representativeRealDeviceCriticalFlowsPassed: boolean;
  readonly gpsDegradationSafeStateVerified: boolean;
  readonly networkLossSafeStateVerified: boolean;
  readonly restartReconnectSafeStateVerified: boolean;
  readonly operatorOverloadSafeStateVerified: boolean;
  readonly screenReaderCriticalFlowsPassed: boolean;
  readonly killSwitchTested: boolean;
  readonly rollbackTested: boolean;
  readonly evidenceIntegrityVerified: boolean;
  readonly humanReviewAvailableForS3S4: boolean;
  readonly duplicateLogicalActionsObserved: number;
  readonly staleStateUnsafeActionsObserved: number;
  readonly unresolvedP0P1Hazards: number;
}

export interface PilotExternalGates {
  readonly candidateGeographyApproved: boolean;
  readonly candidateDateWindowApproved: boolean;
  readonly realParticipantProtocolApproved: boolean;
  readonly dataSharingApproved: boolean;
  readonly privacyLegalReviewApproved: boolean;
  readonly independentSafetySecurityReviewApproved: boolean;
  readonly operationsSupportModelApproved: boolean;
  readonly anyRequiredPartnerSandboxApproved: boolean;
}

export interface PilotAuthorityBoundary {
  readonly shadowOnlyEnforced: boolean;
  readonly abstainOnUncertaintyEnforced: boolean;
  readonly s3S4HumanAuthorityEnforced: boolean;
  readonly realEmergencyDispatchEnabled: boolean;
  readonly publicRoadAutonomousInterventionEnabled: boolean;
  readonly liveCameraProgramEnabled: boolean;
  readonly vehicleActuationEnabled: boolean;
  readonly clinicalOrLegalAutomationEnabled: boolean;
}

export interface PilotReadinessInput {
  readonly engineering: PilotEngineeringEvidence;
  readonly field: PilotFieldEvidence;
  readonly external: PilotExternalGates;
  readonly authority: PilotAuthorityBoundary;
}

export interface PilotReadinessResult {
  readonly decision: PilotReadinessDecision;
  readonly engineeringPackageComplete: boolean;
  readonly fieldEvidenceComplete: boolean;
  readonly externalGatesComplete: boolean;
  readonly hardSafetyStop: boolean;
  readonly blockingReasons: readonly string[];
  readonly fieldEvidenceMissing: readonly string[];
  readonly externalGatesMissing: readonly string[];
  /** Code can assess readiness, but it can never authorize a real pilot activation. */
  readonly activationAuthorized: false;
  readonly founderFinalAuthorizationRequired: true;
}

const ENGINEERING_GATES: ReadonlyArray<readonly [keyof PilotEngineeringEvidence, string]> = [
  ['exactHeadVerificationGreen', 'exact-head verification is not green'],
  ['runtimeResilienceEvidenceComplete', 'runtime resilience evidence is incomplete'],
  ['integrationTrustBoundaryDocumented', 'integration trust/external boundary is not documented'],
  ['fieldValidationMatrixDefined', 'field validation matrix is not defined'],
  ['multilingualAccessibilityPlanDefined', 'multilingual/accessibility plan is not defined'],
  ['kpiMeasurementPlanDefined', 'KPI measurement plan is not defined'],
  ['shadowCanaryRollbackPlanDefined', 'shadow/canary/rollback plan is not defined'],
  ['privacyConsentPlanDefined', 'privacy/consent plan is not defined'],
  ['fieldRunbooksDefined', 'field failure/escalation runbooks are not defined'],
  ['evidenceCapturePlanDefined', 'pilot evidence capture plan is not defined']
];

const FIELD_GATES: ReadonlyArray<readonly [keyof PilotFieldEvidence, string]> = [
  ['representativeRealDeviceCriticalFlowsPassed', 'representative real-device critical flows have not passed'],
  ['gpsDegradationSafeStateVerified', 'GPS degradation safe state has not been verified'],
  ['networkLossSafeStateVerified', 'network-loss safe state has not been verified'],
  ['restartReconnectSafeStateVerified', 'restart/reconnect safe state has not been verified'],
  ['operatorOverloadSafeStateVerified', 'operator-overload safe state has not been verified'],
  ['screenReaderCriticalFlowsPassed', 'screen-reader critical flows have not passed on representative devices'],
  ['killSwitchTested', 'pilot kill switch has not been tested'],
  ['rollbackTested', 'pilot rollback has not been tested'],
  ['evidenceIntegrityVerified', 'pilot evidence integrity has not been verified'],
  ['humanReviewAvailableForS3S4', 'S3/S4 human review is not available']
];

const EXTERNAL_GATES: ReadonlyArray<readonly [keyof PilotExternalGates, string]> = [
  ['candidateGeographyApproved', 'candidate pilot geography is not approved'],
  ['candidateDateWindowApproved', 'candidate pilot date/window is not approved'],
  ['realParticipantProtocolApproved', 'real participant protocol is not approved'],
  ['dataSharingApproved', 'pilot data-sharing scope is not approved'],
  ['privacyLegalReviewApproved', 'privacy/legal review is not approved'],
  ['independentSafetySecurityReviewApproved', 'independent safety/security review is not approved'],
  ['operationsSupportModelApproved', 'pilot operations/support model is not approved'],
  ['anyRequiredPartnerSandboxApproved', 'required partner sandbox scope is not approved or explicitly declared unnecessary']
];

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function missingBooleanGates<T extends object>(
  source: T,
  gates: ReadonlyArray<readonly [keyof T, string]>
): string[] {
  return gates.filter(([key]) => source[key] !== true).map(([, reason]) => reason);
}

/**
 * Fail-closed governance evaluator for preparation of a controlled Riyadh pilot.
 *
 * This function never authorizes activation. It only distinguishes engineering
 * package completeness from field/external readiness and hard safety stops.
 */
export function evaluatePilotReadiness(input: PilotReadinessInput): PilotReadinessResult {
  const duplicateLogicalActions = nonNegativeInteger(
    input.field.duplicateLogicalActionsObserved,
    'duplicateLogicalActionsObserved'
  );
  const staleStateUnsafeActions = nonNegativeInteger(
    input.field.staleStateUnsafeActionsObserved,
    'staleStateUnsafeActionsObserved'
  );
  const unresolvedP0P1Hazards = nonNegativeInteger(
    input.field.unresolvedP0P1Hazards,
    'unresolvedP0P1Hazards'
  );

  const engineeringMissing = missingBooleanGates(input.engineering, ENGINEERING_GATES);
  const fieldMissing = missingBooleanGates(input.field, FIELD_GATES);
  const externalMissing = missingBooleanGates(input.external, EXTERNAL_GATES);

  const hardStops: string[] = [];
  if (!input.authority.shadowOnlyEnforced) hardStops.push('SHADOW_ONLY is not enforced');
  if (!input.authority.abstainOnUncertaintyEnforced) hardStops.push('ABSTAIN-on-uncertainty is not enforced');
  if (!input.authority.s3S4HumanAuthorityEnforced) hardStops.push('S3/S4 human authority is not enforced');
  if (input.authority.realEmergencyDispatchEnabled) hardStops.push('real emergency dispatch is enabled before pilot authorization');
  if (input.authority.publicRoadAutonomousInterventionEnabled) hardStops.push('public-road autonomous intervention is enabled');
  if (input.authority.liveCameraProgramEnabled) hardStops.push('live camera program is enabled without separate approval');
  if (input.authority.vehicleActuationEnabled) hardStops.push('vehicle actuation is enabled without separate approval');
  if (input.authority.clinicalOrLegalAutomationEnabled) hardStops.push('clinical/legal automation is enabled');
  if (duplicateLogicalActions > 0) hardStops.push('duplicate logical actions were observed');
  if (staleStateUnsafeActions > 0) hardStops.push('unsafe actions from stale state were observed');
  if (unresolvedP0P1Hazards > 0) hardStops.push('unresolved P0/P1 hazards remain');

  const engineeringPackageComplete = engineeringMissing.length === 0;
  const fieldEvidenceComplete = fieldMissing.length === 0 && duplicateLogicalActions === 0 && staleStateUnsafeActions === 0 && unresolvedP0P1Hazards === 0;
  const externalGatesComplete = externalMissing.length === 0;
  const hardSafetyStop = hardStops.length > 0;

  let decision: PilotReadinessDecision = 'NO_GO';
  if (!hardSafetyStop && engineeringPackageComplete) {
    decision = fieldEvidenceComplete && externalGatesComplete
      ? 'READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL'
      : 'ENGINEERING_PACKAGE_READY_FOR_INDEPENDENT_REVIEW';
  }

  return Object.freeze({
    decision,
    engineeringPackageComplete,
    fieldEvidenceComplete,
    externalGatesComplete,
    hardSafetyStop,
    blockingReasons: Object.freeze([...hardStops, ...engineeringMissing]),
    fieldEvidenceMissing: Object.freeze(fieldMissing),
    externalGatesMissing: Object.freeze(externalMissing),
    activationAuthorized: false,
    founderFinalAuthorizationRequired: true
  });
}
