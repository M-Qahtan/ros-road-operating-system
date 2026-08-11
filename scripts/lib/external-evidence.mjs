import { createHash } from 'node:crypto';

export const EXTERNAL_EVIDENCE_SCHEMA = 'ros-external-evidence/v1';
export const MINIMUM_RETENTION_DAYS = 365;
export const RETENTION_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;
export const RETENTION_SAFETY_DAYS = 1;
export const ARCHIVABLE_WORKFLOWS = Object.freeze([
  'CI',
  'Operational Readiness',
  'Riyadh Failure-Mode Safety',
  'ROS Eye Pilot Readiness',
  'Safety Fusion Evidence',
  'Security'
]);

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256Base64(buffer) {
  return createHash('sha256').update(buffer).digest('base64');
}

export function assertDecimalIdentifier(value, label) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a positive decimal identifier`);
  }
  return value;
}

export function assertRepository(value, label = 'repository') {
  if (typeof value !== 'string' || !REPOSITORY_PATTERN.test(value)) {
    throw new Error(`${label} must be owner/name`);
  }
  return value;
}

export function assertSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character SHA`);
  }
  return value;
}

export function assertMinimumRetentionDays(value) {
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < MINIMUM_RETENTION_DAYS) {
    throw new Error(`retention must be an integer of at least ${MINIMUM_RETENTION_DAYS} days`);
  }
  return days;
}

export function slug(value, label = 'value') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error(`${label} must be a non-empty string of at most 200 characters`);
  }
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  if (normalized.length === 0) throw new Error(`${label} cannot be normalized safely`);
  return normalized;
}

export function buildArchivePrefix({ repositoryId, headSha, workflowId, runId, runAttempt }) {
  assertDecimalIdentifier(String(repositoryId), 'repositoryId');
  assertSha(headSha, 'headSha');
  assertDecimalIdentifier(String(workflowId), 'workflowId');
  assertDecimalIdentifier(String(runId), 'runId');
  assertDecimalIdentifier(String(runAttempt), 'runAttempt');
  return `evidence/github/${repositoryId}/${headSha}/${workflowId}/${runId}/${runAttempt}`;
}

export function buildArtifactKey(prefix, artifactId, digest) {
  if (!/^evidence\/github\/[0-9]+\/[0-9a-f]{40}\/[0-9]+\/[0-9]+\/[0-9]+$/u.test(prefix)) {
    throw new Error('archive prefix is malformed');
  }
  assertDecimalIdentifier(String(artifactId), 'artifactId');
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error('artifact digest must be SHA-256 hex');
  return `${prefix}/artifacts/${artifactId}-${digest}.zip`;
}

export function computeRetainUntil(now, minimumDays) {
  const days = assertMinimumRetentionDays(minimumDays);
  const timestamp = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error('retention start must be a valid date');
  return new Date(timestamp + (days + RETENTION_SAFETY_DAYS) * DAY_MS).toISOString();
}

export function assertSourceRun(run, expected) {
  if (!run || typeof run !== 'object') throw new Error('GitHub source run is missing');
  const repository = assertRepository(expected.repository, 'expected repository');
  const repositoryId = Number(assertDecimalIdentifier(String(expected.repositoryId), 'expected repositoryId'));
  const runId = Number(assertDecimalIdentifier(String(expected.runId), 'expected runId'));

  if (run.id !== runId) throw new Error('GitHub returned a different workflow run');
  if (run.repository?.full_name !== repository || run.repository?.id !== repositoryId) {
    throw new Error('workflow run is not bound to the expected repository identity');
  }
  if (run.head_repository?.full_name !== repository || run.head_repository?.id !== repositoryId) {
    throw new Error('fork workflow evidence is not eligible for privileged archival');
  }
  if (run.status !== 'completed') throw new Error('workflow run is not complete');
  if (run.conclusion !== 'success') throw new Error('workflow run did not conclude successfully');
  if (!ARCHIVABLE_WORKFLOWS.includes(run.name)) throw new Error(`workflow is not archivable: ${run.name}`);
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(run.event)) {
    throw new Error(`workflow event is not archivable: ${run.event}`);
  }
  assertSha(run.head_sha, 'source head SHA');
  assertDecimalIdentifier(String(run.run_attempt), 'source run attempt');
  assertDecimalIdentifier(String(run.workflow_id), 'source workflow id');
  return run;
}

export function assertBucketPosture(posture, expected) {
  const minimumDays = assertMinimumRetentionDays(expected.minimumRetentionDays);
  const lock = posture.lock?.ObjectLockConfiguration;
  const defaultRetention = lock?.Rule?.DefaultRetention;
  if (lock?.ObjectLockEnabled !== 'Enabled') throw new Error('S3 Object Lock is not enabled');
  if (defaultRetention?.Mode !== 'COMPLIANCE') {
    throw new Error('S3 default retention is not COMPLIANCE mode');
  }
  if (!Number.isSafeInteger(defaultRetention.Days) || defaultRetention.Days < minimumDays) {
    throw new Error(`S3 default retention is below ${minimumDays} days`);
  }
  if (posture.versioning?.Status !== 'Enabled') throw new Error('S3 versioning is not enabled');

  const encryptionRules = posture.encryption?.ServerSideEncryptionConfiguration?.Rules;
  const encryptedWithExpectedKey = Array.isArray(encryptionRules) && encryptionRules.some((rule) => {
    const encryption = rule.ApplyServerSideEncryptionByDefault;
    return encryption?.SSEAlgorithm === 'aws:kms'
      && encryption?.KMSMasterKeyID === expected.kmsKeyArn
      && rule.BucketKeyEnabled === true;
  });
  if (!encryptedWithExpectedKey) throw new Error('S3 default encryption is not the approved KMS key');

  const publicBlock = posture.publicAccess?.PublicAccessBlockConfiguration;
  const publicFlags = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
  if (!publicBlock || publicFlags.some((key) => publicBlock[key] !== true)) {
    throw new Error('S3 public access block is incomplete');
  }
  if (posture.policyStatus?.PolicyStatus?.IsPublic !== false) {
    throw new Error('S3 bucket policy is public or unverifiable');
  }
}

export function assertObjectProof(proof, expected) {
  const minimumDays = assertMinimumRetentionDays(expected.minimumRetentionDays);
  const expectedVersionId = String(proof.upload?.VersionId ?? '');
  if (expectedVersionId.length === 0 || expectedVersionId === 'null') {
    throw new Error('S3 upload did not return a version ID');
  }
  if (proof.head?.VersionId !== expectedVersionId) throw new Error('S3 version proof mismatch');
  if (proof.head?.ContentLength !== expected.contentLength) throw new Error('S3 content length mismatch');
  if (proof.head?.ChecksumSHA256 !== expected.checksumBase64) throw new Error('S3 checksum mismatch');
  if (proof.upload?.ChecksumSHA256 && proof.upload.ChecksumSHA256 !== expected.checksumBase64) {
    throw new Error('S3 upload checksum response mismatch');
  }
  if (proof.head?.Metadata?.sha256 !== expected.sha256Hex) throw new Error('S3 SHA-256 metadata mismatch');
  if (proof.head?.ServerSideEncryption !== 'aws:kms') throw new Error('S3 object is not SSE-KMS encrypted');
  if (proof.head?.SSEKMSKeyId !== expected.kmsKeyArn) throw new Error('S3 object used an unexpected KMS key');

  const retention = proof.retention?.Retention;
  if (proof.head?.ObjectLockMode !== 'COMPLIANCE' || retention?.Mode !== 'COMPLIANCE') {
    throw new Error('S3 object is not locked in COMPLIANCE mode');
  }
  if (proof.head?.ObjectLockRetainUntilDate !== retention?.RetainUntilDate) {
    throw new Error('S3 retention APIs disagree on retain-until date');
  }

  const createdAt = Date.parse(proof.head?.LastModified);
  const retainUntil = Date.parse(retention?.RetainUntilDate);
  if (!Number.isFinite(createdAt) || !Number.isFinite(retainUntil) || retainUntil <= createdAt) {
    throw new Error('S3 retention timestamps are invalid');
  }
  const requiredMs = minimumDays * DAY_MS;
  if (retainUntil - createdAt + RETENTION_CLOCK_TOLERANCE_MS < requiredMs) {
    throw new Error(`S3 object retention is below ${minimumDays} days`);
  }

  const etag = String(proof.head.ETag ?? '');
  if (etag.length === 0) throw new Error('S3 object ETag is missing');
  return {
    versionId: expectedVersionId,
    etag,
    retainUntil: retention.RetainUntilDate,
    checksumBase64: proof.head.ChecksumSHA256
  };
}

export function buildReceipt({ sourceRun, archive, artifacts, generatedAt }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('at least one artifact is required for an archive receipt');
  }
  const receipt = {
    schema: EXTERNAL_EVIDENCE_SCHEMA,
    generated_at: generatedAt,
    source_run: {
      repository: sourceRun.repository.full_name,
      repository_id: String(sourceRun.repository.id),
      workflow: sourceRun.name,
      workflow_id: String(sourceRun.workflow_id),
      event: sourceRun.event,
      conclusion: sourceRun.conclusion,
      head_sha: sourceRun.head_sha,
      head_branch: sourceRun.head_branch,
      run_id: String(sourceRun.id),
      run_attempt: String(sourceRun.run_attempt),
      html_url: sourceRun.html_url,
      created_at: sourceRun.created_at,
      updated_at: sourceRun.updated_at
    },
    archive: {
      bucket: archive.bucket,
      region: archive.region,
      kms_key_arn: archive.kmsKeyArn,
      object_lock_mode: 'COMPLIANCE',
      minimum_retention_days: archive.minimumRetentionDays
    },
    artifacts
  };
  assertReceipt(receipt);
  return receipt;
}

export function assertReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.schema !== EXTERNAL_EVIDENCE_SCHEMA) {
    throw new Error('archive receipt schema mismatch');
  }
  if (!Number.isSafeInteger(receipt.archive?.minimum_retention_days)
      || receipt.archive.minimum_retention_days < MINIMUM_RETENTION_DAYS) {
    throw new Error('archive receipt retention is too short');
  }
  if (receipt.archive?.object_lock_mode !== 'COMPLIANCE') {
    throw new Error('archive receipt lock mode mismatch');
  }
  assertRepository(receipt.source_run?.repository, 'receipt repository');
  assertSha(receipt.source_run?.head_sha, 'receipt head SHA');
  if (receipt.source_run?.conclusion !== 'success') {
    throw new Error('archive receipt source run did not conclude successfully');
  }
  if (!ARCHIVABLE_WORKFLOWS.includes(receipt.source_run?.workflow)) {
    throw new Error('archive receipt workflow is not allowlisted');
  }
  assertDecimalIdentifier(receipt.source_run?.repository_id, 'receipt repository ID');
  assertDecimalIdentifier(receipt.source_run?.workflow_id, 'receipt workflow ID');
  assertDecimalIdentifier(receipt.source_run?.run_id, 'receipt run ID');
  assertDecimalIdentifier(receipt.source_run?.run_attempt, 'receipt run attempt');
  const generatedAt = Date.parse(receipt.generated_at);
  if (!Number.isFinite(generatedAt)) throw new Error('archive receipt generated_at is invalid');
  if (typeof receipt.archive?.bucket !== 'string' || receipt.archive.bucket.length < 3) {
    throw new Error('archive receipt bucket is invalid');
  }
  if (!/^arn:[a-z0-9-]+:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]+$/u.test(receipt.archive?.kms_key_arn ?? '')) {
    throw new Error('archive receipt KMS key is invalid');
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    throw new Error('archive receipt has no artifacts');
  }
  const expectedPrefix = buildArchivePrefix({
    repositoryId: receipt.source_run.repository_id,
    headSha: receipt.source_run.head_sha,
    workflowId: receipt.source_run.workflow_id,
    runId: receipt.source_run.run_id,
    runAttempt: receipt.source_run.run_attempt
  });
  const artifactIds = new Set();
  for (const artifact of receipt.artifacts) {
    assertDecimalIdentifier(artifact.artifact_id, 'receipt artifact ID');
    if (artifactIds.has(artifact.artifact_id)) throw new Error('archive receipt contains a duplicate artifact ID');
    artifactIds.add(artifact.artifact_id);
    if (typeof artifact.name !== 'string' || artifact.name.length === 0 || artifact.name.length > 255) {
      throw new Error('receipt artifact name is invalid');
    }
    if (!Number.isFinite(Date.parse(artifact.github_created_at))
        || !Number.isFinite(Date.parse(artifact.github_expires_at))) {
      throw new Error('receipt GitHub artifact timestamps are invalid');
    }
    if (!/^[0-9a-f]{64}$/u.test(artifact.sha256)) throw new Error('receipt artifact digest is invalid');
    if (artifact.object_key !== buildArtifactKey(expectedPrefix, artifact.artifact_id, artifact.sha256)) {
      throw new Error('receipt object key is not bound to the source run');
    }
    if (typeof artifact.version_id !== 'string' || artifact.version_id.length === 0) {
      throw new Error('receipt artifact version ID is missing');
    }
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1) {
      throw new Error('receipt artifact size is invalid');
    }
    if (artifact.encryption !== 'aws:kms' || artifact.kms_key_arn !== receipt.archive.kms_key_arn) {
      throw new Error('receipt artifact KMS binding is invalid');
    }
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(artifact.checksum_sha256_base64 ?? '')) {
      throw new Error('receipt artifact checksum encoding is invalid');
    }
    if (artifact.object_lock_mode !== 'COMPLIANCE') throw new Error('receipt artifact is not immutable');
    const retainUntil = Date.parse(artifact.retain_until);
    if (!Number.isFinite(retainUntil)) throw new Error('receipt artifact retain-until is invalid');
    if (retainUntil - generatedAt + RETENTION_CLOCK_TOLERANCE_MS
        < receipt.archive.minimum_retention_days * DAY_MS) {
      throw new Error('receipt artifact retention is below the archive policy');
    }
  }
  return receipt;
}
