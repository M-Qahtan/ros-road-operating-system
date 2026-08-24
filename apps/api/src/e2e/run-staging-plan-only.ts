import { execFile } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  evaluateStagingCloudReview,
  parseStagingCloudReviewPackage,
  verifyStagingCloudPackage,
  verifyTerraformPlanFile
} from '../runtime/staging-cloud-governance.js';
import {
  ROS_STAGING_REGION,
  assertExternalDirectory,
  assertExternalRegularFile,
  executeJson,
  parseAwsProfile,
  parseShortLivedCredentialExport,
  parseStagingPlanOnlyRunnerManifest,
  sanitizedAccountReference,
  sha256File
} from '../runtime/staging-plan-only-runner.js';

const execFileAsync = promisify(execFile);

function profileArgs(profile: string | null): string[] {
  return profile === null ? [] : ['--profile', profile];
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be non-empty text`);
  return value.trim();
}

function accountId(value: unknown): string {
  const source = value as { Account?: unknown };
  const account = text(source.Account, 'sts.Account');
  if (!/^\d{12}$/.test(account)) throw new TypeError('sts.Account must be a 12-digit AWS account ID');
  return account;
}

function regionEnabled(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const regions = (value as { Regions?: unknown }).Regions;
  if (!Array.isArray(regions) || regions.length !== 1) return false;
  const first = regions[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return false;
  const record = first as { RegionName?: unknown; OptInStatus?: unknown };
  return record.RegionName === ROS_STAGING_REGION &&
    (record.OptInStatus === 'opt-in-not-required' || record.OptInStatus === 'opted-in');
}

async function ensureCleanExactGitHead(repoRoot: string, expectedHead: string): Promise<void> {
  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  if (head.trim() !== expectedHead) {
    throw new Error(`repository HEAD ${head.trim()} does not match approved candidate ${expectedHead}`);
  }
  const { stdout: status } = await execFileAsync('git', ['status', '--porcelain=v1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  if (status.trim().length !== 0) throw new Error('repository working tree must be clean before PLAN_ONLY execution');
}

async function runSilent(
  executable: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number },
  label: string
): Promise<void> {
  try {
    await execFileAsync(executable, [...args], {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: options.env
    });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${label} executable is unavailable`);
    throw new Error(`${label} failed; captured command output was suppressed to protect sensitive plan/input data`);
  }
}

async function ensureOutputNamesAvailable(outputDir: string): Promise<{ planPath: string; packagePath: string; decisionPath: string; digestPath: string }> {
  const paths = {
    planPath: join(outputDir, 'ros-staging.tfplan'),
    packagePath: join(outputDir, 'ros-staging-cloud-review.json'),
    decisionPath: join(outputDir, 'ros-staging-cloud-decision.json'),
    digestPath: join(outputDir, 'ros-staging.tfplan.sha256')
  };
  for (const path of Object.values(paths)) {
    try {
      await lstat(path);
      throw new Error(`refusing to overwrite existing PLAN_ONLY output: ${path}`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return paths;
}

async function main(): Promise<void> {
  const manifestInput = process.argv[2];
  const evidenceRootInput = process.argv[3];
  const tfvarsInput = process.argv[4];
  const outputDirInput = process.argv[5];
  const profile = parseAwsProfile(process.argv[6]);
  if (!manifestInput || !evidenceRootInput || !tfvarsInput || !outputDirInput) {
    throw new TypeError(
      'Usage: node dist/e2e/run-staging-plan-only.js <runner-manifest.json> <evidence-root> <tfvars-file> <secure-output-dir> [aws-profile]'
    );
  }

  const repoRoot = process.cwd();
  const manifestPath = await assertExternalRegularFile(repoRoot, manifestInput, 'runner manifest');
  const evidenceRoot = await assertExternalDirectory(repoRoot, evidenceRootInput, 'evidence root');
  const tfvarsPath = await assertExternalRegularFile(repoRoot, tfvarsInput, 'Terraform variable file');
  const outputDir = await assertExternalDirectory(repoRoot, outputDirInput, 'secure output directory');
  const outputs = await ensureOutputNamesAvailable(outputDir);

  const rawManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  const runnerManifest = parseStagingPlanOnlyRunnerManifest(rawManifest);
  await ensureCleanExactGitHead(repoRoot, runnerManifest.expectedCandidateHeadSha);

  const credentialExport = await executeJson(
    'aws',
    [...profileArgs(profile), 'configure', 'export-credentials', '--format', 'process'],
    { timeoutMs: 60_000 }
  );
  const temporaryCredentials = parseShortLivedCredentialExport(credentialExport);
  const temporaryAwsEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: temporaryCredentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: temporaryCredentials.secretAccessKey,
    AWS_SESSION_TOKEN: temporaryCredentials.sessionToken,
    AWS_REGION: ROS_STAGING_REGION,
    AWS_DEFAULT_REGION: ROS_STAGING_REGION,
    AWS_EC2_METADATA_DISABLED: 'true'
  };
  delete temporaryAwsEnv.AWS_PROFILE;
  delete temporaryAwsEnv.AWS_DEFAULT_PROFILE;

  // All account/region checks and Terraform planning use the exact temporary
  // credential export validated above. The profile is not consulted again.
  const stsIdentity = await executeJson(
    'aws',
    ['sts', 'get-caller-identity', '--region', ROS_STAGING_REGION, '--output', 'json'],
    { timeoutMs: 60_000, env: temporaryAwsEnv }
  );
  const account = accountId(stsIdentity);
  const regionState = await executeJson(
    'aws',
    ['ec2', 'describe-regions', '--region', ROS_STAGING_REGION, '--region-names', ROS_STAGING_REGION, '--all-regions', '--output', 'json'],
    { timeoutMs: 60_000, env: temporaryAwsEnv }
  );
  if (!regionEnabled(regionState)) throw new Error(`${ROS_STAGING_REGION} is not enabled for the authenticated AWS account`);

  const workParent = await mkdtemp(join(tmpdir(), 'ros-staging-plan-only-'));
  const workDir = join(workParent, 'aws');
  const sourceIac = resolve(repoRoot, 'infrastructure/staging/aws');
  try {
    // Copy into an isolated disposable workspace so init never mutates the Git checkout.
    await cp(sourceIac, workDir, { recursive: true, force: false, errorOnExist: true });

    await runSilent(
      'terraform',
      ['-chdir=' + workDir, 'init', '-backend=false', '-input=false', '-lockfile=readonly', '-no-color'],
      { env: temporaryAwsEnv, timeoutMs: 180_000 },
      'Terraform init'
    );
    await runSilent(
      'terraform',
      [
        '-chdir=' + workDir,
        'plan',
        '-input=false',
        '-lock-timeout=60s',
        '-no-color',
        '-out=' + outputs.planPath,
        '-var-file=' + tfvarsPath
      ],
      { env: temporaryAwsEnv, timeoutMs: 300_000 },
      'Terraform plan'
    );

    const verifiedPlan = await verifyTerraformPlanFile(outputs.planPath);
    const evidenceFiles = [];
    for (const input of runnerManifest.evidenceFiles) {
      const fullPath = resolve(evidenceRoot, input.path);
      const suffix = fullPath.slice(evidenceRoot.length);
      if (!(fullPath === evidenceRoot || suffix.startsWith('/') || suffix.startsWith('\\'))) {
        throw new Error(`evidence path escapes evidence root: ${input.path}`);
      }
      const digest = await sha256File(fullPath);
      evidenceFiles.push({ kind: input.kind, path: input.path, sha256: digest.sha256, sizeBytes: digest.sizeBytes });
    }

    const reviewPackage = parseStagingCloudReviewPackage({
      schema: 'ros-staging-cloud-review/v1',
      candidateHeadSha: runnerManifest.expectedCandidateHeadSha,
      environment: 'STAGING',
      cloudAccountReference: sanitizedAccountReference(account),
      cloudRegion: ROS_STAGING_REGION,
      generatedAt: new Date().toISOString(),
      claims: runnerManifest.claims,
      evidenceFiles
    });
    const verification = await verifyStagingCloudPackage(
      reviewPackage,
      evidenceRoot,
      runnerManifest.expectedCandidateHeadSha,
      verifiedPlan
    );
    const decision = evaluateStagingCloudReview(reviewPackage, verification);

    await writeFile(outputs.packagePath, `${JSON.stringify(reviewPackage, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(outputs.decisionPath, `${JSON.stringify(decision, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(outputs.digestPath, `${verifiedPlan.terraformPlanSha256}  ros-staging.tfplan\n`, { encoding: 'utf8', flag: 'wx' });

    process.stdout.write(`${JSON.stringify({
      status: decision.status,
      candidateHeadSha: runnerManifest.expectedCandidateHeadSha,
      cloudAccountReference: reviewPackage.cloudAccountReference,
      cloudRegion: ROS_STAGING_REGION,
      terraformPlanSha256: verifiedPlan.terraformPlanSha256,
      terraformPlanAnalysis: verifiedPlan.terraformPlanAnalysis,
      blockingReasons: decision.blockingReasons,
      terraformApplyAuthorized: false,
      deploymentAuthorized: false,
      publicRoadAuthorized: false,
      externalIntegrationAuthorized: false
    })}\n`);
    if (decision.status !== 'STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW') process.exitCode = 2;
  } finally {
    await rm(workParent, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`staging PLAN_ONLY runner failed: ${message}\n`);
  process.exitCode = 1;
});
