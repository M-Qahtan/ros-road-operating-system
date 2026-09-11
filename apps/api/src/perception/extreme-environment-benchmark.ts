import {
  comparePerceptionBenchmarks,
  validatePerceptionBenchmarkCase,
  type PerceptionBenchmarkCase,
  type PerceptionBenchmarkComparison,
} from '@ros/contracts';

export type ExtremeEnvironmentGateDecision =
  | 'INVALID_COMPARISON'
  | 'REJECTED_PROTECTED_REGRESSION'
  | 'ELIGIBLE_FOR_PERFORMANCE_REVIEW';

export interface ExtremeEnvironmentGateResult {
  readonly decision: ExtremeEnvironmentGateDecision;
  readonly comparison: PerceptionBenchmarkComparison | null;
  readonly reasonCodes: readonly string[];
  readonly descriptiveDeltas: Readonly<Record<string, number>>;
  readonly authority: 'NONE';
}

/**
 * Safety gate for benchmark pairs. It deliberately refuses to collapse metrics
 * into one weighted score: gains in latency/recall cannot compensate for a
 * regression in missed hazards, false hazard acceptance, unsafe confidence or
 * authority invariants.
 */
export function evaluateExtremeEnvironmentCandidate(
  baseline: PerceptionBenchmarkCase,
  candidate: PerceptionBenchmarkCase,
): ExtremeEnvironmentGateResult {
  const reasons: string[] = [];
  for (const error of validatePerceptionBenchmarkCase(baseline)) reasons.push(`BASELINE_${error}`);
  for (const error of validatePerceptionBenchmarkCase(candidate)) reasons.push(`CANDIDATE_${error}`);

  if (baseline.scenarioId === candidate.scenarioId) reasons.push('SCENARIO_IDS_MUST_DIFFER');
  if (!sameStressConditions(baseline, candidate)) reasons.push('STRESS_CONDITIONS_MISMATCH');
  if (stableStringify(baseline.environment.odd) !== stableStringify(candidate.environment.odd)) reasons.push('ODD_MISMATCH');
  if (baseline.groundTruth.source !== candidate.groundTruth.source) reasons.push('GROUND_TRUTH_SOURCE_MISMATCH');
  if (baseline.groundTruth.evidenceManifestId !== candidate.groundTruth.evidenceManifestId) {
    reasons.push('GROUND_TRUTH_EVIDENCE_MISMATCH');
  }

  if (reasons.length > 0) {
    return {
      decision: 'INVALID_COMPARISON',
      comparison: null,
      reasonCodes: [...new Set(reasons)].sort(),
      descriptiveDeltas: {},
      authority: 'NONE',
    };
  }

  const comparison = comparePerceptionBenchmarks(baseline, candidate);
  if (comparison.protectedRegression) {
    return {
      decision: 'REJECTED_PROTECTED_REGRESSION',
      comparison,
      reasonCodes: [...comparison.regressions].sort(),
      descriptiveDeltas: descriptiveDeltas(baseline, candidate),
      authority: 'NONE',
    };
  }

  return {
    decision: 'ELIGIBLE_FOR_PERFORMANCE_REVIEW',
    comparison,
    reasonCodes: ['NO_PROTECTED_REGRESSION'],
    descriptiveDeltas: descriptiveDeltas(baseline, candidate),
    authority: 'NONE',
  };
}

function sameStressConditions(a: PerceptionBenchmarkCase, b: PerceptionBenchmarkCase): boolean {
  const left = [...new Set(a.environment.stressConditions)].sort();
  const right = [...new Set(b.environment.stressConditions)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function descriptiveDeltas(
  baseline: PerceptionBenchmarkCase,
  candidate: PerceptionBenchmarkCase,
): Readonly<Record<string, number>> {
  return Object.freeze({
    detectionPrecision: candidate.metrics.detectionPrecision - baseline.metrics.detectionPrecision,
    detectionRecall: candidate.metrics.detectionRecall - baseline.metrics.detectionRecall,
    positionRmseM: candidate.metrics.positionRmseM - baseline.metrics.positionRmseM,
    velocityRmseMps: candidate.metrics.velocityRmseMps - baseline.metrics.velocityRmseMps,
    trackContinuity: candidate.metrics.trackContinuity - baseline.metrics.trackContinuity,
    falseTrackRate: candidate.metrics.falseTrackRate - baseline.metrics.falseTrackRate,
    latencyP95Ms: candidate.metrics.latencyP95Ms - baseline.metrics.latencyP95Ms,
    confidenceCalibrationError: candidate.metrics.confidenceCalibrationError - baseline.metrics.confidenceCalibrationError,
    falseHazardAcceptanceRate: candidate.metrics.falseHazardAcceptanceRate - baseline.metrics.falseHazardAcceptanceRate,
    missedHazardRate: candidate.metrics.missedHazardRate - baseline.metrics.missedHazardRate,
    unsafeConfidenceRate: candidate.metrics.unsafeConfidenceRate - baseline.metrics.unsafeConfidenceRate,
    evidenceCompleteness: candidate.metrics.evidenceCompleteness - baseline.metrics.evidenceCompleteness,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
