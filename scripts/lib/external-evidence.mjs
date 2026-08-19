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
  'Runtime Driver Integration',
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

export function buildArchiveReceipt({ run, artifacts, archive, archivedAt }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('at least one artifact is required');
  const archiveBucket = String(archive?.bucket ?? '').trim();
  if (archiveBucket.length === 0 || archiveBucket.length > 63) throw new Error('archive bucket is invalid');
  const kmsKeyArn = String(archive?.kmsKeyArn ?? '').trim();
  if (!/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]+$/u.test(kmsKeyArn)) {
    throw new Error('archive KMS key ARN is invalid');
  }
  const retentionDays = assertMinimumRetentionDays(archive?.minimumRetentionDays);
  const receiptKey = String(archive?.receiptKey ?? '').trim();
  if (!/^evidence\/github\/[0-9]+\/[0-9a-f]{40}\/[0-9]+\/[0-9]+\/[0-9]+\/receipt\.json$/u.test(receiptKey)) {
    throw new Error('archive receipt key is invalid');
  }
  const archivedDate = archivedAt instanceof Date ? archivedAt : new Date(archivedAt);
  if (!Number.isFinite(archivedDate.getTime())) throw new Error('archive timestamp is invalid');
  const receipt = {
    schema: EXTERNAL_EVIDENCE_SCHEMA,
    source_run: {
      repository: run.repository.full_name,
      repository_id: run.repository.id,
      head_sha: run.head_sha,
      workflow_id: run.workflow_id,
      workflow_name: run.name,
      run_id: run.id,
      run_attempt: run.run_attempt,
      event: run.event,
      conclusion: run.conclusion
    },
    artifacts: artifacts.map((artifact) => ({
      artifact_id: artifact.id,
      name: artifact.name,
      size_bytes: artifact.sizeInBytes,
      sha256: artifact.sha256,
      object_key: artifact.objectKey,
      version_id: artifact.versionId,
      retain_until: artifact.retainUntil,
      object_lock_mode: artifact.objectLockMode,
      kms_key_arn: artifact.kmsKeyArn
    })),
    archive: {
      bucket: archiveBucket,
      kms_key_arn: kmsKeyArn,
      object_lock_mode: 'COMPLIANCE',
      minimum_retention_days: retentionDays,
      receipt_key: receiptKey,
      retain_until: archive.retainUntil,
      version_id: archive.versionId
    },
    archived_at: archivedDate.toISOString()
  };
  return Object.freeze(receipt);
}

export function assertArchivedObjectProof(proof, expected) {
  if (!proof || typeof proof !== 'object') throw new Error('archived object proof is missing');
  if (proof.objectKey !== expected.objectKey) throw new Error('archived object key mismatch');
  if (proof.sha256 !== expected.sha256) throw new Error('archived object digest mismatch');
  if (proof.kmsKeyArn !== expected.kmsKeyArn) throw new Error('archived object KMS key mismatch');
  if (proof.objectLockMode !== 'COMPLIANCE') throw new Error('archived object lock mode is not COMPLIANCE');
  const retainUntil = new Date(proof.retainUntil);
  if (!Number.isFinite(retainUntil.getTime())) throw new Error('archived object retention timestamp is invalid');
  const minimumRetainUntil = new Date(expected.minimumRetainUntil);
  if (!Number.isFinite(minimumRetainUntil.getTime())) throw new Error('expected minimum retention timestamp is invalid');
  if (retainUntil.getTime() + RETENTION_CLOCK_TOLERANCE_MS < minimumRetainUntil.getTime()) {
    throw new Error('archived object retention is shorter than required');
  }
  return proof;
}