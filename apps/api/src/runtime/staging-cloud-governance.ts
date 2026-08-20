import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export const PILOT_ENGINEERING_RPO_MINUTES = 5;
export const PILOT_ENGINEERING_RTO_MINUTES = 30;

export type StagingEvidenceKind =
  | 'BACKUP_RESTORE'
  | 'FAULT_INJECTION'
  | 'ROLLBACK_PLAN'
  | 'OBSERVABILITY'
  | 'INCIDENT_ONCALL'
  | 'SECURITY_POSTURE';

export interface StagingEvidenceFile {
  readonly kind: StagingEvidenceKind;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface StagingCloudReviewClaims {
  readonly rpoTargetMinutes: number;
  readonly rtoTargetMinutes: number;
  readonly haApplicationTopologyPlanned: boolean;
  readonly managedPostgresPlanned: boolean;
  readonly managedRedisPlanned: boolean;
  readonly objectEvidenceStorePlanned: boolean;
  readonly workerOutboxTopologyPlanned: boolean;
  readonly logsMetricsTracesPlanned: boolean;
  readonly safetyAlertingPlanned: boolean;
  readonly onCallOwnerDefined: boolean;
  readonly rollbackTriggerDefined: boolean;
  readonly rollbackOwnerDefined: boolean;
  readonly shortLivedCloudCredentialsOnly: boolean;
  readonly longLivedCloudCredentialsRequested: boolean;
  readonly unresolvedP0Findings: number;
  readonly unresolvedP1Findings: number;
  readonly publicRoadEnabled: boolean;
  readonly realPartnerEnabled: boolean;
  readonly liveCameraEnabled: boolean;
  readonly vehicleActuationEnabled: boolean;
  readonly autonomousS3S4Enabled: boolean;
}

export interface StagingCloudReviewPackage {
  readonly schema: 'ros-staging-cloud-review/v1';
  readonly candidateHeadSha: string;
  readonly environment: 'STAGING';
  readonly cloudAccountReference: string;
  readonly cloudRegion: string;
  readonly generatedAt: string;
  readonly claims: StagingCloudReviewClaims;
  readonly evidenceFiles: readonly StagingEvidenceFile[];
}

export interface TerraformPlanAnalysis {
  readonly formatVersion: string;
  readonly terraformVersion: string;
  readonly complete: boolean;
  readonly errored: boolean;
  readonly createCount: number;
  readonly updateCount: number;
  readonly readCount: number;
  readonly noOpCount: number;
  readonly deleteCount: number;
  readonly unknownActionCount: number;
  readonly sensitiveOutputCount: number;
  readonly destructiveAddresses: readonly string[];
  readonly unknownActionAddresses: readonly string[];
}

export interface VerifiedStagingCloudPackage {
  readonly packageSha256: string;
  readonly expectedCandidateHeadSha: string;
  readonly terraformPlanSha256: string;
  readonly terraformPlanAnalysis: TerraformPlanAnalysis;
  readonly verifiedEvidenceFileCount: number;
  readonly evidenceKinds: readonly StagingEvidenceKind[];
}

export interface StagingCloudReviewDecision {
  readonly status: 'NO_GO' | 'STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW';
  readonly deploymentAuthorized: false;
  readonly terraformApplyAuthorized: false;
  readonly publicRoadAuthorized: false;
  readonly externalIntegrationAuthorized: false;
  readonly semanticClaimsRequireHumanReview: true;
  readonly packageSha256: string;
  readonly candidateHeadVerified: boolean;
  readonly planIntegrityVerified: boolean;
  readonly planNonDestructiveVerified: boolean;
  readonly evidenceIntegrityVerified: boolean;
  readonly terraformPlanSha256: string | null;
  readonly terraformPlanAnalysis: TerraformPlanAnalysis | null;
  readonly blockingReasons: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const REQUIRED_EVIDENCE_KINDS: readonly StagingEvidenceKind[] = [
  'BACKUP_RESTORE',
  'FAULT_INJECTION',
  'ROLLBACK_PLAN',
  'OBSERVABILITY',
  'INCIDENT_ONCALL',
  'SECURITY_POSTURE'
];
const ALLOWED_TERRAFORM_ACTIONS = new Set(['no-op', 'read', 'create', 'update']);

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, field: string, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
  }
  for (const key of keys) {
    if (!(key in source)) throw new TypeError(`${field}.${key} is required`);
  }
}

function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value !== value.trim()) {
    throw new TypeError(`${field} must be canonical non-empty text`);
  }
  return value;
}

function token(value: unknown, field: string): string {
  const result = text(value, field, 192);
  if (!TOKEN.test(result)) throw new TypeError(`${field} must be a canonical token`);
  return result;
}

function sha256(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!SHA256.test(result)) throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  return result;
}

function gitSha(value: unknown, field: string): string {
  const result = text(value, field, 40);
  if (!GIT_SHA.test(result)) throw new TypeError(`${field} must be a lowercase 40-character git SHA`);
  return result;
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

function positiveInteger(value: unknown, field: string): number {
  const result = nonNegativeInteger(value, field);
  if (result < 1) throw new TypeError(`${field} must be greater than zero`);
  return result;
}

function timestamp(value: unknown, field: string): string {
  const raw = text(value, field, 64);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be ISO-8601`);
  return new Date(milliseconds).toISOString();
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseClaims(value: unknown): StagingCloudReviewClaims {
  const source = object(value, 'claims');
  const keys = [
    'rpoTargetMinutes',
    'rtoTargetMinutes',
    'haApplicationTopologyPlanned',
    'managedPostgresPlanned',
    'managedRedisPlanned',
    'objectEvidenceStorePlanned',
    'workerOutboxTopologyPlanned',
    'logsMetricsTracesPlanned',
    'safetyAlertingPlanned',
    'onCallOwnerDefined',
    'rollbackTriggerDefined',
    'rollbackOwnerDefined',
    'shortLivedCloudCredentialsOnly',
    'longLivedCloudCredentialsRequested',
    'unresolvedP0Findings',
    'unresolvedP1Findings',
    'publicRoadEnabled',
    'realPartnerEnabled',
    'liveCameraEnabled',
    'vehicleActuationEnabled',
    'autonomousS3S4Enabled'
  ] as const;
  exactKeys(source, 'claims', keys);
  return Object.freeze({
    rpoTargetMinutes: positiveInteger(source.rpoTargetMinutes, 'claims.rpoTargetMinutes'),
    rtoTargetMinutes: positiveInteger(source.rtoTargetMinutes, 'claims.rtoTargetMinutes'),
    haApplicationTopologyPlanned: booleanValue(source.haApplicationTopologyPlanned, 'claims.haApplicationTopologyPlanned'),
    managedPostgresPlanned: booleanValue(source.managedPostgresPlanned, 'claims.managedPostgresPlanned'),
    managedRedisPlanned: booleanValue(source.managedRedisPlanned, 'claims.managedRedisPlanned'),
    objectEvidenceStorePlanned: booleanValue(source.objectEvidenceStorePlanned, 'claims.objectEvidenceStorePlanned'),
    workerOutboxTopologyPlanned: booleanValue(source.workerOutboxTopologyPlanned, 'claims.workerOutboxTopologyPlanned'),
    logsMetricsTracesPlanned: booleanValue(source.logsMetricsTracesPlanned, 'claims.logsMetricsTracesPlanned'),
    safetyAlertingPlanned: booleanValue(source.safetyAlertingPlanned, 'claims.safetyAlertingPlanned'),
    onCallOwnerDefined: booleanValue(source.onCallOwnerDefined, 'claims.onCallOwnerDefined'),
    rollbackTriggerDefined: booleanValue(source.rollbackTriggerDefined, 'claims.rollbackTriggerDefined'),
    rollbackOwnerDefined: booleanValue(source.rollbackOwnerDefined, 'claims.rollbackOwnerDefined'),
    shortLivedCloudCredentialsOnly: booleanValue(source.shortLivedCloudCredentialsOnly, 'claims.shortLivedCloudCredentialsOnly'),
    longLivedCloudCredentialsRequested: booleanValue(source.longLivedCloudCredentialsRequested, 'claims.longLivedCloudCredentialsRequested'),
    unresolvedP0Findings: nonNegativeInteger(source.unresolvedP0Findings, 'claims.unresolvedP0Findings'),
    unresolvedP1Findings: nonNegativeInteger(source.unresolvedP1Findings, 'claims.unresolvedP1Findings'),
    publicRoadEnabled: booleanValue(source.publicRoadEnabled, 'claims.publicRoadEnabled'),
    realPartnerEnabled: booleanValue(source.realPartnerEnabled, 'claims.realPartnerEnabled'),
    liveCameraEnabled: booleanValue(source.liveCameraEnabled, 'claims.liveCameraEnabled'),
    vehicleActuationEnabled: booleanValue(source.vehicleActuationEnabled, 'claims.vehicleActuationEnabled'),
    autonomousS3S4Enabled: booleanValue(source.autonomousS3S4Enabled, 'claims.autonomousS3S4Enabled')
  });
}

function parseEvidenceFile(value: unknown, index: number): StagingEvidenceFile {
  const field = `evidenceFiles[${index}]`;
  const source = object(value, field);
  exactKeys(source, field, ['kind', 'path', 'sha256', 'sizeBytes']);
  const path = text(source.path, `${field}.path`, 512);
  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new TypeError(`${field}.path must be a safe relative path`);
  }
  return Object.freeze({
    kind: enumValue(source.kind, `${field}.kind`, REQUIRED_EVIDENCE_KINDS),
    path,
    sha256: sha256(source.sha256, `${field}.sha256`),
    sizeBytes: positiveInteger(source.sizeBytes, `${field}.sizeBytes`)
  });
}

export function parseStagingCloudReviewPackage(value: unknown): StagingCloudReviewPackage {
  const source = object(value, 'package');
  exactKeys(source, 'package', [
    'schema', 'candidateHeadSha', 'environment', 'cloudAccountReference', 'cloudRegion', 'generatedAt', 'claims', 'evidenceFiles'
  ]);
  if (source.schema !== 'ros-staging-cloud-review/v1') throw new TypeError('package.schema is unsupported');
  const cloudRegion = text(source.cloudRegion, 'package.cloudRegion', 64);
  if (!REGION.test(cloudRegion)) throw new TypeError('package.cloudRegion must be a canonical cloud region identifier');
  if (!Array.isArray(source.evidenceFiles) || source.evidenceFiles.length < 1 || source.evidenceFiles.length > 32) {
    throw new TypeError('package.evidenceFiles must contain 1..32 files');
  }
  const evidenceFiles = source.evidenceFiles.map(parseEvidenceFile);
  const paths = new Set<string>();
  const kinds = new Set<StagingEvidenceKind>();
  for (const file of evidenceFiles) {
    if (paths.has(file.path)) throw new TypeError(`duplicate evidence path ${file.path}`);
    if (kinds.has(file.kind)) throw new TypeError(`duplicate evidence kind ${file.kind}`);
    paths.add(file.path);
    kinds.add(file.kind);
  }
  return Object.freeze({
    schema: 'ros-staging-cloud-review/v1',
    candidateHeadSha: gitSha(source.candidateHeadSha, 'package.candidateHeadSha'),
    environment: enumValue(source.environment, 'package.environment', ['STAGING'] as const),
    cloudAccountReference: token(source.cloudAccountReference, 'package.cloudAccountReference'),
    cloudRegion,
    generatedAt: timestamp(source.generatedAt, 'package.generatedAt'),
    claims: parseClaims(source.claims),
    evidenceFiles: Object.freeze(evidenceFiles)
  });
}

function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not canonicalizable');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('value is not JSON-canonicalizable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
}

export function stagingCloudPackageSha256(value: StagingCloudReviewPackage): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function actionSummary(changes: unknown, field: string): Omit<TerraformPlanAnalysis,
  'formatVersion' | 'terraformVersion' | 'complete' | 'errored' | 'sensitiveOutputCount'> {
  if (!Array.isArray(changes)) throw new TypeError(`${field} must be an array`);
  let createCount = 0;
  let updateCount = 0;
  let readCount = 0;
  let noOpCount = 0;
  let deleteCount = 0;
  let unknownActionCount = 0;
  const destructiveAddresses: string[] = [];
  const unknownActionAddresses: string[] = [];

  for (let index = 0; index < changes.length; index += 1) {
    const item = object(changes[index], `${field}[${index}]`);
    const address = typeof item.address === 'string' && item.address.length > 0 ? item.address : `${field}[${index}]`;
    const change = object(item.change, `${field}[${index}].change`);
    if (!Array.isArray(change.actions) || change.actions.length < 1) {
      throw new TypeError(`${field}[${index}].change.actions must be a non-empty array`);
    }
    const actions = change.actions.map((action, actionIndex) => text(action, `${field}[${index}].change.actions[${actionIndex}]`, 32));
    if (actions.includes('delete')) {
      deleteCount += 1;
      destructiveAddresses.push(address);
    }
    for (const action of actions) {
      if (!ALLOWED_TERRAFORM_ACTIONS.has(action) && action !== 'delete') {
        unknownActionCount += 1;
        unknownActionAddresses.push(address);
      }
    }
    if (actions.length === 1 && actions[0] === 'create') createCount += 1;
    if (actions.length === 1 && actions[0] === 'update') updateCount += 1;
    if (actions.length === 1 && actions[0] === 'read') readCount += 1;
    if (actions.length === 1 && actions[0] === 'no-op') noOpCount += 1;
  }

  return {
    createCount,
    updateCount,
    readCount,
    noOpCount,
    deleteCount,
    unknownActionCount,
    destructiveAddresses: Object.freeze(destructiveAddresses),
    unknownActionAddresses: Object.freeze(unknownActionAddresses)
  };
}

function countSensitiveOutputs(value: unknown): number {
  if (value === undefined) return 0;
  const outputs = object(value, 'output_changes');
  let count = 0;
  for (const [name, raw] of Object.entries(outputs)) {
    const output = object(raw, `output_changes.${name}`);
    if (output.after_sensitive === true) count += 1;
  }
  return count;
}

/**
 * Analyze ephemeral `terraform show -json` output. Callers must not archive or
 * commit the raw JSON because Terraform can expose sensitive values in it.
 */
export function analyzeTerraformShowJson(value: unknown): TerraformPlanAnalysis {
  const source = object(value, 'terraformPlan');
  const resourceSummary = actionSummary(source.resource_changes ?? [], 'resource_changes');
  const driftSummary = actionSummary(source.resource_drift ?? [], 'resource_drift');
  return Object.freeze({
    formatVersion: text(source.format_version, 'terraformPlan.format_version', 32),
    terraformVersion: text(source.terraform_version, 'terraformPlan.terraform_version', 64),
    complete: source.complete === undefined ? true : booleanValue(source.complete, 'terraformPlan.complete'),
    errored: source.errored === undefined ? false : booleanValue(source.errored, 'terraformPlan.errored'),
    createCount: resourceSummary.createCount,
    updateCount: resourceSummary.updateCount,
    readCount: resourceSummary.readCount,
    noOpCount: resourceSummary.noOpCount,
    deleteCount: resourceSummary.deleteCount + driftSummary.deleteCount,
    unknownActionCount: resourceSummary.unknownActionCount + driftSummary.unknownActionCount,
    sensitiveOutputCount: countSensitiveOutputs(source.output_changes),
    destructiveAddresses: Object.freeze([...resourceSummary.destructiveAddresses, ...driftSummary.destructiveAddresses]),
    unknownActionAddresses: Object.freeze([...resourceSummary.unknownActionAddresses, ...driftSummary.unknownActionAddresses])
  });
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function verifyEvidenceFiles(
  packageValue: StagingCloudReviewPackage,
  rootInput: string
): Promise<readonly StagingEvidenceKind[]> {
  const root = await realpath(resolve(text(rootInput, 'evidenceRoot', 2048)));
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  for (const file of packageValue.evidenceFiles) {
    const unresolved = resolve(root, file.path);
    const unresolvedInfo = await lstat(unresolved);
    if (unresolvedInfo.isSymbolicLink()) throw new Error(`evidence ${file.path} must not be a symbolic link`);
    const target = await realpath(unresolved);
    if (!target.startsWith(rootPrefix)) throw new Error(`evidence ${file.path} escapes evidence root`);
    const info = await stat(target);
    if (!info.isFile()) throw new Error(`evidence ${file.path} is not a regular file`);
    if (info.size !== file.sizeBytes) throw new Error(`evidence ${file.path} size mismatch`);
    if (await digestFile(target) !== file.sha256) throw new Error(`evidence ${file.path} SHA-256 mismatch`);
  }
  return Object.freeze(packageValue.evidenceFiles.map((file) => file.kind));
}

export async function verifyStagingCloudPackage(
  packageValue: StagingCloudReviewPackage,
  evidenceRoot: string,
  expectedCandidateHeadSha: string,
  terraformPlanPath: string,
  terraformShowJson: unknown
): Promise<VerifiedStagingCloudPackage> {
  const expectedHead = gitSha(expectedCandidateHeadSha, 'expectedCandidateHeadSha');
  if (packageValue.candidateHeadSha !== expectedHead) {
    throw new Error(`package candidate ${packageValue.candidateHeadSha} does not match trusted expected head`);
  }

  const planPath = resolve(text(terraformPlanPath, 'terraformPlanPath', 2048));
  const planInfo = await lstat(planPath);
  if (planInfo.isSymbolicLink() || !planInfo.isFile()) throw new Error('Terraform plan must be a regular non-symbolic-link file');
  const terraformPlanSha256 = await digestFile(planPath);
  const terraformPlanAnalysis = analyzeTerraformShowJson(terraformShowJson);
  const evidenceKinds = await verifyEvidenceFiles(packageValue, evidenceRoot);

  return Object.freeze({
    packageSha256: stagingCloudPackageSha256(packageValue),
    expectedCandidateHeadSha: expectedHead,
    terraformPlanSha256,
    terraformPlanAnalysis,
    verifiedEvidenceFileCount: packageValue.evidenceFiles.length,
    evidenceKinds
  });
}

export function evaluateStagingCloudReview(
  value: unknown,
  verification?: VerifiedStagingCloudPackage
): StagingCloudReviewDecision {
  const packageValue = parseStagingCloudReviewPackage(value);
  const packageSha256 = stagingCloudPackageSha256(packageValue);
  const verificationMatches = verification !== undefined &&
    verification.packageSha256 === packageSha256 &&
    verification.verifiedEvidenceFileCount === packageValue.evidenceFiles.length;
  const candidateHeadVerified = verificationMatches && verification.expectedCandidateHeadSha === packageValue.candidateHeadSha;
  const planIntegrityVerified = verificationMatches && SHA256.test(verification.terraformPlanSha256);
  const evidenceIntegrityVerified = verificationMatches;
  const plan = verificationMatches ? verification.terraformPlanAnalysis : null;
  const planNonDestructiveVerified = plan !== null && plan.deleteCount === 0 && plan.unknownActionCount === 0 && plan.complete && !plan.errored;

  const blockingReasons: string[] = [];
  if (!candidateHeadVerified) blockingReasons.push('candidate head is not independently verified');
  if (!planIntegrityVerified) blockingReasons.push('Terraform plan bytes are not independently hashed');
  if (!evidenceIntegrityVerified) blockingReasons.push('staging evidence files are not independently verified');
  if (plan === null) {
    blockingReasons.push('Terraform plan semantics are not independently analyzed');
  } else {
    if (!plan.complete) blockingReasons.push('Terraform plan is incomplete/deferred');
    if (plan.errored) blockingReasons.push('Terraform plan reports an error');
    if (plan.deleteCount > 0) blockingReasons.push(`Terraform plan contains destructive/delete actions: ${plan.destructiveAddresses.join(', ')}`);
    if (plan.unknownActionCount > 0) blockingReasons.push(`Terraform plan contains unknown actions: ${plan.unknownActionAddresses.join(', ')}`);
    if (plan.sensitiveOutputCount > 0) blockingReasons.push('Terraform plan declares sensitive outputs; remove them from the review surface');
  }

  const evidenceKinds = new Set(verificationMatches ? verification.evidenceKinds : []);
  for (const kind of REQUIRED_EVIDENCE_KINDS) {
    if (!evidenceKinds.has(kind)) blockingReasons.push(`required staging evidence kind is missing: ${kind}`);
  }

  const claims = packageValue.claims;
  if (claims.rpoTargetMinutes !== PILOT_ENGINEERING_RPO_MINUTES) {
    blockingReasons.push(`RPO target must remain the approved engineering target of ${PILOT_ENGINEERING_RPO_MINUTES} minutes`);
  }
  if (claims.rtoTargetMinutes !== PILOT_ENGINEERING_RTO_MINUTES) {
    blockingReasons.push(`RTO target must remain the approved engineering target of ${PILOT_ENGINEERING_RTO_MINUTES} minutes`);
  }
  const requiredClaims: Array<[boolean, string]> = [
    [claims.haApplicationTopologyPlanned, 'HA application topology is not planned'],
    [claims.managedPostgresPlanned, 'managed PostgreSQL is not planned'],
    [claims.managedRedisPlanned, 'managed Redis is not planned'],
    [claims.objectEvidenceStorePlanned, 'object/evidence store is not planned'],
    [claims.workerOutboxTopologyPlanned, 'worker/outbox topology is not planned'],
    [claims.logsMetricsTracesPlanned, 'logs/metrics/traces are not planned'],
    [claims.safetyAlertingPlanned, 'safety alerting is not planned'],
    [claims.onCallOwnerDefined, 'on-call owner is not defined'],
    [claims.rollbackTriggerDefined, 'rollback trigger is not defined'],
    [claims.rollbackOwnerDefined, 'rollback owner is not defined'],
    [claims.shortLivedCloudCredentialsOnly, 'short-lived cloud credentials are not required']
  ];
  for (const [condition, reason] of requiredClaims) if (!condition) blockingReasons.push(reason);
  if (claims.longLivedCloudCredentialsRequested) blockingReasons.push('long-lived cloud credentials are forbidden');
  if (claims.unresolvedP0Findings > 0) blockingReasons.push('unresolved P0 findings remain');
  if (claims.unresolvedP1Findings > 0) blockingReasons.push('unresolved P1 findings remain');
  if (claims.publicRoadEnabled) blockingReasons.push('public-road enablement is forbidden in staging plan review');
  if (claims.realPartnerEnabled) blockingReasons.push('real partner activation is forbidden in staging plan review');
  if (claims.liveCameraEnabled) blockingReasons.push('live camera activation is forbidden in staging plan review');
  if (claims.vehicleActuationEnabled) blockingReasons.push('vehicle actuation is forbidden in staging plan review');
  if (claims.autonomousS3S4Enabled) blockingReasons.push('autonomous S3/S4 authority is forbidden');

  return Object.freeze({
    status: blockingReasons.length === 0 ? 'STAGING_PLAN_PACKAGE_READY_FOR_FOUNDER_REVIEW' : 'NO_GO',
    deploymentAuthorized: false,
    terraformApplyAuthorized: false,
    publicRoadAuthorized: false,
    externalIntegrationAuthorized: false,
    semanticClaimsRequireHumanReview: true,
    packageSha256,
    candidateHeadVerified,
    planIntegrityVerified,
    planNonDestructiveVerified,
    evidenceIntegrityVerified,
    terraformPlanSha256: planIntegrityVerified && verification !== undefined ? verification.terraformPlanSha256 : null,
    terraformPlanAnalysis: plan,
    blockingReasons: Object.freeze(blockingReasons)
  });
}
