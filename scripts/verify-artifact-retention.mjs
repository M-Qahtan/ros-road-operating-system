import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARCHIVABLE_WORKFLOWS, MINIMUM_RETENTION_DAYS } from './lib/external-evidence.mjs';

const workflowDirectory = '.github/workflows';
const archiveWorkflowName = 'archive-ci-evidence.yml';
const transitRetentionDays = 90;
const workflowNames = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const archiveSource = await readFile(join(workflowDirectory, archiveWorkflowName), 'utf8');
const receiptSchema = JSON.parse(
  await readFile('docs/10-engineering/external-evidence-receipt-schema.json', 'utf8')
);
const runbook = await readFile('docs/10-engineering/external-evidence-store-runbook.md', 'utf8');
const gitignore = await readFile('.gitignore', 'utf8');
const requiredChecks = (await readFile('docs/10-engineering/required-checks.txt', 'utf8'))
  .split(/\r?\n/u)
  .filter(Boolean);

if (receiptSchema?.properties?.schema?.const !== 'ros-external-evidence/v1'
    || receiptSchema?.properties?.archive?.properties?.object_lock_mode?.const !== 'COMPLIANCE'
    || receiptSchema?.properties?.archive?.properties?.minimum_retention_days?.minimum !== MINIMUM_RETENTION_DAYS) {
  throw new Error('external evidence receipt schema does not enforce the approved lock and retention contract');
}
if (!runbook.includes('## REL-013 live acceptance record') || !runbook.includes('independent')) {
  throw new Error('external evidence runbook is missing live or independent acceptance controls');
}
for (const check of [
  'verify',
  'terraform-evidence',
  'postgres-integration',
  'staging-smoke',
  'riyadh-e2e',
  'dependency-review',
  'repository-security',
  'riyadh-failure-modes',
  'operational-readiness'
]) {
  if (!requiredChecks.includes(check)) {
    throw new Error(`canonical main ruleset is missing required check: ${check}`);
  }
}
for (const ignored of ['**/.terraform/*', '*.tfstate', '*.tfvars', '*.tfplan', 'backend.hcl']) {
  if (!gitignore.split(/\r?\n/u).includes(ignored)) {
    throw new Error(`Terraform sensitive/generated file pattern is not ignored: ${ignored}`);
  }
}

if (/pull_request_target\s*:/u.test(archiveSource)) {
  throw new Error('archive workflow must never use pull_request_target');
}
if (!/^\s*workflow_run:\s*$/mu.test(archiveSource)) {
  throw new Error('archive workflow is not isolated behind workflow_run');
}
if (!/^\s*actions:\s*read\s*$/mu.test(archiveSource)
    || !/^\s*contents:\s*read\s*$/mu.test(archiveSource)
    || !/^\s*id-token:\s*write\s*$/mu.test(archiveSource)) {
  throw new Error('archive workflow permissions are incomplete');
}
if (!/uses:\s*aws-actions\/configure-aws-credentials@[0-9a-f]{40}/u.test(archiveSource)) {
  throw new Error('AWS credential action is not pinned to a full commit SHA');
}
if (!/ref:\s*main\s*$/mu.test(archiveSource) || /workflow_run\.head_sha/u.test(archiveSource)) {
  throw new Error('archive workflow must check out trusted main, never source-run code');
}
if (!/node scripts\/archive-github-evidence\.mjs/u.test(archiveSource)) {
  throw new Error('archive workflow does not execute the verified ROS archiver');
}
for (const workflow of ARCHIVABLE_WORKFLOWS) {
  if (!archiveSource.includes(`      - ${workflow}\n`)) {
    throw new Error(`archive workflow does not subscribe to ${workflow}`);
  }
}

let uploadCount = 0;
for (const name of workflowNames) {
  if (name === archiveWorkflowName) continue;
  const source = await readFile(join(workflowDirectory, name), 'utf8');
  const lines = source.split(/\r?\n/u);
  const workflowName = /^name:\s*(.+)$/mu.exec(source)?.[1]?.trim();

  if (source.includes('verify-uploaded-artifact-retention.mjs')) {
    throw new Error(`${name} still treats public GitHub retention as the 365-day archive`);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!(lines[index] ?? '').includes('uses: actions/upload-artifact@')) continue;
    uploadCount += 1;
    const block = lines.slice(Math.max(0, index - 3), index + 22).join('\n');
    if (!/id:\s*upload-evidence/u.test(block)) {
      throw new Error(`${name}:${index + 1} upload-artifact has no stable artifact ID`);
    }
    const match = /retention-days:\s*(\d+)/u.exec(block);
    if (match === null) throw new Error(`${name}:${index + 1} transit artifact is missing retention-days`);
    const days = Number(match[1]);
    if (days !== transitRetentionDays) {
      throw new Error(`${name}:${index + 1} transit retention must be ${transitRetentionDays} days, received ${days}`);
    }
    if (!workflowName || !ARCHIVABLE_WORKFLOWS.includes(workflowName)) {
      throw new Error(`${name}:${index + 1} uploads evidence but is absent from the trusted archive allowlist`);
    }
  }
}

if (uploadCount === 0) throw new Error('No CI evidence uploads were found');

const terraformDirectory = 'infrastructure/evidence-store/aws';
const terraformFiles = (await readdir(terraformDirectory)).filter((name) => name.endsWith('.tf')).sort();
const terraformSource = (
  await Promise.all(terraformFiles.map((name) => readFile(join(terraformDirectory, name), 'utf8')))
).join('\n');
const terraformExample = await readFile(join(terraformDirectory, 'terraform.tfvars.example'), 'utf8');
const backendExample = await readFile(join(terraformDirectory, 'backend.hcl.example'), 'utf8');
const dependencyLock = await readFile(join(terraformDirectory, '.terraform.lock.hcl'), 'utf8');
const ciSource = await readFile(join(workflowDirectory, 'ci.yml'), 'utf8');
if (!/aws_region\s*=\s*"me-central-1"/u.test(terraformExample)
    || !/expected_aws_account_id\s*=\s*"[0-9]{12}"/u.test(terraformExample)
    || !/retention_days\s*=\s*365/u.test(terraformExample)) {
  throw new Error('Terraform example does not preserve the approved account/Riyadh/365-day defaults');
}
if (!/backend\s+"s3"/u.test(terraformSource)
    || !/encrypt\s*=\s*true/u.test(backendExample)
    || !/use_lockfile\s*=\s*true/u.test(backendExample)
    || !/kms_key_id\s*=/u.test(backendExample)
    || !/allowed_account_ids\s*=\s*\["[0-9]{12}"\]/u.test(backendExample)) {
  throw new Error('Terraform remote state is not configured for encrypted S3 locking');
}
if (!/required_version\s*=\s*"= 1\.15\.8"/u.test(terraformSource)
    || !/allowed_account_ids\s*=\s*\[var\.expected_aws_account_id\]/u.test(terraformSource)) {
  throw new Error('Terraform execution is not pinned to the approved CLI and AWS account');
}
const providerHashes = dependencyLock.match(/^\s*"(?:h1|zh):[^\n]+"/gmu) ?? [];
const platformHashes = dependencyLock.match(/^\s*"h1:[^\n]+"/gmu) ?? [];
if (!/provider\s+"registry\.terraform\.io\/hashicorp\/aws"/u.test(dependencyLock)
    || !/version\s*=\s*"6\.57\.1"/u.test(dependencyLock)
    || !/constraints\s*=\s*"~> 6\.0"/u.test(dependencyLock)
    || platformHashes.length !== 2
    || providerHashes.length < 18) {
  throw new Error('Terraform dependency lock does not preserve the reviewed Linux/Windows AWS provider selection');
}
if (!/terraform_version:\s*1\.15\.8/u.test(ciSource)
    || !/terraform\s+-chdir=infrastructure\/evidence-store\/aws\s+init[^\n]*-lockfile=readonly/u.test(ciSource)) {
  throw new Error('Terraform CI does not enforce the reviewed CLI and read-only dependency lock');
}

const complianceModeCount = (terraformSource.match(/mode\s*=\s*"COMPLIANCE"/gu) ?? []).length;
const preventDestroyCount = (terraformSource.match(/prevent_destroy\s*=\s*true/gu) ?? []).length;
for (const [label, pattern] of [
  ['S3 Object Lock', /object_lock_enabled\s*=\s*true/u],
  ['365-day minimum validation', /var\.retention_days\s*>=\s*365/u],
  ['KMS encryption', /sse_algorithm\s*=\s*"aws:kms"/u],
  ['KMS rotation', /enable_key_rotation\s*=\s*true/u],
  ['CloudTrail validation', /enable_log_file_validation\s*=\s*true/u],
  ['immutable repository ID OIDC condition', /token\.actions\.githubusercontent\.com:repository_id/u],
  ['immutable owner ID OIDC condition', /token\.actions\.githubusercontent\.com:repository_owner_id/u],
  ['workflow OIDC condition', /token\.actions\.githubusercontent\.com:workflow/u],
  ['append-only evidence prefix', /evidence\/github\/\$\{var\.repository_id\}/u],
  ['object retention permission', /"s3:PutObjectRetention"/u],
  ['minimum-retention bucket denial', /s3:object-lock-remaining-retention-days/u]
]) {
  if (!pattern.test(terraformSource)) throw new Error(`external evidence Terraform is missing ${label}`);
}
if (complianceModeCount < 2) throw new Error('both evidence and audit buckets must use COMPLIANCE retention');
if (preventDestroyCount < 3) throw new Error('evidence buckets and KMS key must be protected from Terraform destroy');
if (/token\.actions\.githubusercontent\.com:job_workflow_ref/u.test(terraformSource)) {
  throw new Error('non-reusable archive workflow cannot require the reusable-only job_workflow_ref OIDC claim');
}
if (/data\s+"tls_certificate"|thumbprint_list/u.test(terraformSource)) {
  throw new Error('GitHub OIDC must use AWS trusted-CA retrieval instead of a rotating certificate thumbprint');
}

const archivePolicyStart = terraformSource.indexOf('data "aws_iam_policy_document" "archive"');
if (archivePolicyStart < 0) throw new Error('append-only archive IAM policy is missing');
const archivePolicy = terraformSource.slice(archivePolicyStart);
if (/s3:(DeleteObject|DeleteObjectVersion|BypassGovernanceRetention)/u.test(archivePolicy)) {
  throw new Error('GitHub archive role contains destructive or retention-bypass permissions');
}
if (!/actions\s*=\s*\[[\s\S]*?"s3:PutObjectRetention"[\s\S]*?\]/u.test(archivePolicy)) {
  throw new Error('GitHub archive role cannot apply the explicit Object Lock retention required by PutObject');
}
const minimumRetentionSid = /sid\s*=\s*"DenyRetentionBelowMinimum"/u.exec(terraformSource);
const minimumRetentionStatementStart = minimumRetentionSid?.index ?? -1;
const minimumRetentionStatementEnd = terraformSource.indexOf(
  'resource "aws_s3_bucket_policy" "evidence"',
  minimumRetentionStatementStart
);
const minimumRetentionStatement = minimumRetentionStatementStart >= 0 && minimumRetentionStatementEnd >= 0
  ? terraformSource.slice(minimumRetentionStatementStart, minimumRetentionStatementEnd)
  : '';
if (!/actions\s*=\s*\[[\s\S]*?"s3:PutObject"[\s\S]*?"s3:PutObjectRetention"[\s\S]*?\]/u.test(minimumRetentionStatement)
    || !/NumericLessThan[\s\S]*?s3:object-lock-remaining-retention-days[\s\S]*?tostring\(var\.retention_days\)/u.test(minimumRetentionStatement)) {
  throw new Error('bucket policy must reject sub-minimum retention during upload and later retention changes');
}

console.log(
  `External evidence configuration passed: ${uploadCount} transit upload(s), `
  + `${transitRetentionDays}-day GitHub cache, COMPLIANCE archive >=${MINIMUM_RETENTION_DAYS} days.`
);
