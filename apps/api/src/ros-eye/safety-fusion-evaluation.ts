import {
  SAFETY_FUSION_POLICY_VERSION,
  SAFETY_FUSION_REGISTRY_SCHEMA_VERSION,
  type SafetyFusionEvaluationFixture,
  type SafetyFusionEvaluationMetrics,
  type SafetyFusionFingerprintPort,
  type SafetyFusionRecommendation
} from '@ros/contracts';
import { safetyFusionSeverityRank } from './safety-fusion.js';

export const SAFETY_FUSION_EVIDENCE_SCHEMA_VERSION = 'ros-eye.safety-fusion.evidence.v1' as const;

export interface SafetyFusionFixtureResult {
  readonly fixtureId: string;
  readonly expectedMinimumSeverity: SafetyFusionEvaluationFixture['expectedMinimumSeverity'];
  readonly actualSeverity: SafetyFusionRecommendation['recommendedSeverity'];
  readonly expectedHumanReview: boolean;
  readonly actualHumanReview: boolean;
  readonly safetyWeight: number;
  readonly fingerprint: string;
  readonly deterministic: boolean;
  readonly underTriaged: boolean;
  readonly missedHumanReview: boolean;
}

export interface SafetyFusionEvidencePackage {
  readonly schemaVersion: typeof SAFETY_FUSION_EVIDENCE_SCHEMA_VERSION;
  readonly registrySchemaVersion: typeof SAFETY_FUSION_REGISTRY_SCHEMA_VERSION;
  readonly policyVersion: typeof SAFETY_FUSION_POLICY_VERSION;
  readonly candidateHeadSha: string;
  readonly candidateBaseSha: string;
  readonly testedMergeSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly generatedAt: string;
  readonly fixtureDigest: string;
  readonly resultsDigest: string;
  readonly metrics: SafetyFusionEvaluationMetrics;
  readonly results: readonly SafetyFusionFixtureResult[];
}

export async function evaluateSafetyFusionFixtures(
  fixtures: readonly SafetyFusionEvaluationFixture[],
  evaluator: (fixture: SafetyFusionEvaluationFixture) => Promise<SafetyFusionRecommendation>
): Promise<{ readonly metrics: SafetyFusionEvaluationMetrics; readonly results: readonly SafetyFusionFixtureResult[] }> {
  const results: SafetyFusionFixtureResult[] = [];
  let weightedFalseNegativeScore = 0;
  let underTriageCount = 0;
  let missedHumanReviewCount = 0;
  let deterministicMismatchCount = 0;

  for (const fixture of [...fixtures].sort((a, b) => a.fixtureId.localeCompare(b.fixtureId))) {
    const first = await evaluator(fixture);
    const second = await evaluator(fixture);
    const expectedRank = safetyFusionSeverityRank(fixture.expectedMinimumSeverity);
    const actualRank = safetyFusionSeverityRank(first.recommendedSeverity);
    const underTriaged = actualRank < expectedRank;
    const missedHumanReview = fixture.expectedHumanReview && !first.requiresHumanReview;
    const deterministic = first.deterministicFingerprint === second.deterministicFingerprint
      && JSON.stringify(first) === JSON.stringify(second);

    if (underTriaged) {
      underTriageCount += 1;
      weightedFalseNegativeScore += fixture.safetyWeight * (expectedRank - actualRank);
    }
    if (missedHumanReview) missedHumanReviewCount += 1;
    if (!deterministic) deterministicMismatchCount += 1;

    results.push(Object.freeze({
      fixtureId: fixture.fixtureId,
      expectedMinimumSeverity: fixture.expectedMinimumSeverity,
      actualSeverity: first.recommendedSeverity,
      expectedHumanReview: fixture.expectedHumanReview,
      actualHumanReview: first.requiresHumanReview,
      safetyWeight: fixture.safetyWeight,
      fingerprint: first.deterministicFingerprint,
      deterministic,
      underTriaged,
      missedHumanReview
    }));
  }

  const metrics: SafetyFusionEvaluationMetrics = Object.freeze({
    fixtureCount: fixtures.length,
    weightedFalseNegativeScore,
    underTriageCount,
    missedHumanReviewCount,
    deterministicMismatchCount,
    passed: weightedFalseNegativeScore === 0
      && underTriageCount === 0
      && missedHumanReviewCount === 0
      && deterministicMismatchCount === 0
  });

  return Object.freeze({ metrics, results: Object.freeze(results) });
}

export async function buildSafetyFusionEvidencePackage(input: {
  readonly fixtures: readonly SafetyFusionEvaluationFixture[];
  readonly metrics: SafetyFusionEvaluationMetrics;
  readonly results: readonly SafetyFusionFixtureResult[];
  readonly candidateHeadSha: string;
  readonly candidateBaseSha: string;
  readonly testedMergeSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly generatedAt: string;
  readonly fingerprint: SafetyFusionFingerprintPort;
}): Promise<SafetyFusionEvidencePackage> {
  if (!validSha(input.candidateHeadSha) || !validSha(input.candidateBaseSha) || !validSha(input.testedMergeSha)) throw new Error('candidate and tested SHAs must be 40 lowercase hexadecimal characters');
  if (!/^[1-9][0-9]*$/.test(input.runId) || !Number.isInteger(input.runAttempt) || input.runAttempt < 1) throw new Error('run identity is invalid');
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('generatedAt is invalid');
  if (!input.metrics.passed) throw new Error('safety fusion evidence cannot be emitted for a failed evaluation');

  const fixtureDigest = await input.fingerprint.digest(stableStringify(input.fixtures));
  const resultsDigest = await input.fingerprint.digest(stableStringify(input.results));
  return Object.freeze({
    schemaVersion: SAFETY_FUSION_EVIDENCE_SCHEMA_VERSION,
    registrySchemaVersion: SAFETY_FUSION_REGISTRY_SCHEMA_VERSION,
    policyVersion: SAFETY_FUSION_POLICY_VERSION,
    candidateHeadSha: input.candidateHeadSha,
    candidateBaseSha: input.candidateBaseSha,
    testedMergeSha: input.testedMergeSha,
    runId: input.runId,
    runAttempt: input.runAttempt,
    generatedAt: input.generatedAt,
    fixtureDigest,
    resultsDigest,
    metrics: input.metrics,
    results: Object.freeze([...input.results])
  });
}

function validSha(value: string): boolean { return /^[a-f0-9]{40}$/.test(value); }

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
