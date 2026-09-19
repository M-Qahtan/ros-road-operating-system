import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
  comparePerceptionBenchmarks,
  validatePerceptionBenchmarkCase,
  type PerceptionBenchmarkCase,
} from './perception-benchmark.js';

function benchmark(
  scenarioId: string,
  overrides: Partial<PerceptionBenchmarkCase['metrics']> = {},
  protectedInvariantViolations: readonly string[] = [],
): PerceptionBenchmarkCase {
  return {
    schema: EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
    scenarioId,
    stack: 'ASSURED_FUSION_CPAL_CRS',
    environment: { stressConditions: ['SANDSTORM'], odd: { visibilityClass: 'severe' } },
    groundTruth: {
      source: 'independent-test-rig',
      independentOfSystemUnderTest: true,
      evidenceManifestId: 'GT-001',
    },
    metrics: {
      detectionPrecision: 0.9,
      detectionRecall: 0.9,
      positionRmseM: 0.4,
      velocityRmseMps: 0.3,
      trackContinuity: 0.88,
      falseTrackRate: 0.03,
      latencyP95Ms: 80,
      confidenceCalibrationError: 0.05,
      falseHazardAcceptanceRate: 0.01,
      missedHazardRate: 0.02,
      unsafeConfidenceRate: 0.01,
      authorityViolationCount: 0,
      evidenceCompleteness: 0.96,
      ...overrides,
    },
    protectedInvariantViolations,
    evidenceManifestId: `EVM-${scenarioId}`,
  };
}

test('unit interval metrics reject values outside 0..1', () => {
  const errors = validatePerceptionBenchmarkCase(benchmark('invalid-rate', { falseTrackRate: 1.2 }));
  assert(errors.includes('INVALID_UNIT_INTERVAL_METRIC:falseTrackRate'));
});

test('any candidate authority violation is a protected regression even if baseline is worse', () => {
  const comparison = comparePerceptionBenchmarks(
    benchmark('baseline', { authorityViolationCount: 5 }),
    benchmark('candidate', { authorityViolationCount: 1 }),
  );

  assert.equal(comparison.protectedRegression, true);
  assert(comparison.regressions.includes('AUTHORITY_VIOLATION'));
});

test('eliminating baseline authority violations is recorded as an improvement', () => {
  const comparison = comparePerceptionBenchmarks(
    benchmark('baseline', { authorityViolationCount: 2 }),
    benchmark('candidate', { authorityViolationCount: 0 }),
  );

  assert.equal(comparison.protectedRegression, false);
  assert(comparison.improvements.includes('AUTHORITY_VIOLATION_ELIMINATED'));
});

test('explicit protected invariant violation always blocks the candidate', () => {
  const comparison = comparePerceptionBenchmarks(
    benchmark('baseline'),
    benchmark('candidate', {}, ['KNOWLEDGE_BECAME_AUTHORITY']),
  );

  assert.equal(comparison.protectedRegression, true);
  assert(comparison.regressions.includes('PROTECTED_INVARIANT_VIOLATION'));
});
