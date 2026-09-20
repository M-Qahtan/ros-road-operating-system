import type {
  CognitiveRoadState,
  CounterfactualCandidate,
  CounterfactualEvaluation,
  DecisionCriticalCoverageGate,
  EpistemicCoverageDimension,
  EpistemicCoverageMap,
} from '@ros/contracts';
import {
  evaluateCoverageGovernedCounterfactualCandidates,
  evaluateDecisionCriticalCoverage,
} from './epistemic-coverage.js';

export const GOVERNED_ROAD_INTELLIGENCE_CYCLE_SCHEMA = 'ros.governed-road-intelligence-cycle/v1' as const;

export interface GovernedRoadIntelligenceCycleInput {
  readonly map: EpistemicCoverageMap;
  readonly state: CognitiveRoadState;
  readonly evaluatedAt: string;
  readonly criticalRegionIds: readonly string[];
  readonly requiredDimensions: readonly EpistemicCoverageDimension[];
  readonly candidates: readonly CounterfactualCandidate[];
  readonly maxRecommendationUncertainty: number;
}

export interface GovernedRoadIntelligenceCycleResult {
  readonly schema: typeof GOVERNED_ROAD_INTELLIGENCE_CYCLE_SCHEMA;
  readonly crsId: string;
  readonly stateDigest: string;
  readonly coverageMapId: string;
  readonly coverageMapDigest: string;
  readonly evaluatedAt: string;
  readonly coverageDecision: DecisionCriticalCoverageGate['decision'];
  readonly decision: CounterfactualEvaluation['decision'];
  readonly selectedCandidateId: string | null;
  readonly selectedAction: CounterfactualCandidate['action'] | null;
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
  readonly candidateAuthorityCeiling: 'ADVISORY_ONLY';
  readonly executionAuthorized: false;
  readonly publicRoadAuthorized: false;
  readonly externalIntegrationAuthorized: false;
  readonly directVehicleControl: false;
  readonly negativeSceneInferenceAuthorized: false;
}

/**
 * One governed read-only intelligence cycle for ROS.
 *
 * This composes the current Cognitive Road State, the decision-critical
 * Epistemic Coverage Gate and the counterfactual evaluator into one
 * fail-closed result. It deliberately produces no actuator command and grants
 * no operational authority.
 */
export function evaluateGovernedRoadIntelligenceCycle(
  input: GovernedRoadIntelligenceCycleInput,
): GovernedRoadIntelligenceCycleResult {
  const coverage = evaluateDecisionCriticalCoverage({
    map: input.map,
    state: input.state,
    evaluatedAt: input.evaluatedAt,
    regionIds: input.criticalRegionIds,
    dimensions: input.requiredDimensions,
  });

  const evaluation = evaluateCoverageGovernedCounterfactualCandidates({
    map: input.map,
    state: input.state,
    evaluatedAt: input.evaluatedAt,
    criticalRegionIds: input.criticalRegionIds,
    requiredDimensions: input.requiredDimensions,
    candidates: input.candidates,
    maxRecommendationUncertainty: input.maxRecommendationUncertainty,
  });

  const selected = evaluation.selectedCandidateId === null
    ? null
    : input.candidates.find((candidate) => candidate.candidateId === evaluation.selectedCandidateId) ?? null;

  const selectedBoundaryViolation = selected !== null
    && (
      selected.authority !== 'ADVISORY_ONLY'
      || selected.directVehicleControl !== false
      || selected.requiresVehicleLocalVeto !== true
    );

  const decision: CounterfactualEvaluation['decision'] = selectedBoundaryViolation
    ? 'ABSTAIN'
    : evaluation.decision;

  return {
    schema: GOVERNED_ROAD_INTELLIGENCE_CYCLE_SCHEMA,
    crsId: input.state.crsId,
    stateDigest: input.state.stateDigest,
    coverageMapId: input.map.mapId,
    coverageMapDigest: input.map.mapDigest,
    evaluatedAt: input.evaluatedAt,
    coverageDecision: coverage.decision,
    decision,
    selectedCandidateId: selectedBoundaryViolation ? null : evaluation.selectedCandidateId,
    selectedAction: selectedBoundaryViolation ? null : selected?.action ?? null,
    reasonCodes: [
      ...new Set([
        ...coverage.reasonCodes,
        ...evaluation.reasonCodes,
        ...(selectedBoundaryViolation ? ['SELECTED_CANDIDATE_BOUNDARY_VIOLATION'] : []),
      ]),
    ].sort(),
    authority: 'NONE',
    candidateAuthorityCeiling: 'ADVISORY_ONLY',
    executionAuthorized: false,
    publicRoadAuthorized: false,
    externalIntegrationAuthorized: false,
    directVehicleControl: false,
    negativeSceneInferenceAuthorized: false,
  };
}
