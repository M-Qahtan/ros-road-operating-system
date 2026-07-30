import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  NodeSafetyFusionFingerprint,
  evaluateSafetyFusion
} from './safety-fusion.js';
import {
  buildSafetyFusionEvidencePackage,
  evaluateSafetyFusionFixtures
} from './safety-fusion-evaluation.js';
import { SAFETY_FUSION_SYNTHETIC_FIXTURES } from './safety-fusion-fixtures.js';

const fingerprint = new NodeSafetyFusionFingerprint();

async function runEvaluation() {
  return evaluateSafetyFusionFixtures(SAFETY_FUSION_SYNTHETIC_FIXTURES, async (fixture) =>
    evaluateSafetyFusion(
      fixture.input,
      fixture.evaluatedAt,
      fixture.guardResults,
      ACTIVE_SAFETY_FUSION_RULE_SET,
      fingerprint
    )
  );
}

test('synthetic false-negative-focused suite passes with deterministic outputs', async () => {
  const evaluation = await runEvaluation();
  assert.equal(evaluation.metrics.fixtureCount, SAFETY_FUSION_SYNTHETIC_FIXTURES.length);
  assert.equal(evaluation.metrics.weightedFalseNegativeScore, 0);
  assert.equal(evaluation.metrics.underTriageCount, 0);
  assert.equal(evaluation.metrics.missedHumanReviewCount, 0);
  assert.equal(evaluation.metrics.deterministicMismatchCount, 0);
  assert.equal(evaluation.metrics.passed, true);
  assert.equal(evaluation.results.every((result) => result.deterministic), true);
});

test('evidence package binds fixtures and results to candidate base merge run and attempt', async () => {
  const evaluation = await runEvaluation();
  const evidence = await buildSafetyFusionEvidencePackage({
    fixtures: SAFETY_FUSION_SYNTHETIC_FIXTURES,
    metrics: evaluation.metrics,
    results: evaluation.results,
    candidateHeadSha: '1111111111111111111111111111111111111111',
    candidateBaseSha: '2222222222222222222222222222222222222222',
    testedMergeSha: '3333333333333333333333333333333333333333',
    runId: '123456',
    runAttempt: 2,
    generatedAt: '2026-07-31T00:05:00.000Z',
    fingerprint
  });
  assert.equal(evidence.metrics.passed, true);
  assert.equal(evidence.candidateHeadSha, '1111111111111111111111111111111111111111');
  assert.equal(evidence.runAttempt, 2);
  assert.match(evidence.fixtureDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.resultsDigest, /^sha256:[a-f0-9]{64}$/);
});

test('failed metrics and malformed SHA cannot produce release evidence', async () => {
  const evaluation = await runEvaluation();
  await assert.rejects(() => buildSafetyFusionEvidencePackage({
    fixtures: SAFETY_FUSION_SYNTHETIC_FIXTURES,
    metrics: { ...evaluation.metrics, passed: false, underTriageCount: 1 },
    results: evaluation.results,
    candidateHeadSha: '1111111111111111111111111111111111111111',
    candidateBaseSha: '2222222222222222222222222222222222222222',
    testedMergeSha: '3333333333333333333333333333333333333333',
    runId: '123456',
    runAttempt: 1,
    generatedAt: '2026-07-31T00:05:00.000Z',
    fingerprint
  }), /failed evaluation/);

  await assert.rejects(() => buildSafetyFusionEvidencePackage({
    fixtures: SAFETY_FUSION_SYNTHETIC_FIXTURES,
    metrics: evaluation.metrics,
    results: evaluation.results,
    candidateHeadSha: 'not-a-sha',
    candidateBaseSha: '2222222222222222222222222222222222222222',
    testedMergeSha: '3333333333333333333333333333333333333333',
    runId: '123456',
    runAttempt: 1,
    generatedAt: '2026-07-31T00:05:00.000Z',
    fingerprint
  }), /SHAs/);
});
