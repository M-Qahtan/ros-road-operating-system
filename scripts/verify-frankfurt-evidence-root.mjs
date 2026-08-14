import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frankfurtRoot = path.join(repoRoot, 'infrastructure', 'evidence-store', 'aws-frankfurt');
const legacyRoot = path.join(repoRoot, 'infrastructure', 'evidence-store', 'aws');

const requiredFiles = [
  '.terraform.lock.hcl',
  'README.md',
  'backend.hcl.example',
  'main.tf',
  'outputs.tf',
  'terraform.tfvars.example',
  'variables.tf',
  'versions.tf'
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(frankfurtRoot, file)), `missing Frankfurt file: ${file}`);
}

const read = (file) => fs.readFileSync(path.join(frankfurtRoot, file), 'utf8');
const sources = {
  versions: read('versions.tf'),
  variables: read('variables.tf'),
  main: read('main.tf'),
  outputs: read('outputs.tf'),
  backend: read('backend.hcl.example'),
  tfvars: read('terraform.tfvars.example'),
  readme: read('README.md')
};

const count = (text, regex) => [...text.matchAll(regex)].length;
const section = (text, start, end) => {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return text.slice(startIndex, endIndex);
};

function collectViolations(candidate) {
  const violations = [];
  const tf = `${candidate.versions}\n${candidate.variables}\n${candidate.main}\n${candidate.outputs}`;
  const archive = section(candidate.main, 'data "aws_iam_policy_document" "archive" {', 'resource "aws_iam_role_policy" "github_archive" {');
  const verifier = section(candidate.main, 'data "aws_iam_policy_document" "independent_verifier" {', 'resource "aws_iam_policy" "independent_verifier" {');

  const requireText = (condition, code) => {
    if (!condition) violations.push(code);
  };

  requireText(candidate.variables.includes('default     = "eu-central-1"'), 'REGION_DEFAULT');
  requireText(candidate.variables.includes('condition     = var.aws_region == "eu-central-1"'), 'REGION_HARD_LOCK');
  requireText(!tf.includes('me-central-1'), 'ACTIVE_TF_REFERENCES_LEGACY_REGION');

  requireText(!candidate.main.includes('resource "aws_iam_openid_connect_provider"'), 'OIDC_CREATION_PRESENT');
  requireText(candidate.main.includes('var.existing_github_oidc_provider_arn'), 'OIDC_REUSE_MISSING');
  requireText(!candidate.variables.includes('create_github_oidc_provider'), 'OIDC_CREATE_TOGGLE_PRESENT');
  requireText(candidate.main.includes('expected_oidc_provider_arn'), 'OIDC_EXACT_ARN_PRECONDITION_MISSING');

  requireText(candidate.main.includes('ros-evidence-archive-euc1-${var.repository_id}'), 'FRANKFURT_ROLE_NAME');
  requireText(!candidate.main.includes('name                 = "ros-evidence-archive-${var.repository_id}"'), 'LEGACY_ROLE_COLLISION');
  requireText(candidate.main.includes('ros-evidence-independent-verifier-euc1-${var.repository_id}'), 'VERIFIER_NAME');
  requireText(candidate.main.includes('alias/ros-evidence-euc1-${var.repository_id}'), 'KMS_ALIAS');
  requireText(candidate.main.includes('ros-evidence-euc1-${var.repository_id}'), 'CLOUDTRAIL_NAME');

  requireText(count(candidate.main, /resource\s+"aws_s3_bucket"\s+"(?:evidence|audit)"/g) === 2, 'S3_BUCKET_COUNT');
  requireText(count(candidate.main, /object_lock_enabled\s*=\s*true/g) === 2, 'OBJECT_LOCK_BUCKET_ENABLEMENT');
  requireText(count(candidate.main, /force_destroy\s*=\s*false/g) === 2, 'FORCE_DESTROY_FALSE');
  requireText(count(candidate.main, /prevent_destroy\s*=\s*true/g) >= 3, 'PREVENT_DESTROY');
  requireText(count(candidate.main, /status\s*=\s*"Enabled"/g) >= 2, 'VERSIONING_ENABLED');
  requireText(count(candidate.main, /mode\s*=\s*"COMPLIANCE"/g) >= 2, 'COMPLIANCE_RETENTION');
  requireText(!candidate.main.includes('mode = "GOVERNANCE"'), 'GOVERNANCE_MODE_PRESENT');
  requireText(candidate.variables.includes('var.retention_days >= 365'), 'RETENTION_MINIMUM');
  requireText(count(candidate.main, /sse_algorithm\s*=\s*"aws:kms"/g) >= 2, 'SSE_KMS');
  requireText(count(candidate.main, /bucket_key_enabled\s*=\s*true/g) >= 2, 'S3_BUCKET_KEY');
  requireText(count(candidate.main, /object_ownership\s*=\s*"BucketOwnerEnforced"/g) >= 2, 'BUCKET_OWNER_ENFORCED');

  for (const flag of ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets']) {
    requireText(count(candidate.main, new RegExp(`${flag}\\s*=\\s*true`, 'g')) >= 2, `PUBLIC_ACCESS_${flag}`);
  }

  requireText(count(candidate.main, /sid\s*=\s*"DenyInsecureTransport"/g) >= 2, 'DENY_INSECURE_TRANSPORT');
  requireText(count(candidate.main, /sid\s*=\s*"DenyLegacyTLS"/g) >= 2, 'DENY_LEGACY_TLS');
  requireText(candidate.main.includes('variable = "s3:TlsVersion"'), 'TLS_VERSION_CONDITION');
  requireText(candidate.main.includes('values   = ["1.2"]'), 'TLS_12_MINIMUM');

  for (const sid of [
    'DenyNonKMSUploads',
    'DenyUnexpectedKMSKey',
    'DenyNonComplianceUploads',
    'DenyUploadsWithoutRetainUntil',
    'DenyRetentionBelowMinimum'
  ]) {
    requireText(candidate.main.includes(`sid       = "${sid}"`) || candidate.main.includes(`sid    = "${sid}"`), `EVIDENCE_POLICY_${sid}`);
  }

  requireText(candidate.main.includes('enable_key_rotation     = true'), 'KMS_ROTATION');
  requireText(candidate.main.includes('description             = "ROS REL-013 Frankfurt CI and release evidence encryption key"'), 'FRANKFURT_KMS_DESCRIPTION');

  requireText(candidate.main.includes('enable_logging                = true'), 'CLOUDTRAIL_LOGGING');
  requireText(candidate.main.includes('enable_log_file_validation    = true'), 'CLOUDTRAIL_LOG_VALIDATION');
  requireText(candidate.main.includes('include_global_service_events = true'), 'CLOUDTRAIL_GLOBAL_EVENTS');
  requireText(candidate.main.includes('is_multi_region_trail         = true'), 'CLOUDTRAIL_MULTI_REGION');
  requireText(candidate.main.includes('include_management_events = true'), 'CLOUDTRAIL_MANAGEMENT_EVENTS');
  requireText(candidate.main.includes('type   = "AWS::S3::Object"'), 'CLOUDTRAIL_S3_DATA_EVENTS');

  for (const forbidden of ['s3:DeleteObject', 's3:DeleteObjectVersion', 's3:BypassGovernanceRetention', 'kms:*']) {
    requireText(!archive.includes(`"${forbidden}"`), `ARCHIVE_FORBIDDEN_${forbidden}`);
  }
  requireText(archive.includes('"s3:PutObject"'), 'ARCHIVE_PUT_OBJECT');
  requireText(archive.includes('"s3:PutObjectRetention"'), 'ARCHIVE_PUT_RETENTION');
  requireText(archive.includes('"s3:GetEncryptionConfiguration"'), 'ARCHIVE_BUCKET_ENCRYPTION_READ');
  requireText(!archive.includes('"s3:GetBucketEncryption"'), 'ARCHIVE_LEGACY_BUCKET_ENCRYPTION_ACTION');
  requireText(archive.includes('"kms:Decrypt"'), 'ARCHIVE_KMS_DECRYPT');
  requireText(archive.includes('"kms:GenerateDataKey"'), 'ARCHIVE_KMS_DATA_KEY');
  requireText(archive.includes('"s3.eu-central-1.amazonaws.com"'), 'ARCHIVE_KMS_VIA_FRANKFURT');

  for (const forbidden of ['s3:PutObject', 's3:PutObjectRetention', 's3:DeleteObject', 's3:DeleteObjectVersion', 's3:BypassGovernanceRetention', 'kms:GenerateDataKey', 'kms:*']) {
    requireText(!verifier.includes(`"${forbidden}"`), `VERIFIER_FORBIDDEN_${forbidden}`);
  }
  requireText(verifier.includes('"s3:GetObjectRetention"'), 'VERIFIER_RETENTION_READ');
  requireText(verifier.includes('"s3:GetEncryptionConfiguration"'), 'VERIFIER_BUCKET_ENCRYPTION_READ');
  requireText(!verifier.includes('"s3:GetBucketEncryption"'), 'VERIFIER_LEGACY_BUCKET_ENCRYPTION_ACTION');
  requireText(verifier.includes('"cloudtrail:GetTrailStatus"'), 'VERIFIER_CLOUDTRAIL_READ');

  requireText(candidate.backend.includes('key          = "ros/rel-013/evidence-store/eu-central-1/terraform.tfstate"'), 'FRANKFURT_STATE_KEY');
  requireText(!candidate.backend.includes('key          = "ros/rel-013/evidence-store/terraform.tfstate"'), 'LEGACY_STATE_KEY_REUSE');
  requireText(candidate.backend.includes('region       = "me-central-1"'), 'BACKEND_REGION_PRESERVED');
  requireText(candidate.backend.includes('use_lockfile = true'), 'BACKEND_LOCKFILE');
  requireText(candidate.backend.includes('encrypt      = true'), 'BACKEND_ENCRYPTION');

  requireText(candidate.tfvars.includes('aws_region              = "eu-central-1"'), 'TFVARS_FRANKFURT_REGION');
  requireText(candidate.tfvars.includes('existing_github_oidc_provider_arn'), 'TFVARS_OIDC_REUSE');
  requireText(!candidate.tfvars.includes('AWS_ACCESS_KEY_ID') && !candidate.tfvars.includes('AWS_SECRET_ACCESS_KEY'), 'STATIC_AWS_CREDENTIALS');

  for (const forbiddenTfBlock of ['import {', 'removed {', 'moved {']) {
    requireText(!tf.includes(forbiddenTfBlock), `FORBIDDEN_TF_BLOCK_${forbiddenTfBlock}`);
  }

  requireText(candidate.outputs.includes('ROS_EVIDENCE_AWS_REGION     = var.aws_region'), 'OUTPUT_ACTIVE_REGION');
  requireText(candidate.outputs.includes('ROS_EVIDENCE_AWS_ROLE_ARN   = aws_iam_role.github_archive.arn'), 'OUTPUT_ACTIVE_ROLE');
  requireText(candidate.outputs.includes('ROS_EVIDENCE_BUCKET         = aws_s3_bucket.evidence.id'), 'OUTPUT_ACTIVE_BUCKET');
  requireText(candidate.outputs.includes('ROS_EVIDENCE_KMS_KEY_ARN    = aws_kms_key.evidence.arn'), 'OUTPUT_ACTIVE_KMS');

  return violations;
}

const actualViolations = collectViolations(sources);
assert.deepEqual(actualViolations, [], `Frankfurt architecture violations:\n${actualViolations.join('\n')}`);

function mutateSection(text, start, end, mutation) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return `${text.slice(0, startIndex)}${mutation(text.slice(startIndex, endIndex))}${text.slice(endIndex)}`;
}

const negativeFixtures = [
  {
    name: 'reject wrong active Region',
    expected: 'REGION_DEFAULT',
    mutate: (candidate) => ({ ...candidate, variables: candidate.variables.replace('default     = "eu-central-1"', 'default     = "me-central-1"') })
  },
  {
    name: 'reject OIDC creation resource',
    expected: 'OIDC_CREATION_PRESENT',
    mutate: (candidate) => ({ ...candidate, main: `${candidate.main}\nresource "aws_iam_openid_connect_provider" "forbidden" {}\n` })
  },
  {
    name: 'reject legacy role collision',
    expected: 'FRANKFURT_ROLE_NAME',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replace('ros-evidence-archive-euc1-${var.repository_id}', 'ros-evidence-archive-${var.repository_id}') })
  },
  {
    name: 'reject GOVERNANCE retention',
    expected: 'COMPLIANCE_RETENTION',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replaceAll('mode = "COMPLIANCE"', 'mode = "GOVERNANCE"') })
  },
  {
    name: 'reject force destroy',
    expected: 'FORCE_DESTROY_FALSE',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replaceAll('force_destroy       = false', 'force_destroy       = true') })
  },
  {
    name: 'reject removed prevent_destroy',
    expected: 'PREVENT_DESTROY',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replaceAll('prevent_destroy = true', 'prevent_destroy = false') })
  },
  {
    name: 'reject public access weakening',
    expected: 'PUBLIC_ACCESS_block_public_acls',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replaceAll('block_public_acls       = true', 'block_public_acls       = false') })
  },
  {
    name: 'reject CloudTrail log validation disablement',
    expected: 'CLOUDTRAIL_LOG_VALIDATION',
    mutate: (candidate) => ({ ...candidate, main: candidate.main.replace('enable_log_file_validation    = true', 'enable_log_file_validation    = false') })
  },
  {
    name: 'reject legacy backend state key reuse',
    expected: 'FRANKFURT_STATE_KEY',
    mutate: (candidate) => ({ ...candidate, backend: candidate.backend.replace('ros/rel-013/evidence-store/eu-central-1/terraform.tfstate', 'ros/rel-013/evidence-store/terraform.tfstate') })
  },
  {
    name: 'reject legacy archive bucket-encryption IAM action',
    expected: 'ARCHIVE_BUCKET_ENCRYPTION_READ',
    mutate: (candidate) => ({
      ...candidate,
      main: mutateSection(candidate.main, 'data "aws_iam_policy_document" "archive" {', 'resource "aws_iam_role_policy" "github_archive" {', (value) => value.replace('"s3:GetEncryptionConfiguration"', '"s3:GetBucketEncryption"'))
    })
  },
  {
    name: 'reject legacy verifier bucket-encryption IAM action',
    expected: 'VERIFIER_BUCKET_ENCRYPTION_READ',
    mutate: (candidate) => ({
      ...candidate,
      main: mutateSection(candidate.main, 'data "aws_iam_policy_document" "independent_verifier" {', 'resource "aws_iam_policy" "independent_verifier" {', (value) => value.replace('"s3:GetEncryptionConfiguration"', '"s3:GetBucketEncryption"'))
    })
  },
  {
    name: 'reject archive delete permission',
    expected: 'ARCHIVE_FORBIDDEN_s3:DeleteObject',
    mutate: (candidate) => ({
      ...candidate,
      main: mutateSection(candidate.main, 'data "aws_iam_policy_document" "archive" {', 'resource "aws_iam_role_policy" "github_archive" {', (value) => value.replace('"s3:PutObjectRetention"', '"s3:PutObjectRetention",\n      "s3:DeleteObject"'))
    })
  },
  {
    name: 'reject archive KMS administration',
    expected: 'ARCHIVE_FORBIDDEN_kms:*',
    mutate: (candidate) => ({
      ...candidate,
      main: mutateSection(candidate.main, 'data "aws_iam_policy_document" "archive" {', 'resource "aws_iam_role_policy" "github_archive" {', (value) => value.replace('"kms:GenerateDataKey"', '"kms:GenerateDataKey",\n      "kms:*"'))
    })
  },
  {
    name: 'reject verifier write permission',
    expected: 'VERIFIER_FORBIDDEN_s3:PutObject',
    mutate: (candidate) => ({
      ...candidate,
      main: mutateSection(candidate.main, 'data "aws_iam_policy_document" "independent_verifier" {', 'resource "aws_iam_policy" "independent_verifier" {', (value) => value.replace('"s3:GetObjectRetention"', '"s3:GetObjectRetention",\n      "s3:PutObject"'))
    })
  }
];

for (const fixture of negativeFixtures) {
  const violations = collectViolations(fixture.mutate({ ...sources }));
  assert.ok(violations.includes(fixture.expected), `${fixture.name}: expected ${fixture.expected}, got ${violations.join(', ')}`);
}

const legacyBaseSha = process.env.LEGACY_BASE_SHA?.trim();
if (legacyBaseSha) {
  assert.match(legacyBaseSha, /^[0-9a-f]{40}$/u, 'LEGACY_BASE_SHA must be a full commit SHA');
  const diff = spawnSync('git', ['diff', '--quiet', legacyBaseSha, '--', path.relative(repoRoot, legacyRoot)], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (diff.status === 1) {
    throw new Error('legacy Terraform root changed relative to the governed base SHA');
  }
  if (diff.status !== 0) {
    throw new Error(`unable to verify legacy non-interference: ${diff.stderr || diff.stdout || `git exit ${diff.status}`}`);
  }
}

console.log(`Frankfurt Gate C architecture PASS (${negativeFixtures.length} negative fail-closed cases proven).`);
if (legacyBaseSha) {
  console.log(`Legacy non-interference PASS against ${legacyBaseSha}.`);
} else {
  console.log('Legacy non-interference diff skipped because LEGACY_BASE_SHA was not supplied.');
}
