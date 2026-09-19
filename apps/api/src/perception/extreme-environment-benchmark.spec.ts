import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
  type PerceptionBenchmarkCase,
  type PerceptionBenchmarkMetrics,
} from '@ros/contracts';
import { evaluateExtremeEnvironmentCandidate } from './extreme-environment-benchmark.js';

function metrics(overrides: Partial<PerceptionBenchmarkMetrics> = {}): PerceptionBenchmarkMetrics {
  return {
    detectionPrecision: 0.9,
    detectionRecall: 0.85,
    positionRmseM: 0.5,
    velocityRmseMps: 0.4,
    trackContinuity: 0.86,
    falseTrackRate: 0.03,
    latencyP95Ms: 100,
    confidenceCalibrationError: 0.05,
    falseHazardAcceptanceRate: 0.02,
    missedHazardRate: 0.04,
    unsafeConfidenceRate: 0.02,
    authorityViolationCount: 0,
    evidenceCompleteness: 0.93,
    ...overrides,
  };
}

function benchmark(
  scenarioId: string,
  stack: PerceptionBenchmarkCase['stack'],
  metricOverrides: Partial<PerceptionBenchmarkMetrics> = {},
  odd: Readonly<Record<string, unknown>> = { visibilityClass: 'severe', roadType: 'urban-arterial' },
): PerceptionBenchmarkCase {
  return {
    schema: EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
    scenarioId,
    stack,
    environment: {
      stressConditions: ['SANDSTORM', 'DIRECT_SUN_GLARE'],
      odd,
    },
    groundTruth: {
      source: 'independent-instrumented-test-rig',
      independentOfSystemUnderTest: true,
      evidenceManifestId: 'GT-RUH-SAND-001',
    },
    metrics: metrics(metricOverrides),
    protectedInvariantViolations: [],
    evidenceManifestId: `EVM-${scenarioId}`,
  };
}

test('latency and recall gains cannot compensate for worse missed-hazard safety', () => {
  const baseline = benchmark('rgb-baseline', 'RGB_ONLY');
  const candidate = benchmark('fusion-fast', 'ASSURED_FUSION_CPAL_CRS', {
    detectionRecall: 0.95,
    latencyP95Ms: 55,
    missedHazardRate: 0.07,
  });

  const result = evaluateExtremeEnvironmentCandidate(baseline, candidate);
  assert.equal(result.decision, 'REJECTED_PROTECTED_REGRESSION');
  assert(result.reasonCodes.includes('MISSED_HAZARD'));
  assert.equal(result.descriptiveDeltas.latencyP95Ms, -45);
});

test('candidate with no protected regression becomes eligible for performance review, not auto-approved', () => {
  const baseline = benchmark('rgb-baseline', 'RGB_ONLY');
  const candidate = benchmark('assured-fusion', 'ASSURED_FUSION_CPAL_CRS', {
    detectionRecall: 0.94,
    missedHazardRate: 0.02,
    falseHazardAcceptanceRate: 0.01,
    unsafeConfidenceRate: 0.01,
    latencyP95Ms: 85,
  });

  const result = evaluateExtremeEnvironmentCandidate(baseline, candidate);
  assert.equal(result.decision, 'ELIGIBLE_FOR_PERFORMANCE_REVIEW');
  assert.equal(result.comparison?.protectedRegression, false);
  assert.equal(result.authority, 'NONE');
});

test('candidate authority violation is rejected even when all perception metrics improve', () => {
  const baseline = benchmark('rgb-baseline', 'RGB_ONLY');
  const candidate = benchmark('unsafe-fusion', 'ASSURED_FUSION_CPAL_CRS', {
    detectionPrecision: 0.99,
    detectionRecall: 0.99,
    latencyP95Ms: 40,
    falseHazardAcceptanceRate: 0.005,
    missedHazardRate: 0.005,
    unsafeConfidenceRate: 0.005,
    authorityViolationCount: 1,
  });

  const result = evaluateExtremeEnvironmentCandidate(baseline, candidate);
  assert.equal(result.decision, 'REJECTED_PROTECTED_REGRESSION');
  assert(result.reasonCodes.includes('AUTHORITY_VIOLATION'));
});

test('different ODD cannot be presented as a direct performance comparison', () => {
  const baseline = benchmark('rgb-baseline', 'RGB_ONLY');
  const candidate = benchmark(
    'fusion-other-odd',
    'ASSURED_FUSION_CPAL_CRS',
    {},
    { visibilityClass: 'normal', roadType: 'tunnel' },
  );

  const result = evaluateExtremeEnvironmentCandidate(baseline, candidate);
  assert.equal(result.decision, 'INVALID_COMPARISON');
  assert(result.reasonCodes.includes('ODD_MISMATCH'));
  assert.equal(result.comparison, null);
});
