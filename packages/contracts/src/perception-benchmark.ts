export const EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA = 'ros.perception-benchmark/v1' as const;

export type EnvironmentStressCondition =
  | 'EXTREME_HEAT'
  | 'THERMAL_HAZE'
  | 'SUSPENDED_DUST'
  | 'SANDSTORM'
  | 'DIRECT_SUN_GLARE'
  | 'PITCH_DARKNESS'
  | 'TUNNEL_TRANSITION'
  | 'SMOKE'
  | 'FIRE'
  | 'PARTIAL_OCCLUSION'
  | 'DIRTY_APERTURE'
  | 'CALIBRATION_DRIFT'
  | 'NETWORK_DEGRADATION'
  | 'SENSOR_DROPOUT';

export type PerceptionStack =
  | 'RGB_ONLY'
  | 'THERMAL_ONLY'
  | 'LIDAR_4D_ONLY'
  | 'RGB_TRACKING'
  | 'RGB_LIDAR_4D'
  | 'MULTIMODAL_FUSION'
  | 'ASSURED_FUSION_CPAL_CRS';

export interface PerceptionBenchmarkMetrics {
  readonly detectionPrecision: number;
  readonly detectionRecall: number;
  readonly positionRmseM: number;
  readonly velocityRmseMps: number;
  readonly trackContinuity: number;
  readonly falseTrackRate: number;
  readonly latencyP95Ms: number;
  readonly confidenceCalibrationError: number;
  readonly falseHazardAcceptanceRate: number;
  readonly missedHazardRate: number;
  readonly unsafeConfidenceRate: number;
  readonly authorityViolationCount: number;
  readonly evidenceCompleteness: number;
}

export interface PerceptionBenchmarkCase {
  readonly schema: typeof EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA;
  readonly scenarioId: string;
  readonly stack: PerceptionStack;
  readonly environment: {
    readonly stressConditions: readonly EnvironmentStressCondition[];
    readonly odd: Readonly<Record<string, unknown>>;
  };
  readonly groundTruth: {
    readonly source: string;
    readonly independentOfSystemUnderTest: true;
    readonly evidenceManifestId: string;
  };
  readonly metrics: PerceptionBenchmarkMetrics;
  readonly protectedInvariantViolations: readonly string[];
  readonly evidenceManifestId: string;
}

export interface PerceptionBenchmarkComparison {
  readonly baselineScenarioId: string;
  readonly candidateScenarioId: string;
  readonly protectedRegression: boolean;
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
}

const RATE_METRICS: readonly (keyof PerceptionBenchmarkMetrics)[] = [
  'detectionPrecision',
  'detectionRecall',
  'trackContinuity',
  'confidenceCalibrationError',
  'falseHazardAcceptanceRate',
  'missedHazardRate',
  'unsafeConfidenceRate',
  'evidenceCompleteness',
] as const;

export function validatePerceptionBenchmarkCase(value: PerceptionBenchmarkCase): readonly string[] {
  const errors: string[] = [];
  if (value.schema !== EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA) errors.push('UNSUPPORTED_SCHEMA');
  if (!value.scenarioId.trim()) errors.push('MISSING_SCENARIO_ID');
  if (value.environment.stressConditions.length === 0) errors.push('MISSING_STRESS_CONDITION');
  if (value.groundTruth.independentOfSystemUnderTest !== true) errors.push('GROUND_TRUTH_NOT_INDEPENDENT');
  if (!value.groundTruth.evidenceManifestId.trim()) errors.push('MISSING_GROUND_TRUTH_EVIDENCE');
  if (!value.evidenceManifestId.trim()) errors.push('MISSING_RESULT_EVIDENCE');

  for (const key of RATE_METRICS) {
    const metric = value.metrics[key];
    if (!Number.isFinite(metric)) errors.push(`NON_FINITE_METRIC:${key}`);
  }

  if (!Number.isFinite(value.metrics.positionRmseM) || value.metrics.positionRmseM < 0) {
    errors.push('INVALID_POSITION_RMSE');
  }
  if (!Number.isFinite(value.metrics.velocityRmseMps) || value.metrics.velocityRmseMps < 0) {
    errors.push('INVALID_VELOCITY_RMSE');
  }
  if (!Number.isFinite(value.metrics.latencyP95Ms) || value.metrics.latencyP95Ms < 0) {
    errors.push('INVALID_LATENCY');
  }
  if (!Number.isSafeInteger(value.metrics.authorityViolationCount) || value.metrics.authorityViolationCount < 0) {
    errors.push('INVALID_AUTHORITY_VIOLATION_COUNT');
  }

  return errors;
}

/**
 * Protected metrics cannot be averaged away by gains in throughput/latency.
 * Any authority violation or explicit protected invariant violation is a hard regression.
 */
export function comparePerceptionBenchmarks(
  baseline: PerceptionBenchmarkCase,
  candidate: PerceptionBenchmarkCase,
): PerceptionBenchmarkComparison {
  const regressions: string[] = [];
  const improvements: string[] = [];

  if (candidate.metrics.falseHazardAcceptanceRate > baseline.metrics.falseHazardAcceptanceRate) {
    regressions.push('FALSE_HAZARD_ACCEPTANCE');
  } else if (candidate.metrics.falseHazardAcceptanceRate < baseline.metrics.falseHazardAcceptanceRate) {
    improvements.push('FALSE_HAZARD_ACCEPTANCE');
  }

  if (candidate.metrics.missedHazardRate > baseline.metrics.missedHazardRate) {
    regressions.push('MISSED_HAZARD');
  } else if (candidate.metrics.missedHazardRate < baseline.metrics.missedHazardRate) {
    improvements.push('MISSED_HAZARD');
  }

  if (candidate.metrics.unsafeConfidenceRate > baseline.metrics.unsafeConfidenceRate) {
    regressions.push('UNSAFE_CONFIDENCE');
  } else if (candidate.metrics.unsafeConfidenceRate < baseline.metrics.unsafeConfidenceRate) {
    improvements.push('UNSAFE_CONFIDENCE');
  }

  if (candidate.metrics.authorityViolationCount > baseline.metrics.authorityViolationCount) {
    regressions.push('AUTHORITY_VIOLATION');
  }

  if (candidate.protectedInvariantViolations.length > 0) {
    regressions.push('PROTECTED_INVARIANT_VIOLATION');
  }

  return {
    baselineScenarioId: baseline.scenarioId,
    candidateScenarioId: candidate.scenarioId,
    protectedRegression: regressions.length > 0,
    regressions,
    improvements,
  };
}
