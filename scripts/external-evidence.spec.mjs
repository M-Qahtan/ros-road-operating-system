import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBucketPosture,
  assertObjectProof,
  assertReceipt,
  assertSourceRun,
  buildArchivePrefix,
  buildArtifactKey,
  buildReceipt,
  computeRetainUntil,
  MINIMUM_RETENTION_DAYS
} from './lib/external-evidence.mjs';

const repository = {
  id: 1310606342,
  full_name: 'M-Qahtan/ros-road-operating-system'
};

const sourceRun = {
  id: 100,
  run_attempt: 2,
  workflow_id: 200,
  name: 'CI',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  head_sha: 'a'.repeat(40),
  head_branch: 'agent/test',
  html_url: 'https://github.com/M-Qahtan/ros-road-operating-system/actions/runs/100',
  created_at: '2026-07-31T00:00:00.000Z',
  updated_at: '2026-07-31T00:10:00.000Z',
  repository,
  head_repository: repository
};

const kmsKeyArn = 'arn:aws:kms:me-central-1:123456789012:key/12345678-1234-1234-1234-123456789012';

test('source runs are bound to the immutable repository identity', () => {
  assert.equal(
    assertSourceRun(sourceRun, {
      repository: repository.full_name,
      repositoryId: String(repository.id),
      runId: String(sourceRun.id)
    }),
    sourceRun
  );
  assert.throws(
    () => assertSourceRun(
      { ...sourceRun, head_repository: { id: 999, full_name: 'attacker/fork' } },
      { repository: repository.full_name, repositoryId: String(repository.id), runId: String(sourceRun.id) }
    ),
    /fork workflow evidence/u
  );
});

test('source runs must complete successfully before archival', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    assert.throws(
      () => assertSourceRun(
        { ...sourceRun, conclusion },
        { repository: repository.full_name, repositoryId: String(repository.id), runId: String(sourceRun.id) }
      ),
      /did not conclude successfully/u
    );
  }
});

test('archive keys are deterministic and content-addressed', () => {
  const prefix = buildArchivePrefix({
    repositoryId: repository.id,
    headSha: sourceRun.head_sha,
    workflowId: sourceRun.workflow_id,
    runId: sourceRun.id,
    runAttempt: sourceRun.run_attempt
  });
  assert.equal(
    buildArtifactKey(prefix, 300, 'b'.repeat(64)),
    `evidence/github/${repository.id}/${sourceRun.head_sha}/200/100/2/artifacts/300-${'b'.repeat(64)}.zip`
  );
});

test('retention dates include a safety day above the minimum', () => {
  const start = new Date('2026-07-31T00:00:00.000Z');
  const retainUntil = new Date(computeRetainUntil(start, MINIMUM_RETENTION_DAYS));
  assert.equal(
    (retainUntil.getTime() - start.getTime()) / (24 * 60 * 60 * 1_000),
    MINIMUM_RETENTION_DAYS + 1
  );
});

test('bucket posture requires compliance lock, KMS, versioning, and no public access', () => {
  const posture = {
    lock: {
      ObjectLockConfiguration: {
        ObjectLockEnabled: 'Enabled',
        Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 365 } }
      }
    },
    versioning: { Status: 'Enabled' },
    encryption: {
      ServerSideEncryptionConfiguration: {
        Rules: [{
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: kmsKeyArn },
          BucketKeyEnabled: true
        }]
      }
    },
    publicAccess: {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true
      }
    },
    policyStatus: { PolicyStatus: { IsPublic: false } }
  };
  assert.doesNotThrow(() => assertBucketPosture(posture, { minimumRetentionDays: 365, kmsKeyArn }));
  assert.throws(
    () => assertBucketPosture({
      ...posture,
      lock: {
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 365 } }
        }
      }
    }, { minimumRetentionDays: 365, kmsKeyArn }),
    /COMPLIANCE/u
  );
});

test('object proof rejects retention shorter than 365 days', () => {
  const checksumBase64 = Buffer.alloc(32, 1).toString('base64');
  const versionId = 'evidence-version-1';
  const proof = {
    upload: { VersionId: versionId },
    head: {
      VersionId: versionId,
      ContentLength: 10,
      ChecksumSHA256: checksumBase64,
      Metadata: { sha256: 'c'.repeat(64) },
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: kmsKeyArn,
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: '2027-08-01T00:00:00.000Z',
      LastModified: '2026-07-31T00:00:00.000Z',
      ETag: 'etag'
    },
    retention: {
      Retention: { Mode: 'COMPLIANCE', RetainUntilDate: '2027-08-01T00:00:00.000Z' }
    }
  };
  const expected = {
    minimumRetentionDays: 365,
    kmsKeyArn,
    contentLength: 10,
    sha256Hex: 'c'.repeat(64),
    checksumBase64
  };
  assert.equal(assertObjectProof(proof, expected).versionId, versionId);
  const shortDate = '2027-07-30T00:00:00.000Z';
  assert.throws(
    () => assertObjectProof({
      ...proof,
      head: { ...proof.head, ObjectLockRetainUntilDate: shortDate },
      retention: { Retention: { Mode: 'COMPLIANCE', RetainUntilDate: shortDate } }
    }, expected),
    /below 365 days/u
  );
});

test('receipt preserves SHA, version, digest, encryption, and lock proof', () => {
  const receipt = buildReceipt({
    sourceRun,
    archive: {
      bucket: 'ros-evidence-example',
      region: 'me-central-1',
      kmsKeyArn,
      minimumRetentionDays: 365
    },
    artifacts: [{
      artifact_id: '300',
      name: 'verify-evidence',
      size_in_bytes: 10,
      github_created_at: '2026-07-31T00:00:00.000Z',
      github_expires_at: '2026-10-29T00:00:00.000Z',
      sha256: 'd'.repeat(64),
      checksum_sha256_base64: Buffer.alloc(32, 2).toString('base64'),
      object_key: `evidence/github/${repository.id}/${sourceRun.head_sha}/200/100/2/artifacts/300-${'d'.repeat(64)}.zip`,
      version_id: 'version-1',
      etag: 'etag',
      encryption: 'aws:kms',
      kms_key_arn: kmsKeyArn,
      object_lock_mode: 'COMPLIANCE',
      retain_until: '2027-08-01T00:00:00.000Z'
    }],
    generatedAt: '2026-07-31T00:11:00.000Z'
  });
  assert.equal(assertReceipt(receipt), receipt);
});

test('receipt rejects a non-success source conclusion', () => {
  const receipt = buildReceipt({
    sourceRun,
    archive: {
      bucket: 'ros-evidence-example',
      region: 'me-central-1',
      kmsKeyArn,
      minimumRetentionDays: 365
    },
    artifacts: [{
      artifact_id: '300',
      name: 'verify-evidence',
      size_in_bytes: 10,
      github_created_at: '2026-07-31T00:00:00.000Z',
      github_expires_at: '2026-10-29T00:00:00.000Z',
      sha256: 'd'.repeat(64),
      checksum_sha256_base64: Buffer.alloc(32, 2).toString('base64'),
      object_key: `evidence/github/${repository.id}/${sourceRun.head_sha}/200/100/2/artifacts/300-${'d'.repeat(64)}.zip`,
      version_id: 'version-1',
      etag: 'etag',
      encryption: 'aws:kms',
      kms_key_arn: kmsKeyArn,
      object_lock_mode: 'COMPLIANCE',
      retain_until: '2027-08-01T00:00:00.000Z'
    }],
    generatedAt: '2026-07-31T00:11:00.000Z'
  });
  assert.throws(
    () => assertReceipt({ ...receipt, source_run: { ...receipt.source_run, conclusion: 'failure' } }),
    /did not conclude successfully/u
  );
});
