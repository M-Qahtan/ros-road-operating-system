import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertExternalDirectory,
  assertExternalRegularFile,
  parseAwsProfile,
  parseShortLivedCredentialExport,
  parseStagingPlanOnlyRunnerManifest,
  parseTerraformVersion,
  sanitizedAccountReference
} from './staging-plan-only-runner.js';

const HEAD = 'a'.repeat(40);

function claims() {
  return {
    rpoTargetMinutes: 5,
    rtoTargetMinutes: 30,
    haApplicationTopologyPlanned: true,
    managedPostgresPlanned: true,
    managedRedisPlanned: true,
    objectEvidenceStorePlanned: true,
    workerOutboxTopologyPlanned: true,
    logsMetricsTracesPlanned: false,
    safetyAlertingPlanned: true,
    onCallOwnerDefined: true,
    rollbackTriggerDefined: true,
    rollbackOwnerDefined: true,
    shortLivedCloudCredentialsOnly: true,
    longLivedCloudCredentialsRequested: false,
    unresolvedP0Findings: 1,
    unresolvedP1Findings: 1,
    publicRoadEnabled: false,
    realPartnerEnabled: false,
    liveCameraEnabled: false,
    vehicleActuationEnabled: false,
    autonomousS3S4Enabled: false
  };
}

function manifest() {
  return {
    schema: 'ros-staging-plan-only-runner/v1',
    expectedCandidateHeadSha: HEAD,
    claims: claims(),
    evidenceFiles: [
      { kind: 'BACKUP_RESTORE', path: 'backup-restore.json' },
      { kind: 'FAULT_INJECTION', path: 'fault-injection.json' },
      { kind: 'ROLLBACK_PLAN', path: 'rollback-plan.json' },
      { kind: 'OBSERVABILITY', path: 'observability.json' },
      { kind: 'INCIDENT_ONCALL', path: 'incident-oncall.json' },
      { kind: 'SECURITY_POSTURE', path: 'security-posture.json' }
    ]
  };
}

test('Terraform tooling must match the exact reviewed version', () => {
  assert.equal(parseTerraformVersion({ terraform_version: '1.15.8' }), '1.15.8');
  assert.throws(
    () => parseTerraformVersion({ terraform_version: '1.15.9' }),
    /Terraform 1\.15\.8 is required/
  );
  assert.throws(() => parseTerraformVersion({}), /terraform_version/);
});

test('valid temporary credential export is accepted without relaxing expiry boundaries', () => {
  const now = Date.parse('2026-08-24T17:00:00.000Z');
  const result = parseShortLivedCredentialExport({
    Version: 1,
    AccessKeyId: 'ASIATESTONLY',
    SecretAccessKey: 'test-only-secret-material',
    SessionToken: 'test-only-session-token',
    Expiration: '2026-08-24T18:00:00.000Z'
  }, now);
  assert.equal(result.expiration, '2026-08-24T18:00:00.000Z');
  assert.equal(result.sessionToken, 'test-only-session-token');
});

test('long-lived, expired, near-expiry and overlong credentials fail closed', () => {
  const now = Date.parse('2026-08-24T17:00:00.000Z');
  assert.throws(() => parseShortLivedCredentialExport({
    Version: 1,
    AccessKeyId: 'AKIATESTONLY',
    SecretAccessKey: 'test-only-secret-material'
  }, now), /SessionToken/);
  assert.throws(() => parseShortLivedCredentialExport({
    Version: 1,
    AccessKeyId: 'ASIATESTONLY',
    SecretAccessKey: 'test-only-secret-material',
    SessionToken: 'test-only-session-token',
    Expiration: '2026-08-24T17:04:00.000Z'
  }, now), /less than five minutes/);
  assert.throws(() => parseShortLivedCredentialExport({
    Version: 1,
    AccessKeyId: 'ASIATESTONLY',
    SecretAccessKey: 'test-only-secret-material',
    SessionToken: 'test-only-session-token',
    Expiration: '2026-08-25T07:30:00.000Z'
  }, now), /lifetime exceeds/);
});

test('account reference is deterministic and does not expose the AWS account ID', () => {
  const accountId = '123456789012';
  const first = sanitizedAccountReference(accountId);
  const second = sanitizedAccountReference(accountId);
  assert.equal(first, second);
  assert.match(first, /^aws-account-sha256-[a-f0-9]{16}$/);
  assert.equal(first.includes(accountId), false);
});

test('runner manifest preserves honest NO_GO claims instead of forcing green metadata', () => {
  const parsed = parseStagingPlanOnlyRunnerManifest(manifest());
  assert.equal(parsed.expectedCandidateHeadSha, HEAD);
  assert.equal(parsed.claims.logsMetricsTracesPlanned, false);
  assert.equal(parsed.claims.unresolvedP0Findings, 1);
  assert.equal(parsed.claims.unresolvedP1Findings, 1);
  assert.equal(parsed.evidenceFiles.length, 6);
});

test('runner manifest rejects missing evidence kinds, duplicate kinds and unsafe paths', () => {
  const missing = manifest();
  missing.evidenceFiles.pop();
  assert.throws(() => parseStagingPlanOnlyRunnerManifest(missing), /exactly 6 entries/);

  const duplicate = manifest();
  duplicate.evidenceFiles[5] = { kind: 'BACKUP_RESTORE', path: 'security-posture.json' };
  assert.throws(() => parseStagingPlanOnlyRunnerManifest(duplicate), /duplicate staging evidence kind/);

  const unsafe = manifest();
  unsafe.evidenceFiles[0] = { kind: 'BACKUP_RESTORE', path: '../escape.json' };
  assert.throws(() => parseStagingPlanOnlyRunnerManifest(unsafe), /safe relative path/);
});

test('AWS profile names are canonicalized fail-closed', () => {
  assert.equal(parseAwsProfile(undefined), null);
  assert.equal(parseAwsProfile('ros-staging'), 'ros-staging');
  assert.throws(() => parseAwsProfile('bad profile name'), /not canonical/);
});

test('symlinked sensitive PLAN_ONLY inputs are rejected before realpath resolution', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ros-plan-only-inputs-'));
  try {
    const repo = join(root, 'repo');
    const external = join(root, 'external');
    const realFile = join(external, 'runner-manifest.json');
    const realDir = join(external, 'evidence');
    const fileLink = join(root, 'manifest-link.json');
    const dirLink = join(root, 'evidence-link');
    await mkdir(repo);
    await mkdir(external);
    await mkdir(realDir);
    await writeFile(realFile, '{}\n', 'utf8');
    await symlink(realFile, fileLink, 'file');
    await symlink(realDir, dirLink, 'dir');

    await assert.rejects(
      assertExternalRegularFile(repo, fileLink, 'runner manifest'),
      /non-symbolic-link file/
    );
    await assert.rejects(
      assertExternalDirectory(repo, dirLink, 'evidence root'),
      /non-symbolic-link directory/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
