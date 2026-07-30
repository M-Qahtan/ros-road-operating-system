import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  NodeSafetyFusionFingerprint,
  evaluateSafetyFusion
} from '../ros-eye/safety-fusion.js';
import {
  buildSafetyFusionEvidencePackage,
  evaluateSafetyFusionFixtures
} from '../ros-eye/safety-fusion-evaluation.js';
import { SAFETY_FUSION_SYNTHETIC_FIXTURES } from '../ros-eye/safety-fusion-fixtures.js';

const candidateHeadSha = requiredEnvironment('CANDIDATE_HEAD_SHA');
const candidateBaseSha = requiredEnvironment('CANDIDATE_BASE_SHA');
const testedMergeSha = requiredEnvironment('TESTED_MERGE_SHA');
const runId = requiredEnvironment('GITHUB_RUN_ID');
const runAttempt = Number(requiredEnvironment('GITHUB_RUN_ATTEMPT'));
const generatedAt = process.env.EVIDENCE_GENERATED_AT ?? new Date().toISOString();
const fingerprint = new NodeSafetyFusionFingerprint();

const evaluation = await evaluateSafetyFusionFixtures(
  SAFETY_FUSION_SYNTHETIC_FIXTURES,
  async (fixture) => evaluateSafetyFusion(
    fixture.input,
    fixture.evaluatedAt,
    fixture.guardResults,
    ACTIVE_SAFETY_FUSION_RULE_SET,
    fingerprint
  )
);

if (!evaluation.metrics.passed) {
  throw new Error(`safety fusion evaluation failed: ${JSON.stringify(evaluation.metrics)}`);
}

const evidence = await buildSafetyFusionEvidencePackage({
  fixtures: SAFETY_FUSION_SYNTHETIC_FIXTURES,
  metrics: evaluation.metrics,
  results: evaluation.results,
  candidateHeadSha,
  candidateBaseSha,
  testedMergeSha,
  runId,
  runAttempt,
  generatedAt,
  fingerprint
});

const outputDirectory = resolve('artifacts/ros-eye');
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, 'safety-fusion-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDirectory, 'safety-fusion-metrics.json'), `${JSON.stringify(evaluation.metrics, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: 'passed',
  candidateHeadSha,
  candidateBaseSha,
  testedMergeSha,
  runId,
  runAttempt,
  metrics: evaluation.metrics,
  evidencePath: 'artifacts/ros-eye/safety-fusion-evidence.json'
}));

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} must be set`);
  return value;
}
