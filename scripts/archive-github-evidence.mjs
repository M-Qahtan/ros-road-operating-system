import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import {
  assertBucketPosture,
  assertDecimalIdentifier,
  assertMinimumRetentionDays,
  assertObjectProof,
  assertReceipt,
  assertRepository,
  assertSourceRun,
  buildArchivePrefix,
  buildArtifactKey,
  buildReceipt,
  computeRetainUntil,
  sha256,
  sha256Base64
} from './lib/external-evidence.mjs';

const requiredEnvironment = [
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_REPOSITORY_ID',
  'SOURCE_RUN_ID',
  'EVIDENCE_BUCKET',
  'EVIDENCE_KMS_KEY_ARN',
  'AWS_REGION'
];

function fail(message) {
  console.error(`External evidence archival failed: ${message}`);
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

for (const name of requiredEnvironment) required(name);

const repository = assertRepository(required('GITHUB_REPOSITORY'));
const repositoryId = assertDecimalIdentifier(required('GITHUB_REPOSITORY_ID'), 'GITHUB_REPOSITORY_ID');
const sourceRunId = assertDecimalIdentifier(required('SOURCE_RUN_ID'), 'SOURCE_RUN_ID');
const token = required('GITHUB_TOKEN');
const bucket = required('EVIDENCE_BUCKET');
const kmsKeyArn = required('EVIDENCE_KMS_KEY_ARN');
const region = required('AWS_REGION');
const minimumRetentionDays = assertMinimumRetentionDays(process.env.MINIMUM_RETENTION_DAYS ?? '365');
const maximumArtifactBytes = Number(process.env.MAXIMUM_ARTIFACT_BYTES ?? String(512 * 1024 * 1024));
const maximumTotalBytes = Number(process.env.MAXIMUM_TOTAL_BYTES ?? String(2 * 1024 * 1024 * 1024));

if (!Number.isSafeInteger(maximumArtifactBytes) || maximumArtifactBytes < 1) {
  throw new Error('MAXIMUM_ARTIFACT_BYTES must be a positive safe integer');
}
if (!Number.isSafeInteger(maximumTotalBytes) || maximumTotalBytes < maximumArtifactBytes) {
  throw new Error('MAXIMUM_TOTAL_BYTES must be a safe integer at least MAXIMUM_ARTIFACT_BYTES');
}
if (!/^arn:[a-z0-9-]+:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]+$/u.test(kmsKeyArn)) {
  throw new Error('EVIDENCE_KMS_KEY_ARN must be a KMS key ARN, not an alias');
}

const [owner, name] = repository.split('/');
const githubHeaders = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'user-agent': 'ros-external-evidence-archiver/1',
  'x-github-api-version': '2022-11-28'
};

async function githubApi(path) {
  const endpoint = new URL(path, 'https://api.github.com');
  if (endpoint.origin !== 'https://api.github.com') throw new Error('GitHub API origin mismatch');
  const response = await fetch(endpoint, {
    headers: githubHeaders,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub API ${path} returned HTTP ${response.status}`);
  return response.json();
}

function parseAwsJson(service, operation, result) {
  const output = String(result.stdout ?? '').trim();
  if (output.length === 0) return {};
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`AWS CLI ${service} ${operation} returned invalid JSON: ${error.message}`);
  }
}

function runAws(service, operation, args, timeout = 120_000) {
  const command = ['--region', region, '--no-cli-pager', service, operation, ...args, '--output', 'json'];
  const result = spawnSync('aws', command, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout
  });
  if (result.error) throw new Error(`AWS CLI ${service} ${operation} failed: ${result.error.message}`);
  return result;
}

function awsJson(service, operation, args, timeout = 120_000) {
  const result = runAws(service, operation, args, timeout);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim().slice(0, 2_000);
    throw new Error(`AWS CLI ${service} ${operation} exited ${result.status}: ${detail}`);
  }
  return parseAwsJson(service, operation, result);
}

function awsJsonIfFound(service, operation, args, timeout = 120_000) {
  const result = runAws(service, operation, args, timeout);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim().slice(0, 2_000);
    if (/(?:\b404\b|Not Found|NoSuchKey|NoSuchVersion)/iu.test(detail)) return null;
    throw new Error(`AWS CLI ${service} ${operation} exited ${result.status}: ${detail}`);
  }
  return parseAwsJson(service, operation, result);
}

function downloadS3Version(key, versionId, targetPath) {
  const command = [
    '--region', region,
    '--no-cli-pager',
    '--output', 'json',
    's3api', 'get-object',
    '--bucket', bucket,
    '--key', key,
    '--version-id', versionId,
    '--checksum-mode', 'ENABLED',
    targetPath
  ];
  const result = spawnSync('aws', command, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000
  });
  if (result.error) throw new Error(`AWS CLI s3api get-object failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim().slice(0, 2_000);
    throw new Error(`AWS CLI s3api get-object exited ${result.status}: ${detail}`);
  }
  return parseAwsJson('s3api', 'get-object', result);
}

async function listArtifacts() {
  const artifacts = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await githubApi(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${sourceRunId}/artifacts?per_page=100&page=${page}`
    );
    if (!Array.isArray(response.artifacts)) throw new Error('GitHub artifact response is malformed');
    artifacts.push(...response.artifacts);
    if (response.artifacts.length < 100) return artifacts;
  }
  throw new Error('GitHub artifact pagination exceeded the safety limit');
}

function isTrustedArtifactDownloadUrl(url) {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'api.github.com'
    || host.endsWith('.blob.core.windows.net')
    || host.endsWith('.amazonaws.com')
    || host.endsWith('.githubusercontent.com');
}

async function fetchArtifactArchive(initialUrl) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (!isTrustedArtifactDownloadUrl(current)) {
      throw new Error(`artifact download redirected to an untrusted host: ${current.hostname}`);
    }
    const response = await fetch(current, {
      headers: current.origin === 'https://api.github.com'
        ? githubHeaders
        : { 'user-agent': githubHeaders['user-agent'] },
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('artifact download redirect omitted Location');
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new Error('artifact download exceeded the redirect safety limit');
}

async function downloadArtifact(artifact, targetPath) {
  const endpoint = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/artifacts/${artifact.id}/zip`,
    'https://api.github.com'
  );
  const response = await fetchArtifactArchive(endpoint);
  if (!response.ok || response.body === null) {
    throw new Error(`artifact ${artifact.id} download returned HTTP ${response.status}`);
  }
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumArtifactBytes) {
    throw new Error(`artifact ${artifact.id} exceeds the ${maximumArtifactBytes}-byte limit`);
  }

  let bytes = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumArtifactBytes) {
        callback(new Error(`artifact ${artifact.id} exceeded the download limit`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(targetPath, { flags: 'wx', mode: 0o600 })
  );
  if (bytes === 0) throw new Error(`artifact ${artifact.id} downloaded as an empty archive`);
  return { bytes, sha256Hex: hash.digest('hex') };
}

async function hashLocalFile(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256Hex: hash.digest('hex') };
}

function verifyBucket() {
  const posture = {
    lock: awsJson('s3api', 'get-object-lock-configuration', ['--bucket', bucket]),
    versioning: awsJson('s3api', 'get-bucket-versioning', ['--bucket', bucket]),
    encryption: awsJson('s3api', 'get-bucket-encryption', ['--bucket', bucket]),
    publicAccess: awsJson('s3api', 'get-public-access-block', ['--bucket', bucket]),
    policyStatus: awsJson('s3api', 'get-bucket-policy-status', ['--bucket', bucket])
  };
  assertBucketPosture(posture, { minimumRetentionDays, kmsKeyArn });
}

function assertExpectedMetadata(head, metadata, key) {
  for (const [metadataKey, metadataValue] of Object.entries(metadata)) {
    if (head.Metadata?.[metadataKey] !== String(metadataValue)) {
      throw new Error(`existing S3 object metadata mismatch for ${key}: ${metadataKey}`);
    }
  }
}

function verifyExistingObject({ key, sha256Hex, checksumBase64, contentLength, metadata }) {
  const head = awsJsonIfFound('s3api', 'head-object', [
    '--bucket', bucket,
    '--key', key,
    '--checksum-mode', 'ENABLED'
  ]);
  if (head === null) return null;

  const versionId = String(head.VersionId ?? '');
  if (versionId.length === 0 || versionId === 'null') {
    throw new Error(`existing S3 object has no version ID for ${key}`);
  }
  assertExpectedMetadata(head, { ...metadata, sha256: sha256Hex }, key);
  const retention = awsJson('s3api', 'get-object-retention', [
    '--bucket', bucket,
    '--key', key,
    '--version-id', versionId
  ]);
  const verified = assertObjectProof(
    { upload: { VersionId: versionId, ChecksumSHA256: head.ChecksumSHA256 }, head, retention },
    { minimumRetentionDays, kmsKeyArn, contentLength, sha256Hex, checksumBase64 }
  );
  return { ...verified, key, reused: true };
}

function conditionalUploadAndVerify({ path, key, contentType, sha256Hex, checksumBase64, contentLength, metadata }) {
  const retainUntil = computeRetainUntil(new Date(), minimumRetentionDays);
  const result = runAws('s3api', 'put-object', [
    '--bucket', bucket,
    '--key', key,
    '--body', path,
    '--content-type', contentType,
    '--server-side-encryption', 'aws:kms',
    '--ssekms-key-id', kmsKeyArn,
    '--object-lock-mode', 'COMPLIANCE',
    '--object-lock-retain-until-date', retainUntil,
    '--checksum-algorithm', 'SHA256',
    '--checksum-sha256', checksumBase64,
    '--metadata', JSON.stringify({ ...metadata, sha256: sha256Hex }),
    '--if-none-match', '*'
  ]);

  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim().slice(0, 2_000);
    if (/(?:\b412\b|PreconditionFailed|Precondition Failed)/iu.test(detail)) return null;
    throw new Error(`AWS CLI s3api put-object exited ${result.status}: ${detail}`);
  }

  const upload = parseAwsJson('s3api', 'put-object', result);
  const versionId = String(upload.VersionId ?? '');
  if (versionId.length === 0) throw new Error(`S3 did not return a version ID for ${key}`);

  const head = awsJson('s3api', 'head-object', [
    '--bucket', bucket,
    '--key', key,
    '--version-id', versionId,
    '--checksum-mode', 'ENABLED'
  ]);
  const retention = awsJson('s3api', 'get-object-retention', [
    '--bucket', bucket,
    '--key', key,
    '--version-id', versionId
  ]);
  const verified = assertObjectProof(
    { upload, head, retention },
    { minimumRetentionDays, kmsKeyArn, contentLength, sha256Hex, checksumBase64 }
  );
  return { ...verified, key, reused: false };
}

function uploadOrReuse(params) {
  const created = conditionalUploadAndVerify(params);
  if (created !== null) return created;

  const existing = verifyExistingObject(params);
  if (existing === null) {
    throw new Error(`conditional S3 write reported an existing object but HEAD returned not found for ${params.key}`);
  }
  return existing;
}

function safeReceiptPath() {
  const runnerTemp = resolve(process.env.RUNNER_TEMP ?? tmpdir());
  const requested = resolve(process.env.ARCHIVE_RECEIPT_PATH ?? join(runnerTemp, 'ros-evidence-archive-receipt.json'));
  if (!requested.startsWith(`${runnerTemp}${sep}`)) {
    throw new Error('ARCHIVE_RECEIPT_PATH must be inside RUNNER_TEMP');
  }
  return requested;
}

async function loadExistingReceipt({ receiptKey, receiptPath, sourceRun, archivedArtifacts }) {
  const head = awsJsonIfFound('s3api', 'head-object', [
    '--bucket', bucket,
    '--key', receiptKey,
    '--checksum-mode', 'ENABLED'
  ]);
  if (head === null) return null;

  const versionId = String(head.VersionId ?? '');
  if (versionId.length === 0 || versionId === 'null') {
    throw new Error(`existing archive receipt has no version ID for ${receiptKey}`);
  }
  assertExpectedMetadata(head, {
    schema: 'ros-external-evidence-v1',
    'source-run-id': String(sourceRun.id),
    'source-run-attempt': String(sourceRun.run_attempt),
    'source-head-sha': sourceRun.head_sha
  }, receiptKey);
  const retention = awsJson('s3api', 'get-object-retention', [
    '--bucket', bucket,
    '--key', receiptKey,
    '--version-id', versionId
  ]);

  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  downloadS3Version(receiptKey, versionId, receiptPath);
  const receiptBytes = await readFile(receiptPath);
  const receiptSha256 = sha256(receiptBytes);
  const checksumBase64 = sha256Base64(receiptBytes);
  const verified = assertObjectProof(
    { upload: { VersionId: versionId, ChecksumSHA256: head.ChecksumSHA256 }, head, retention },
    {
      minimumRetentionDays,
      kmsKeyArn,
      contentLength: receiptBytes.length,
      sha256Hex: receiptSha256,
      checksumBase64
    }
  );

  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`existing archive receipt is not valid JSON: ${error.message}`);
  }
  assertReceipt(receipt);
  const expectedReceipt = buildReceipt({
    sourceRun,
    archive: { bucket, region, kmsKeyArn, minimumRetentionDays },
    artifacts: archivedArtifacts,
    generatedAt: receipt.generated_at
  });
  if (JSON.stringify(receipt) !== JSON.stringify(expectedReceipt)) {
    throw new Error('existing archive receipt does not match the current source run and artifact proofs');
  }
  return {
    proof: { ...verified, key: receiptKey, reused: true },
    receiptSha256
  };
}

async function writeWorkflowOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const rendered = String(value);
    if (rendered.length === 0 || rendered.length > 2_048 || /[\r\n]/u.test(rendered)) {
      throw new Error(`unsafe workflow output: ${key}`);
    }
    return `${key}=${rendered}`;
  });
  await appendFile(outputPath, `${lines.join('\n')}\n`, { encoding: 'utf8' });
}

async function writeSummary(sourceRun, receiptProof, artifactCount) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const summary = [
    '## ROS external evidence archive',
    '',
    `- Source workflow: ${sourceRun.name}`,
    `- Source run: ${sourceRun.id}/${sourceRun.run_attempt}`,
    `- Source SHA: \`${sourceRun.head_sha}\``,
    `- Archived artifacts: ${artifactCount}`,
    `- Receipt key: \`${receiptProof.key}\``,
    `- Receipt version: \`${receiptProof.versionId}\``,
    `- Receipt disposition: ${receiptProof.reused ? 'reused existing immutable version' : 'created new immutable version'}`,
    `- Immutable through: ${receiptProof.retainUntil}`,
    `- Encryption: AWS KMS`,
    `- Object Lock: COMPLIANCE`
  ].join('\n');
  await appendFile(summaryPath, `${summary}\n`, { encoding: 'utf8' });
}

let temporaryDirectory;
try {
  const sourceRun = assertSourceRun(
    await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs/${sourceRunId}`),
    { repository, repositoryId, runId: sourceRunId }
  );
  const artifacts = (await listArtifacts())
    .filter((artifact) => artifact?.expired === false && artifact?.workflow_run?.id === sourceRun.id)
    .sort((left, right) => left.id - right.id);
  if (artifacts.length === 0) throw new Error('source workflow has no current artifacts to archive');

  const advertisedTotal = artifacts.reduce((total, artifact) => total + Number(artifact.size_in_bytes ?? 0), 0);
  if (!Number.isSafeInteger(advertisedTotal) || advertisedTotal > maximumTotalBytes) {
    throw new Error(`source workflow artifacts exceed the ${maximumTotalBytes}-byte aggregate limit`);
  }

  verifyBucket();
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'ros-evidence-archive-'));
  const prefix = buildArchivePrefix({
    repositoryId,
    headSha: sourceRun.head_sha,
    workflowId: sourceRun.workflow_id,
    runId: sourceRun.id,
    runAttempt: sourceRun.run_attempt
  });

  let actualTotal = 0;
  const archivedArtifacts = [];
  for (const artifact of artifacts) {
    assertDecimalIdentifier(String(artifact.id), 'artifact ID');
    const advertisedSize = Number(artifact.size_in_bytes);
    if (!Number.isSafeInteger(advertisedSize) || advertisedSize < 1 || advertisedSize > maximumArtifactBytes) {
      throw new Error(`artifact ${artifact.id} has an invalid or excessive advertised size`);
    }
    if (typeof artifact.name !== 'string' || artifact.name.length === 0 || artifact.name.length > 255) {
      throw new Error(`artifact ${artifact.id} has an invalid name`);
    }
    const localPath = join(temporaryDirectory, `${artifact.id}.zip`);
    const downloaded = await downloadArtifact(artifact, localPath);
    actualTotal += downloaded.bytes;
    if (actualTotal > maximumTotalBytes) throw new Error('downloaded artifacts exceeded the aggregate limit');

    const verifiedFile = await hashLocalFile(localPath);
    if (verifiedFile.bytes !== downloaded.bytes || verifiedFile.sha256Hex !== downloaded.sha256Hex) {
      throw new Error(`artifact ${artifact.id} changed between download and archival`);
    }
    const checksumBase64 = Buffer.from(verifiedFile.sha256Hex, 'hex').toString('base64');
    const key = buildArtifactKey(prefix, artifact.id, downloaded.sha256Hex);
    const proof = uploadOrReuse({
      path: localPath,
      key,
      contentType: 'application/zip',
      sha256Hex: downloaded.sha256Hex,
      checksumBase64,
      contentLength: downloaded.bytes,
      metadata: {
        schema: 'ros-external-evidence-v1',
        'source-run-id': String(sourceRun.id),
        'source-run-attempt': String(sourceRun.run_attempt),
        'source-head-sha': sourceRun.head_sha,
        'github-artifact-id': String(artifact.id)
      }
    });
    archivedArtifacts.push({
      artifact_id: String(artifact.id),
      name: artifact.name,
      size_in_bytes: downloaded.bytes,
      github_created_at: artifact.created_at,
      github_expires_at: artifact.expires_at,
      sha256: downloaded.sha256Hex,
      checksum_sha256_base64: proof.checksumBase64,
      object_key: proof.key,
      version_id: proof.versionId,
      etag: proof.etag,
      encryption: 'aws:kms',
      kms_key_arn: kmsKeyArn,
      object_lock_mode: 'COMPLIANCE',
      retain_until: proof.retainUntil
    });
  }

  const receiptPath = safeReceiptPath();
  const receiptKey = `${prefix}/receipt.json`;
  const receipt = buildReceipt({
    sourceRun,
    archive: { bucket, region, kmsKeyArn, minimumRetentionDays },
    artifacts: archivedArtifacts,
    generatedAt: new Date().toISOString()
  });
  assertReceipt(receipt);
  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  await writeFile(receiptPath, receiptBytes, { mode: 0o600 });
  const candidateReceiptSha256 = sha256(receiptBytes);

  const createdReceipt = conditionalUploadAndVerify({
    path: receiptPath,
    key: receiptKey,
    contentType: 'application/json',
    sha256Hex: candidateReceiptSha256,
    checksumBase64: sha256Base64(receiptBytes),
    contentLength: receiptBytes.length,
    metadata: {
      schema: 'ros-external-evidence-v1',
      'source-run-id': String(sourceRun.id),
      'source-run-attempt': String(sourceRun.run_attempt),
      'source-head-sha': sourceRun.head_sha
    }
  });

  let receiptProof;
  let receiptSha256;
  if (createdReceipt !== null) {
    receiptProof = createdReceipt;
    receiptSha256 = candidateReceiptSha256;
  } else {
    const existingReceipt = await loadExistingReceipt({
      receiptKey,
      receiptPath,
      sourceRun,
      archivedArtifacts
    });
    if (existingReceipt === null) {
      throw new Error('conditional receipt write reported an existing object but receipt HEAD returned not found');
    }
    receiptProof = existingReceipt.proof;
    receiptSha256 = existingReceipt.receiptSha256;
  }

  await writeWorkflowOutput({
    receipt_key: receiptProof.key,
    receipt_version_id: receiptProof.versionId,
    receipt_sha256: receiptSha256,
    source_head_sha: sourceRun.head_sha,
    artifact_count: archivedArtifacts.length
  });
  await writeSummary(sourceRun, receiptProof, archivedArtifacts.length);
  console.log(
    `${receiptProof.reused ? 'Reused' : 'Archived'} ${archivedArtifacts.length} artifact(s) for run `
    + `${sourceRun.id}/${sourceRun.run_attempt}; receipt ${receiptProof.key} version `
    + `${receiptProof.versionId} retained through ${receiptProof.retainUntil}.`
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}
