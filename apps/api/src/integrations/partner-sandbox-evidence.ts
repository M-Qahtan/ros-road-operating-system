import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { IntegrationPartner } from './integration-lifecycle.js';
import { IntegrationPurpose } from './integration-principal.js';

export interface PartnerSandboxEvidenceFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface PartnerSandboxObservedProfile {
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  readonly environment: 'SANDBOX';
  readonly sandboxEndpointBaseUrl: string;
  readonly certificateFingerprintSha256: string;
  readonly jwsKid: string;
}

/**
 * Assertions emitted by the sandbox execution package. These values are intake
 * claims, not independently derived semantic proof. The verifier authenticates
 * the package context and bytes; safety/security/privacy/operations reviewers
 * must inspect the receipts before accepting the asserted behavior.
 */
export interface PartnerSandboxEvidenceSummary {
  readonly networkCalls: number;
  readonly exactlyOneLogicalActionVerified: boolean;
  readonly duplicateLogicalActionsObserved: number;
  readonly callbackAuthenticationVerified: boolean;
  readonly callbackReplayRejected: boolean;
  readonly delayedCallbackRejected: boolean;
  readonly outageRecoveryVerified: boolean;
  readonly statusCancelSemanticsVerified: boolean;
  readonly minimumNecessaryProjectionVerified: boolean;
  readonly dataMinimized: boolean;
  readonly operationalAuthorityGranted: boolean;
  readonly productionActivationEnabled: boolean;
  readonly realEmergencyDispatchPerformed: boolean;
  readonly publicRoadActionPerformed: boolean;
}

export interface PartnerSandboxEvidenceBundle {
  readonly schema: 'ros-partner-sandbox-evidence/v1';
  readonly sessionId: string;
  readonly candidateHeadSha: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly observedProfile: PartnerSandboxObservedProfile;
  readonly summary: PartnerSandboxEvidenceSummary;
  readonly receiptFiles: readonly PartnerSandboxEvidenceFile[];
}

export interface PartnerSandboxExpectedContext {
  readonly expectedCandidateHeadSha: string;
  readonly profileId: string;
  readonly partner: IntegrationPartner;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  readonly sandboxEndpointBaseUrl: string;
  readonly allowedCredentialPairs: readonly {
    readonly certificateFingerprintSha256: string;
    readonly jwsKid: string;
  }[];
  readonly approvalReference: string;
  readonly approvedFrom: string;
  readonly approvedUntil: string;
}

export interface PartnerSandboxEvidenceDecision {
  readonly status: 'NO_GO' | 'PACKAGE_READY_FOR_EXTERNAL_REVIEW';
  readonly activationAuthorized: false;
  readonly semanticClaimsIndependentlyVerified: false;
  readonly summaryClaimsRequireExternalReview: true;
  readonly bundleSha256: string;
  readonly candidateHeadVerified: boolean;
  readonly trustedProfileBindingVerified: boolean;
  readonly approvedWindowVerified: boolean;
  readonly evidenceIntegrityVerified: boolean;
  readonly receiptFileCount: number;
  readonly networkCallsClaimed: number;
  readonly blockingReasons: readonly string[];
}

const VERIFIED_PARTNER_SANDBOX_EVIDENCE: unique symbol = Symbol('ros-partner-sandbox-evidence-verified');

export interface VerifiedPartnerSandboxEvidence {
  readonly bundleSha256: string;
  readonly expectedCandidateHeadSha: string;
  readonly approvalReference: string;
  readonly verifiedFileCount: number;
  readonly trustedProfileBindingVerified: true;
  readonly approvedWindowVerified: true;
  readonly [VERIFIED_PARTNER_SANDBOX_EVIDENCE]: true;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PARTNERS = ['EMERGENCY', 'TRAFFIC', 'ROAD_OPERATOR', 'INSURANCE', 'TOWING', 'ROUTING'] as const;
const PURPOSES = [
  'EMERGENCY_COORDINATION',
  'TRAFFIC_COORDINATION',
  'INSURANCE_COORDINATION',
  'TOWING_COORDINATION',
  'ROUTE_COORDINATION'
] as const;
const PURPOSE_BY_PARTNER: Readonly<Record<IntegrationPartner, IntegrationPurpose>> = {
  EMERGENCY: 'EMERGENCY_COORDINATION',
  TRAFFIC: 'TRAFFIC_COORDINATION',
  ROAD_OPERATOR: 'TRAFFIC_COORDINATION',
  INSURANCE: 'INSURANCE_COORDINATION',
  TOWING: 'TOWING_COORDINATION',
  ROUTING: 'ROUTE_COORDINATION'
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(source)) {
    if (!allowedSet.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!(key in source)) throw new TypeError(`${field}.${key} is required`);
  }
}

function canonicalText(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  if (value.length < 1 || value.length > maximum || value !== value.trim()) {
    throw new TypeError(`${field} must be canonical text between 1 and ${maximum} characters`);
  }
  return value;
}

function token(value: unknown, field: string): string {
  const result = canonicalText(value, field, 128);
  if (!TOKEN.test(result)) throw new TypeError(`${field} must be a canonical token`);
  return result;
}

function sha256(value: unknown, field: string): string {
  const result = canonicalText(value, field, 64);
  if (!SHA256.test(result)) throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  return result;
}

function gitSha(value: unknown, field: string): string {
  const result = canonicalText(value, field, 40);
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

function timestamp(value: unknown, field: string): string {
  const result = canonicalText(value, field, 64);
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be ISO-8601`);
  return new Date(milliseconds).toISOString();
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function canonicalSandboxEndpoint(value: unknown, field: string): string {
  const raw = canonicalText(value, field, 512);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) throw new TypeError(`${field} must use HTTPS`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${field} must not contain userinfo, query or fragment`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function parseCredentialPair(value: unknown, index: number): {
  readonly certificateFingerprintSha256: string;
  readonly jwsKid: string;
} {
  const field = `expected.allowedCredentialPairs[${index}]`;
  const source = record(value, field);
  exactKeys(source, field, ['certificateFingerprintSha256', 'jwsKid']);
  return Object.freeze({
    certificateFingerprintSha256: sha256(source.certificateFingerprintSha256, `${field}.certificateFingerprintSha256`),
    jwsKid: token(source.jwsKid, `${field}.jwsKid`)
  });
}

export function parsePartnerSandboxExpectedContext(value: unknown): PartnerSandboxExpectedContext {
  const source = record(value, 'expected');
  exactKeys(source, 'expected', [
    'expectedCandidateHeadSha',
    'profileId',
    'partner',
    'tenantId',
    'purpose',
    'sandboxEndpointBaseUrl',
    'allowedCredentialPairs',
    'approvalReference',
    'approvedFrom',
    'approvedUntil'
  ]);

  const partner = enumValue(source.partner, 'expected.partner', PARTNERS);
  const purpose = enumValue(source.purpose, 'expected.purpose', PURPOSES);
  if (purpose !== PURPOSE_BY_PARTNER[partner]) {
    throw new TypeError(`expected context ${partner} requires purpose ${PURPOSE_BY_PARTNER[partner]}`);
  }
  if (!Array.isArray(source.allowedCredentialPairs) || source.allowedCredentialPairs.length < 1 || source.allowedCredentialPairs.length > 8) {
    throw new TypeError('expected.allowedCredentialPairs must contain 1..8 pairs');
  }
  const allowedCredentialPairs = source.allowedCredentialPairs.map(parseCredentialPair);
  const pairKeys = new Set<string>();
  for (const pair of allowedCredentialPairs) {
    const pairKey = `${pair.certificateFingerprintSha256}:${pair.jwsKid}`;
    if (pairKeys.has(pairKey)) throw new TypeError('expected.allowedCredentialPairs contains a duplicate pair');
    pairKeys.add(pairKey);
  }

  const approvedFrom = timestamp(source.approvedFrom, 'expected.approvedFrom');
  const approvedUntil = timestamp(source.approvedUntil, 'expected.approvedUntil');
  if (Date.parse(approvedUntil) <= Date.parse(approvedFrom)) {
    throw new TypeError('expected approval window must end after it starts');
  }

  return Object.freeze({
    expectedCandidateHeadSha: gitSha(source.expectedCandidateHeadSha, 'expected.expectedCandidateHeadSha'),
    profileId: token(source.profileId, 'expected.profileId'),
    partner,
    tenantId: canonicalText(source.tenantId, 'expected.tenantId', 128),
    purpose,
    sandboxEndpointBaseUrl: canonicalSandboxEndpoint(source.sandboxEndpointBaseUrl, 'expected.sandboxEndpointBaseUrl'),
    allowedCredentialPairs: Object.freeze(allowedCredentialPairs),
    approvalReference: token(source.approvalReference, 'expected.approvalReference'),
    approvedFrom,
    approvedUntil
  });
}

function parseFile(value: unknown, index: number): PartnerSandboxEvidenceFile {
  const field = `receiptFiles[${index}]`;
  const source = record(value, field);
  exactKeys(source, field, ['path', 'sha256', 'sizeBytes']);
  const path = canonicalText(source.path, `${field}.path`, 512);
  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new TypeError(`${field}.path must be a safe relative path`);
  }
  const sizeBytes = nonNegativeInteger(source.sizeBytes, `${field}.sizeBytes`);
  if (sizeBytes === 0) throw new TypeError(`${field}.sizeBytes must be greater than zero`);
  return Object.freeze({ path, sha256: sha256(source.sha256, `${field}.sha256`), sizeBytes });
}

function parseObservedProfile(value: unknown): PartnerSandboxObservedProfile {
  const source = record(value, 'observedProfile');
  exactKeys(source, 'observedProfile', [
    'profileId',
    'partner',
    'tenantId',
    'purpose',
    'environment',
    'sandboxEndpointBaseUrl',
    'certificateFingerprintSha256',
    'jwsKid'
  ]);
  const partner = enumValue(source.partner, 'observedProfile.partner', PARTNERS);
  const purpose = enumValue(source.purpose, 'observedProfile.purpose', PURPOSES);
  if (purpose !== PURPOSE_BY_PARTNER[partner]) {
    throw new TypeError(`${partner} requires purpose ${PURPOSE_BY_PARTNER[partner]}`);
  }
  return Object.freeze({
    profileId: token(source.profileId, 'observedProfile.profileId'),
    partner,
    tenantId: canonicalText(source.tenantId, 'observedProfile.tenantId', 128),
    purpose,
    environment: enumValue(source.environment, 'observedProfile.environment', ['SANDBOX'] as const),
    sandboxEndpointBaseUrl: canonicalSandboxEndpoint(source.sandboxEndpointBaseUrl, 'observedProfile.sandboxEndpointBaseUrl'),
    certificateFingerprintSha256: sha256(source.certificateFingerprintSha256, 'observedProfile.certificateFingerprintSha256'),
    jwsKid: token(source.jwsKid, 'observedProfile.jwsKid')
  });
}

function parseSummary(value: unknown): PartnerSandboxEvidenceSummary {
  const source = record(value, 'summary');
  const keys = [
    'networkCalls',
    'exactlyOneLogicalActionVerified',
    'duplicateLogicalActionsObserved',
    'callbackAuthenticationVerified',
    'callbackReplayRejected',
    'delayedCallbackRejected',
    'outageRecoveryVerified',
    'statusCancelSemanticsVerified',
    'minimumNecessaryProjectionVerified',
    'dataMinimized',
    'operationalAuthorityGranted',
    'productionActivationEnabled',
    'realEmergencyDispatchPerformed',
    'publicRoadActionPerformed'
  ] as const;
  exactKeys(source, 'summary', keys);
  return Object.freeze({
    networkCalls: nonNegativeInteger(source.networkCalls, 'summary.networkCalls'),
    exactlyOneLogicalActionVerified: booleanValue(source.exactlyOneLogicalActionVerified, 'summary.exactlyOneLogicalActionVerified'),
    duplicateLogicalActionsObserved: nonNegativeInteger(source.duplicateLogicalActionsObserved, 'summary.duplicateLogicalActionsObserved'),
    callbackAuthenticationVerified: booleanValue(source.callbackAuthenticationVerified, 'summary.callbackAuthenticationVerified'),
    callbackReplayRejected: booleanValue(source.callbackReplayRejected, 'summary.callbackReplayRejected'),
    delayedCallbackRejected: booleanValue(source.delayedCallbackRejected, 'summary.delayedCallbackRejected'),
    outageRecoveryVerified: booleanValue(source.outageRecoveryVerified, 'summary.outageRecoveryVerified'),
    statusCancelSemanticsVerified: booleanValue(source.statusCancelSemanticsVerified, 'summary.statusCancelSemanticsVerified'),
    minimumNecessaryProjectionVerified: booleanValue(source.minimumNecessaryProjectionVerified, 'summary.minimumNecessaryProjectionVerified'),
    dataMinimized: booleanValue(source.dataMinimized, 'summary.dataMinimized'),
    operationalAuthorityGranted: booleanValue(source.operationalAuthorityGranted, 'summary.operationalAuthorityGranted'),
    productionActivationEnabled: booleanValue(source.productionActivationEnabled, 'summary.productionActivationEnabled'),
    realEmergencyDispatchPerformed: booleanValue(source.realEmergencyDispatchPerformed, 'summary.realEmergencyDispatchPerformed'),
    publicRoadActionPerformed: booleanValue(source.publicRoadActionPerformed, 'summary.publicRoadActionPerformed')
  });
}

export function parsePartnerSandboxEvidenceBundle(value: unknown): PartnerSandboxEvidenceBundle {
  const source = record(value, 'bundle');
  exactKeys(source, 'bundle', [
    'schema', 'sessionId', 'candidateHeadSha', 'startedAt', 'completedAt', 'observedProfile', 'summary', 'receiptFiles'
  ]);
  if (source.schema !== 'ros-partner-sandbox-evidence/v1') throw new TypeError('bundle.schema is unsupported');
  const sessionId = canonicalText(source.sessionId, 'bundle.sessionId', 128);
  if (!SESSION_ID.test(sessionId)) throw new TypeError('bundle.sessionId format is invalid');
  const startedAt = timestamp(source.startedAt, 'bundle.startedAt');
  const completedAt = timestamp(source.completedAt, 'bundle.completedAt');
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new TypeError('bundle.completedAt precedes startedAt');
  if (!Array.isArray(source.receiptFiles) || source.receiptFiles.length < 1 || source.receiptFiles.length > 64) {
    throw new TypeError('bundle.receiptFiles must contain 1..64 files');
  }
  const receiptFiles = source.receiptFiles.map(parseFile);
  const paths = new Set<string>();
  for (const file of receiptFiles) {
    if (paths.has(file.path)) throw new TypeError(`duplicate receipt path ${file.path}`);
    paths.add(file.path);
  }
  return Object.freeze({
    schema: 'ros-partner-sandbox-evidence/v1',
    sessionId,
    candidateHeadSha: gitSha(source.candidateHeadSha, 'bundle.candidateHeadSha'),
    startedAt,
    completedAt,
    observedProfile: parseObservedProfile(source.observedProfile),
    summary: parseSummary(source.summary),
    receiptFiles: Object.freeze(receiptFiles)
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

export function partnerSandboxEvidenceBundleSha256(bundle: PartnerSandboxEvidenceBundle): string {
  return createHash('sha256').update(canonicalize(bundle), 'utf8').digest('hex');
}

function sameProfile(bundle: PartnerSandboxEvidenceBundle, expected: PartnerSandboxExpectedContext): boolean {
  const observed = bundle.observedProfile;
  return observed.profileId === expected.profileId &&
    observed.partner === expected.partner &&
    observed.tenantId === expected.tenantId &&
    observed.purpose === expected.purpose &&
    observed.sandboxEndpointBaseUrl === expected.sandboxEndpointBaseUrl &&
    expected.allowedCredentialPairs.some((pair) =>
      pair.certificateFingerprintSha256 === observed.certificateFingerprintSha256 && pair.jwsKid === observed.jwsKid
    );
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function verifyPartnerSandboxEvidence(
  bundle: PartnerSandboxEvidenceBundle,
  evidenceRoot: string,
  expectedInput: PartnerSandboxExpectedContext
): Promise<VerifiedPartnerSandboxEvidence> {
  const expected = parsePartnerSandboxExpectedContext(expectedInput);
  if (bundle.candidateHeadSha !== expected.expectedCandidateHeadSha) {
    throw new Error(`candidate head ${bundle.candidateHeadSha} does not match trusted expected head`);
  }
  if (!sameProfile(bundle, expected)) throw new Error('observed sandbox profile does not match trusted expected profile');
  if (Date.parse(bundle.startedAt) < Date.parse(expected.approvedFrom) || Date.parse(bundle.completedAt) > Date.parse(expected.approvedUntil)) {
    throw new Error('sandbox evidence session is outside the approved window');
  }

  const root = await realpath(resolve(canonicalText(evidenceRoot, 'evidenceRoot', 2048)));
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  for (const file of bundle.receiptFiles) {
    const unresolved = resolve(root, file.path);
    const unresolvedInfo = await lstat(unresolved);
    if (unresolvedInfo.isSymbolicLink()) throw new Error(`receipt ${file.path} must not be a symbolic link`);
    const target = await realpath(unresolved);
    if (!target.startsWith(rootPrefix)) throw new Error(`receipt ${file.path} escapes evidence root`);
    const info = await stat(target);
    if (!info.isFile()) throw new Error(`receipt ${file.path} is not a regular file`);
    if (info.size !== file.sizeBytes) throw new Error(`receipt ${file.path} size mismatch`);
    if (await digestFile(target) !== file.sha256) throw new Error(`receipt ${file.path} SHA-256 mismatch`);
  }

  return Object.freeze({
    bundleSha256: partnerSandboxEvidenceBundleSha256(bundle),
    expectedCandidateHeadSha: expected.expectedCandidateHeadSha,
    approvalReference: expected.approvalReference,
    verifiedFileCount: bundle.receiptFiles.length,
    trustedProfileBindingVerified: true,
    approvedWindowVerified: true,
    [VERIFIED_PARTNER_SANDBOX_EVIDENCE]: true as const
  });
}

export function evaluatePartnerSandboxEvidence(
  value: unknown,
  verification?: VerifiedPartnerSandboxEvidence
): PartnerSandboxEvidenceDecision {
  const bundle = parsePartnerSandboxEvidenceBundle(value);
  const bundleSha256 = partnerSandboxEvidenceBundleSha256(bundle);
  const receiptMatches = verification !== undefined &&
    verification[VERIFIED_PARTNER_SANDBOX_EVIDENCE] === true &&
    verification.bundleSha256 === bundleSha256 &&
    verification.verifiedFileCount === bundle.receiptFiles.length;
  const candidateHeadVerified = receiptMatches && verification.expectedCandidateHeadSha === bundle.candidateHeadSha;
  const trustedProfileBindingVerified = receiptMatches && verification.trustedProfileBindingVerified;
  const approvedWindowVerified = receiptMatches && verification.approvedWindowVerified;
  const evidenceIntegrityVerified = receiptMatches;

  const blockingReasons: string[] = [];
  if (!candidateHeadVerified) blockingReasons.push('candidate head is not independently verified');
  if (!trustedProfileBindingVerified) blockingReasons.push('trusted partner/profile/scope/credential binding is not independently verified');
  if (!approvedWindowVerified) blockingReasons.push('approved sandbox window is not independently verified');
  if (!evidenceIntegrityVerified) blockingReasons.push('sandbox receipt bytes are not independently verified');

  const summary = bundle.summary;
  if (summary.networkCalls < 1) blockingReasons.push('bundle does not claim an actual approved sandbox network call');
  if (!summary.exactlyOneLogicalActionVerified) blockingReasons.push('bundle does not claim exactly-one logical action verification');
  if (summary.duplicateLogicalActionsObserved > 0) blockingReasons.push('bundle reports duplicate logical actions');
  if (!summary.callbackAuthenticationVerified) blockingReasons.push('bundle does not claim callback authentication verification');
  if (!summary.callbackReplayRejected) blockingReasons.push('bundle does not claim callback replay rejection');
  if (!summary.delayedCallbackRejected) blockingReasons.push('bundle does not claim delayed callback rejection');
  if (!summary.outageRecoveryVerified) blockingReasons.push('bundle does not claim sandbox outage/recovery verification');
  if (!summary.statusCancelSemanticsVerified) blockingReasons.push('bundle does not claim status/cancel semantics verification');
  if (!summary.minimumNecessaryProjectionVerified) blockingReasons.push('bundle does not claim minimum-necessary projection verification');
  if (!summary.dataMinimized) blockingReasons.push('bundle reports data minimization was not maintained');
  if (summary.operationalAuthorityGranted) blockingReasons.push('bundle reports forbidden operational authority');
  if (summary.productionActivationEnabled) blockingReasons.push('bundle reports forbidden production activation');
  if (summary.realEmergencyDispatchPerformed) blockingReasons.push('bundle reports forbidden real emergency dispatch');
  if (summary.publicRoadActionPerformed) blockingReasons.push('bundle reports forbidden public-road action');

  return Object.freeze({
    status: blockingReasons.length === 0 ? 'PACKAGE_READY_FOR_EXTERNAL_REVIEW' : 'NO_GO',
    activationAuthorized: false,
    semanticClaimsIndependentlyVerified: false,
    summaryClaimsRequireExternalReview: true,
    bundleSha256,
    candidateHeadVerified,
    trustedProfileBindingVerified,
    approvedWindowVerified,
    evidenceIntegrityVerified,
    receiptFileCount: bundle.receiptFiles.length,
    networkCallsClaimed: summary.networkCalls,
    blockingReasons: Object.freeze(blockingReasons)
  });
}
