export const CONTROLLED_PILOT_READINESS_DECISION = {
  READY_FOR_APPROVAL_REVIEW: 'READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL_REVIEW',
  NOT_READY: 'NOT_READY_FOR_GOVERNED_RIYADH_PILOT_APPROVAL_REVIEW'
} as const;

export type ControlledPilotReadinessDecision =
  (typeof CONTROLLED_PILOT_READINESS_DECISION)[keyof typeof CONTROLLED_PILOT_READINESS_DECISION];

export interface ControlledPilotReadinessEvidence {
  readonly p0WorkflowsDemonstratedEndToEnd: boolean;
  readonly criticalSecurityFindingsClosed: boolean;
  readonly backupRestoreVerified: boolean;
  readonly auditReconstructionComplete: boolean;
  readonly operatorsPassedSimulations: boolean;
  readonly allAgencyInteractionsSimulated: boolean;
  readonly runtimeReadyForStaging: boolean;
  readonly integrationSandboxReady: boolean;
  readonly representativeDeviceTestsPassed: boolean;
  readonly accessibilityAndHumanFactorsPassed: boolean;
  readonly loadSoakChaosEvidencePassed: boolean;
  readonly privacyImpactReviewComplete: boolean;
  readonly externalApprovalsComplete: boolean;
  readonly controlledGeographyDefined: boolean;
  readonly measurableStopCriteriaDefined: boolean;
  readonly rollbackPlanVerified: boolean;
  readonly humanAuthorityBoundaryVerified: boolean;
  readonly unresolvedP0P1Hazards: number;
}

export interface ControlledPilotReadinessResult {
  readonly decision: ControlledPilotReadinessDecision;
  readonly authorizationGranted: false;
  readonly failedGates: readonly string[];
}

const BOOLEAN_GATES: ReadonlyArray<readonly [keyof ControlledPilotReadinessEvidence, string]> = [
  ['p0WorkflowsDemonstratedEndToEnd', 'P0 workflows are not demonstrated end to end'],
  ['criticalSecurityFindingsClosed', 'Critical security findings remain open'],
  ['backupRestoreVerified', 'Backup/restore evidence is incomplete'],
  ['auditReconstructionComplete', 'Audit reconstruction is incomplete'],
  ['operatorsPassedSimulations', 'Operator simulations are incomplete'],
  ['allAgencyInteractionsSimulated', 'Agency interactions are not constrained to simulation'],
  ['runtimeReadyForStaging', 'Runtime readiness gate is not PASS'],
  ['integrationSandboxReady', 'Integration sandbox readiness gate is not PASS'],
  ['representativeDeviceTestsPassed', 'Representative field-device testing is incomplete'],
  ['accessibilityAndHumanFactorsPassed', 'Accessibility/human-factors validation is incomplete'],
  ['loadSoakChaosEvidencePassed', 'Load/soak/chaos evidence is incomplete'],
  ['privacyImpactReviewComplete', 'Privacy-impact review is incomplete'],
  ['externalApprovalsComplete', 'Required external approvals are incomplete'],
  ['controlledGeographyDefined', 'Controlled pilot geography is undefined'],
  ['measurableStopCriteriaDefined', 'Measurable stop criteria are undefined'],
  ['rollbackPlanVerified', 'Rollback plan is not verified'],
  ['humanAuthorityBoundaryVerified', 'Human authority boundary is not verified']
];

/**
 * Evaluates whether the evidence package is complete enough to be submitted
 * for governed founder/external approval review. A PASS here never authorizes
 * public-road operation, live agency integration or autonomous intervention.
 */
export function evaluateControlledPilotReadiness(
  evidence: ControlledPilotReadinessEvidence
): ControlledPilotReadinessResult {
  const failedGates: string[] = [];

  for (const [key, failure] of BOOLEAN_GATES) {
    if (evidence[key] !== true) failedGates.push(failure);
  }

  if (!Number.isSafeInteger(evidence.unresolvedP0P1Hazards) || evidence.unresolvedP0P1Hazards < 0) {
    failedGates.push('P0/P1 hazard count is invalid');
  } else if (evidence.unresolvedP0P1Hazards > 0) {
    failedGates.push('Unresolved P0/P1 hazards remain');
  }

  return {
    decision:
      failedGates.length === 0
        ? CONTROLLED_PILOT_READINESS_DECISION.READY_FOR_APPROVAL_REVIEW
        : CONTROLLED_PILOT_READINESS_DECISION.NOT_READY,
    authorizationGranted: false,
    failedGates
  };
}
