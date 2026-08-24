import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { StagingCloudReviewClaims, StagingEvidenceKind } from './staging-cloud-governance.js';

export const ROS_STAGING_REGION = 'me-central-1';
export const MAX_TEMPORARY_CREDENTIAL_LIFETIME_MS = 13 * 60 * 60 * 1000;
export const MIN_TEMPORARY_CREDENTIAL_REMAINING_MS = 5 * 60 * 1000;

const GIT_SHA = /^[a-f0-9]{40}$/;
const AWS_ACCOUNT_ID = /^\d{12}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REQUIRED_EVIDENCE_KINDS: readonly StagingEvidenceKind[] = [
  'BACKUP_RESTORE',
  'FAULT_INJECTION',
  'ROLLBACK_PLAN',
  'OBSERVABILITY',
  'INCIDENT_ONCALL',
  'SECURITY_POSTURE'
];
const execFileAsync = promisify(execFile);

export interface TemporaryAwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  readonly expiration: string;
}

export interface PlanOnlyEvidenceInput {
  readonly kind: StagingEvidenceKind;
  readonly path: string;
}

export interface StagingPlanOnlyRunnerManifest {
  readonly schema: 'ros-staging-plan-only-runner/v1';
  readonly expectedCandidateHeadSha: string;
  readonly claims: StagingCloudReviewClaims;
  readonly evidenceFiles: readonly PlanOnlyEvidenceInput[];
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function canonicalText(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value !== value.trim()) {
    throw new TypeError(`${field} must be canonical non-empty text`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

export function parseShortLivedCredentialExport(
  value: unknown,
  nowMs = Date.now()
): TemporaryAwsCredentials {
  const source = object(value, 'awsCredentialExport');
  if (source.Version !== 1) throw new TypeError('awsCredentialExport.Version must equal 1');
  const accessKeyId = canonicalText(source.AccessKeyId, 'awsCredentialExport.AccessKeyId', 256);
  const secretAccessKey = canonicalText(source.SecretAccessKey, 'awsCredentialExport.SecretAccessKey', 512);
  const sessionToken = canonicalText(source.SessionToken, 'awsCredentialExport.SessionToken', 8192);
  const expiration = canonicalText(source.Expiration, 'awsCredentialExport.Expiration', 64);
  const expirationMs = Date.parse(expiration);
  if (!Number.isFinite(expirationMs)) throw new TypeError('awsCredentialExport.Expiration must be ISO-8601');
  const remainingMs = expirationMs - nowMs;
  if (remainingMs < MIN_TEMPORARY_CREDENTIAL_REMAINING_MS) {
    throw new Error('AWS temporary credentials have less than five minutes remaining');
  }
  if (remainingMs > MAX_TEMPORARY_CREDENTIAL_LIFETIME_MS) {
    throw new Error('AWS credential lifetime exceeds the ROS short-lived credential boundary');
  }
  return Object.freeze({ accessKeyId, secretAccessKey, sessionToken, expiration: new Date(expirationMs).toISOString() });
}

export function parseAwsProfile(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  if (!PROFILE.test(value)) throw new TypeError('AWS profile name is not canonical');
  return value;
}

export function sanitizedAccountReference(accountId: string): string {
  if (!AWS_ACCOUNT_ID.test(accountId)) throw new TypeError('AWS account ID must be exactly 12 digits');
  const digest = createHash('sha256').update(accountId, 'utf8').digest('hex').slice(0, 16);
  return `aws-account-sha256-${digest}`;
}

export function parseStagingPlanOnlyRunnerManifest(value: unknown): StagingPlanOnlyRunnerManifest {
  const source = object(value, 'runnerManifest');
  const allowedKeys = new Set(['schema', 'expectedCandidateHeadSha', 'claims', 'evidenceFiles']);
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) throw new TypeError(`runnerManifest.${key} is not allowed`);
  }
  for (const key of allowedKeys) {
    if (!(key in source)) throw new TypeError(`runnerManifest.${key} is required`);
  }
  if (source.schema !== 'ros-staging-plan-only-runner/v1') throw new TypeError('runnerManifest.schema is unsupported');
  const expectedCandidateHeadSha = canonicalText(source.expectedCandidateHeadSha, 'runnerManifest.expectedCandidateHeadSha', 40);
  if (!GIT_SHA.test(expectedCandidateHeadSha)) {
    throw new TypeError('runnerManifest.expectedCandidateHeadSha must be a lowercase 40-character git SHA');
  }
  const claimsSource = object(source.claims, 'runnerManifest.claims');
  const claimKeys = [
    'rpoTargetMinutes', 'rtoTargetMinutes', 'haApplicationTopologyPlanned', 'managedPostgresPlanned',
    'managedRedisPlanned', 'objectEvidenceStorePlanned', 'workerOutboxTopologyPlanned',
    'logsMetricsTracesPlanned', 'safetyAlertingPlanned', 'onCallOwnerDefined', 'rollbackTriggerDefined',
    'rollbackOwnerDefined', 'shortLivedCloudCredentialsOnly', 'longLivedCloudCredentialsRequested',
    'unresolvedP0Findings', 'unresolvedP1Findings', 'publicRoadEnabled', 'realPartnerEnabled',
    'liveCameraEnabled', 'vehicleActuationEnabled', 'autonomousS3S4Enabled'
  ] as const;
  const claimKeySet = new Set<string>(claimKeys);
  for (const key of Object.keys(claimsSource)) {
    if (!claimKeySet.has(key)) throw new TypeError(`runnerManifest.claims.${key} is not allowed`);
  }
  for (const key of claimKeys) {
    if (!(key in claimsSource)) throw new TypeError(`runnerManifest.claims.${key} is required`);
  }
  const claims: StagingCloudReviewClaims = Object.freeze({
    rpoTargetMinutes: nonNegativeInteger(claimsSource.rpoTargetMinutes, 'runnerManifest.claims.rpoTargetMinutes'),
    rtoTargetMinutes: nonNegativeInteger(claimsSource.rtoTargetMinutes, 'runnerManifest.claims.rtoTargetMinutes'),
    haApplicationTopologyPlanned: booleanValue(claimsSource.haApplicationTopologyPlanned, 'runnerManifest.claims.haApplicationTopologyPlanned'),
    managedPostgresPlanned: booleanValue(claimsSource.managedPostgresPlanned, 'runnerManifest.claims.managedPostgresPlanned'),
    managedRedisPlanned: booleanValue(claimsSource.managedRedisPlanned, 'runnerManifest.claims.managedRedisPlanned'),
    objectEvidenceStorePlanned: booleanValue(claimsSource.objectEvidenceStorePlanned, 'runnerManifest.claims.objectEvidenceStorePlanned'),
    workerOutboxTopologyPlanned: booleanValue(claimsSource.workerOutboxTopologyPlanned, 'runnerManifest.claims.workerOutboxTopologyPlanned'),
    logsMetricsTracesPlanned: booleanValue(claimsSource.logsMetricsTracesPlanned, 'runnerManifest.claims.logsMetricsTracesPlanned'),
    safetyAlertingPlanned: booleanValue(claimsSource.safetyAlertingPlanned, 'runnerManifest.claims.safetyAlertingPlanned'),
    onCallOwnerDefined: booleanValue(claimsSource.onCallOwnerDefined, 'runnerManifest.claims.onCallOwnerDefined'),
    rollbackTriggerDefined: booleanValue(claimsSource.rollbackTriggerDefined, 'runnerManifest.claims.rollbackTriggerDefined'),
    rollbackOwnerDefined: booleanValue(claimsSource.rollbackOwnerDefined, 'runnerManifest.claims.rollbackOwnerDefined'),
    shortLivedCloudCredentialsOnly: booleanValue(claimsSource.shortLivedCloudCredentialsOnly, 'runnerManifest.claims.shortLivedCloudCredentialsOnly'),
    longLivedCloudCredentialsRequested: booleanValue(claimsSource.longLivedCloudCredentialsRequested, 'runnerManifest.claims.longLivedCloudCredentialsRequested'),
    unresolvedP0Findings: nonNegativeInteger(claimsSource.unresolvedP0Findings, 'runnerManifest.claims.unresolvedP0Findings'),
    unresolvedP1Findings: nonNegativeInteger(claimsSource.unresolvedP1Findings, 'runnerManifest.claims.unresolvedP1Findings'),
    publicRoadEnabled: booleanValue(claimsSource.publicRoadEnabled, 'runnerManifest.claims.publicRoadEnabled'),
    realPartnerEnabled: booleanValue(claimsSource.realPartnerEnabled, 'runnerManifest.claims.realPartnerEnabled'),
    liveCameraEnabled: booleanValue(claimsSource.liveCameraEnabled, 'runnerManifest.claims.liveCameraEnabled'),
    vehicleActuationEnabled: booleanValue(claimsSource.vehicleActuationEnabled, 'runnerManifest.claims.vehicleActuationEnabled'),
    autonomousS3S4Enabled: booleanValue(claimsSource.autonomousS3S4Enabled, 'runnerManifest.claims.autonomousS3S4Enabled')
  });
  if (!Array.isArray(source.evidenceFiles) || source.evidenceFiles.length !== REQUIRED_EVIDENCE_KINDS.length) {
    throw new TypeError(`runnerManifest.evidenceFiles must contain exactly ${REQUIRED_EVIDENCE_KINDS.length} entries`);
  }
  const seenKinds = new Set<StagingEvidenceKind>();
  const seenPaths = new Set<string>();
  const evidenceFiles = source.evidenceFiles.map((raw, index): PlanOnlyEvidenceInput => {
    const item = object(raw, `runnerManifest.evidenceFiles[${index}]`);
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('path')) {
      throw new TypeError(`runnerManifest.evidenceFiles[${index}] must contain only kind and path`);
    }
    const kind = canonicalText(item.kind, `runnerManifest.evidenceFiles[${index}].kind`, 64) as StagingEvidenceKind;
    if (!REQUIRED_EVIDENCE_KINDS.includes(kind)) throw new TypeError(`unsupported staging evidence kind ${kind}`);
    const path = canonicalText(item.path, `runnerManifest.evidenceFiles[${index}].path`, 512);
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      throw new TypeError(`runnerManifest.evidenceFiles[${index}].path must be a safe relative path`);
    }
    if (seenKinds.has(kind)) throw new TypeError(`duplicate staging evidence kind ${kind}`);
    if (seenPaths.has(path)) throw new TypeError(`duplicate staging evidence path ${path}`);
    seenKinds.add(kind);
    seenPaths.add(path);
    return Object.freeze({ kind, path });
  });
  for (const kind of REQUIRED_EVIDENCE_KINDS) {
    if (!seenKinds.has(kind)) throw new TypeError(`required staging evidence kind is missing: ${kind}`);
  }
  return Object.freeze({ schema: 'ros-staging-plan-only-runner/v1', expectedCandidateHeadSha, claims, evidenceFiles: Object.freeze(evidenceFiles) });
}

export async function assertExternalRegularFile(repoRoot: string, inputPath: string, field: string): Promise<string> {
  const repo = await realpath(resolve(repoRoot));
  const target = await realpath(resolve(inputPath));
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${field} must be a regular non-symbolic-link file`);
  const rel = relative(repo, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error(`${field} must be outside the repository because it may contain sensitive material`);
  }
  return target;
}

export async function assertExternalDirectory(repoRoot: string, inputPath: string, field: string): Promise<string> {
  const repo = await realpath(resolve(repoRoot));
  const target = await realpath(resolve(inputPath));
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${field} must be a regular non-symbolic-link directory`);
  const rel = relative(repo, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error(`${field} must be outside the repository`);
  }
  return target;
}

export async function sha256File(path: string): Promise<{ readonly sha256: string; readonly sizeBytes: number }> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('digest target must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return Object.freeze({ sha256: hash.digest('hex'), sizeBytes: info.size });
}

export async function executeJson(
  executable: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {}
): Promise<unknown> {
  const { stdout } = await execFileAsync(executable, [...args], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: options.env
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${executable} returned malformed JSON`);
  }
}
