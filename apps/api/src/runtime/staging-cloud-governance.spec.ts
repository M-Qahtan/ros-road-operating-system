import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  analyzeTerraformShowJson,
  evaluateStagingCloudReview,
  parseStagingCloudReviewPackage,
  PILOT_ENGINEERING_RPO_MINUTES,
  PILOT_ENGINEERING_RTO_MINUTES,
  StagingCloudReviewPackage,
  StagingEvidenceKind,
  verifyStagingCloudPackage,
  verifyTerraformPlanFile
} from './staging-cloud-governance.js';

const HEAD = 'a'.repeat(40);
const EVIDENCE_BYTES = Buffer.from('ros staging governance evidence fixture\n', 'utf8');
const EVIDENCE_SHA = createHash('sha256').update(EVIDENCE_BYTES).digest('hex');
const PLAN_BYTES = Buffer.from('opaque terraform binary plan fixture\n', 'utf8');
const REQUIRED_KINDS: readonly StagingEvidenceKind[] = [
  'BACKUP_RESTORE',
  'FAULT_INJECTION',
  'ROLLBACK_PLAN',
  'OBSERVABILITY',
  'INCIDENT_ONCALL',
  'SECURITY_POSTURE'
];

function terraformJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_version: '1.2',
    terraform_version: '1.15.8',
    complete: true,
    errored: false,
    resource_changes: [
      { address: 'aws_rds_cluster.staging', change: { actions: ['create'] } },
      { address: 'aws_elasticache_replication_group.staging', change: { actions: ['create'] } },
      { address: 'aws_ecs_service.api', change: { actions: ['update'] } }
    ],
    resource_drift: [],
    output_changes: {
      staging_endpoint: { after_sensitive: false }
    },
    ...overrides
  };
}

function packageFixture(): StagingCloudReviewPackage {
  return {
    schema: 'ros-staging-cloud-review/v1',
    candidateHeadSha: HEAD,
    environment: 'STAGING',
    cloudAccountReference: 'ros-staging-account-review-candidate',
    cloudRegion: 'me-central-1',
    generatedAt: '2026-08-20T06:00:00.000Z',
    claims: {
      rpoTargetMinutes: PILOT_ENGINEERING_RPO_MINUTES,
      rtoTargetMinutes: PILOT_ENGINEERING_RTO_MINUTES,
      haApplicationTopologyPlanned: true,
      managedPostgresPlanned: true,
      managedRedisPlanned: true,
      objectEvidenceStorePlanned: true,
      workerOutboxTopologyPlanned: true,
      logsMetricsTracesPlanned: true,
      safetyAlertingPlanned: true,
      onCallOwnerDefined: true,
      rollbackTriggerDefined: true,
      rollbackOwnerDefined: true,
      shortLivedCloudCredentialsOnly: true,
      longLivedCloudCredentialsRequested: false,
      unresolvedP0Findings: 0,
      unresolvedP1Findings: 0,
      publicRoadEnabled: false,
      realPartnerEnabled: false,
      liveCameraEnabled: false,
      vehicleActuationEnabled: false,
      autonomousS3S4Enabled: false
    },
    evidenceFiles: REQUIRED_KINDS.map((kind) => ({
      kind,
      path: `evidence/${kind.toLowerCase()}.json`,
      sha256: EVIDENCE_SHA,
      sizeBytes: EVIDENCE_BYTES.byteLength
    }))
  };
}

async function withFixtureRoot<T>(
  packageValue: StagingCloudReviewPackage,
  planJson: unknown,
  run: (context: { root: string; planPath: string; terraformExecutable: string }) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'ros-staging-cloud-review-'));
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    for (const file of packageValue.evidenceFiles) {
      const target = join(root, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, EVIDENCE_BYTES);
    }
    const planPath = join(root, 'staging.tfplan');
    await writeFile(planPath, PLAN_BYTES);
    const terraformExecutable = join(root, 'terraform-fixture');
    await writeFile(
      terraformExecutable,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(planJson))});\n`,
      'utf8'
    );
    await chmod(terraformExecutable, 0o755);
    process.env.NODE_ENV = 'test';
    return await run({ root, planPath, terraformExecutable });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await rm(root, { recursive: true, force: true });
  }
}

async function verifiedDecision(
  rawPackage: StagingCloudReviewPackage,
  planJson: unknown
): Promise<ReturnType<typeof evaluateStagingCloudReview>> {
  return withFixtureRoot(rawPackage, planJson, async ({ root, planPath, terraformExecutable }) => {
    const parsed = parseStagingCloudReviewPackage(rawPackage);
    const verifiedPlan = await verifyTerraformPlanFile(planPath, { terraformExecutable });
    const verification = await verifyStagingCloudPackage(parsed, root, HEAD, verifiedPlan);
    return evaluateStagingCloudReview(parsed, verification);
  });
}

test('complete non-destructive staging plan package is only ready for founder review', async () => {
  const decision = await verifiedDecision(packageFixture(), terraformJson());
  assert.equal(decision.status, 'STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW');
  assert.equal(decision.deploymentAuthorized, false);
  assert.equal(decision.terraformApplyAuthorized, false);
  assert.equal(decision.publicRoadAuthorized, false);
  assert.equal(decision.externalIntegrationAuthorized, false);
  assert.equal(decision.semanticClaimsRequireHumanReview, true);
  assert.equal(decision.candidateHeadVerified, true);
  assert.equal(decision.planIntegrityVerified, true);
  assert.equal(decision.planNonDestructiveVerified, true);
  assert.equal(decision.evidenceIntegrityVerified, true);
  assert.match(decision.terraformPlanSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(decision.terraformPlanAnalysis?.createCount, 2);
  assert.equal(decision.terraformPlanAnalysis?.updateCount, 1);
  assert.deepEqual(decision.blockingReasons, []);
});

test('metadata-only package cannot review itself', () => {
  const decision = evaluateStagingCloudReview(packageFixture());
  assert.equal(decision.status, 'NO_GO');
  assert.equal(decision.candidateHeadVerified, false);
  assert.equal(decision.planIntegrityVerified, false);
  assert.equal(decision.evidenceIntegrityVerified, false);
  assert.equal(decision.terraformApplyAuthorized, false);
});

test('Terraform replacements and deletes are hard NO_GO', async () => {
  const replacement = terraformJson({
    resource_changes: [{ address: 'aws_rds_cluster.staging', change: { actions: ['delete', 'create'] } }]
  });
  const decision = await verifiedDecision(packageFixture(), replacement);
  assert.equal(decision.status, 'NO_GO');
  assert.equal(decision.planNonDestructiveVerified, false);
  assert.equal(decision.terraformPlanAnalysis?.deleteCount, 1);
  assert.match(decision.blockingReasons.join(' | '), /destructive\/delete actions/);
});

test('unknown Terraform actions, incomplete plans and errored plans fail closed', async () => {
  const unknown = await verifiedDecision(packageFixture(), terraformJson({
    resource_changes: [{ address: 'example.future_action', change: { actions: ['forget'] } }]
  }));
  assert.equal(unknown.status, 'NO_GO');
  assert.equal(unknown.terraformPlanAnalysis?.unknownActionCount, 1);

  const incomplete = await verifiedDecision(packageFixture(), terraformJson({ complete: false }));
  assert.equal(incomplete.status, 'NO_GO');
  assert.match(incomplete.blockingReasons.join(' | '), /incomplete\/deferred/);

  const errored = await verifiedDecision(packageFixture(), terraformJson({ errored: true }));
  assert.equal(errored.status, 'NO_GO');
  assert.match(errored.blockingReasons.join(' | '), /reports an error/);
});

test('sensitive Terraform outputs are rejected from the staging review surface', async () => {
  const decision = await verifiedDecision(packageFixture(), terraformJson({
    output_changes: { database_password: { after_sensitive: true } }
  }));
  assert.equal(decision.status, 'NO_GO');
  assert.equal(decision.terraformPlanAnalysis?.sensitiveOutputCount, 1);
  assert.match(decision.blockingReasons.join(' | '), /sensitive outputs/);
});

test('engineering RPO/RTO remain 5/30 minutes unless separately changed by governance', async () => {
  const wrongRpo = packageFixture();
  wrongRpo.claims = { ...wrongRpo.claims, rpoTargetMinutes: 10 };
  const rpoDecision = await verifiedDecision(wrongRpo, terraformJson());
  assert.equal(rpoDecision.status, 'NO_GO');
  assert.match(rpoDecision.blockingReasons.join(' | '), /RPO target/);

  const wrongRto = packageFixture();
  wrongRto.claims = { ...wrongRto.claims, rtoTargetMinutes: 60 };
  const rtoDecision = await verifiedDecision(wrongRto, terraformJson());
  assert.equal(rtoDecision.status, 'NO_GO');
  assert.match(rtoDecision.blockingReasons.join(' | '), /RTO target/);
});

test('missing required evidence kinds and tampered evidence remain NO_GO', async () => {
  const missing = packageFixture();
  missing.evidenceFiles = missing.evidenceFiles.filter((file) => file.kind !== 'ROLLBACK_PLAN');
  const missingDecision = await verifiedDecision(missing, terraformJson());
  assert.equal(missingDecision.status, 'NO_GO');
  assert.match(missingDecision.blockingReasons.join(' | '), /ROLLBACK_PLAN/);

  const tampered = packageFixture();
  await assert.rejects(
    withFixtureRoot(tampered, terraformJson(), async ({ root, planPath, terraformExecutable }) => {
      const target = join(root, tampered.evidenceFiles[0]!.path);
      await writeFile(target, Buffer.from('tampered staging evidence\n', 'utf8'));
      const verifiedPlan = await verifyTerraformPlanFile(planPath, { terraformExecutable });
      return verifyStagingCloudPackage(tampered, root, HEAD, verifiedPlan);
    }),
    /size mismatch|SHA-256 mismatch/
  );
});

test('wrong trusted candidate head is rejected before review', async () => {
  const rawPackage = packageFixture();
  await assert.rejects(
    withFixtureRoot(rawPackage, terraformJson(), async ({ root, planPath, terraformExecutable }) => {
      const verifiedPlan = await verifyTerraformPlanFile(planPath, { terraformExecutable });
      return verifyStagingCloudPackage(rawPackage, root, 'b'.repeat(40), verifiedPlan);
    }),
    /trusted expected head/
  );
});

test('forbidden credentials, unresolved findings and external authority remain NO_GO', async () => {
  const cases: Array<[keyof StagingCloudReviewPackage['claims'], unknown]> = [
    ['shortLivedCloudCredentialsOnly', false],
    ['longLivedCloudCredentialsRequested', true],
    ['unresolvedP0Findings', 1],
    ['unresolvedP1Findings', 1],
    ['publicRoadEnabled', true],
    ['realPartnerEnabled', true],
    ['liveCameraEnabled', true],
    ['vehicleActuationEnabled', true],
    ['autonomousS3S4Enabled', true]
  ];
  for (const [field, value] of cases) {
    const rawPackage = packageFixture();
    rawPackage.claims = { ...rawPackage.claims, [field]: value } as StagingCloudReviewPackage['claims'];
    const decision = await verifiedDecision(rawPackage, terraformJson());
    assert.equal(decision.status, 'NO_GO', field);
    assert.equal(decision.terraformApplyAuthorized, false, field);
    assert.equal(decision.deploymentAuthorized, false, field);
  }
});

test('package parser rejects unknown credential-like fields, duplicate evidence and non-STAGING environment', () => {
  const unknown = packageFixture() as StagingCloudReviewPackage & { awsSecretAccessKey?: string };
  unknown.awsSecretAccessKey = 'must-not-be-accepted';
  assert.throws(() => parseStagingCloudReviewPackage(unknown), /awsSecretAccessKey is not allowed/);

  const duplicate = packageFixture();
  duplicate.evidenceFiles = [...duplicate.evidenceFiles, { ...duplicate.evidenceFiles[0]! }];
  assert.throws(() => parseStagingCloudReviewPackage(duplicate), /duplicate evidence path|duplicate evidence kind/);

  const wrongEnvironment = { ...packageFixture(), environment: 'PRODUCTION' };
  assert.throws(() => parseStagingCloudReviewPackage(wrongEnvironment), /must be one of STAGING/);
});

test('Terraform JSON analyzer counts create/update/read/no-op and drift deletes deterministically', () => {
  const analysis = analyzeTerraformShowJson(terraformJson({
    resource_changes: [
      { address: 'create.one', change: { actions: ['create'] } },
      { address: 'update.one', change: { actions: ['update'] } },
      { address: 'read.one', change: { actions: ['read'] } },
      { address: 'noop.one', change: { actions: ['no-op'] } }
    ],
    resource_drift: [{ address: 'drift.deleted', change: { actions: ['delete'] } }]
  }));
  assert.equal(analysis.createCount, 1);
  assert.equal(analysis.updateCount, 1);
  assert.equal(analysis.readCount, 1);
  assert.equal(analysis.noOpCount, 1);
  assert.equal(analysis.deleteCount, 1);
  assert.deepEqual(analysis.destructiveAddresses, ['drift.deleted']);
});
