import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateStagingCloudReview,
  parseStagingCloudReviewPackage,
  verifyStagingCloudPackage,
  verifyTerraformPlanFile
} from '../runtime/staging-cloud-governance.js';

async function main(): Promise<void> {
  const packagePath = process.argv[2];
  const evidenceRoot = process.argv[3];
  const expectedCandidateHeadSha = process.argv[4];
  const terraformPlanPath = process.argv[5];
  if (
    packagePath === undefined || packagePath.trim().length === 0 ||
    evidenceRoot === undefined || evidenceRoot.trim().length === 0 ||
    expectedCandidateHeadSha === undefined || expectedCandidateHeadSha.trim().length === 0 ||
    terraformPlanPath === undefined || terraformPlanPath.trim().length === 0
  ) {
    throw new TypeError(
      'Usage: node dist/e2e/run-staging-cloud-review.js <package.json> <evidence-root> <expected-candidate-head-sha> <terraform-plan-file>'
    );
  }

  const source = await readFile(resolve(process.cwd(), packagePath), 'utf8');
  const parsed: unknown = JSON.parse(source);
  const reviewPackage = parseStagingCloudReviewPackage(parsed);

  // `terraform show -json` is executed in-memory against the exact plan file.
  // Raw show JSON is never written or emitted because it can expose sensitive values.
  const verifiedPlan = await verifyTerraformPlanFile(terraformPlanPath);
  const verification = await verifyStagingCloudPackage(
    reviewPackage,
    evidenceRoot,
    expectedCandidateHeadSha,
    verifiedPlan
  );
  const decision = evaluateStagingCloudReview(reviewPackage, verification);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (decision.status !== 'STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW') process.exitCode = 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`staging cloud review failed: ${message}\n`);
  process.exitCode = 1;
});
