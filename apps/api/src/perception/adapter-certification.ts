import { createHash } from 'node:crypto';
import {
  ADAPTER_CERTIFICATION_CONTROLS,
  validateAdapterCertificationPackage,
  type AdapterCertificationControlId,
  type AdapterCertificationEnvironment,
  type AdapterCertificationPackage,
} from '@ros/contracts';

export type AdapterCertificationDecision =
  | 'CERTIFIED'
  | 'CERTIFIED_WITH_LIMITATIONS'
  | 'CONTEXT_ONLY'
  | 'REJECTED';

export interface TrustedAdapterCertificationContext {
  readonly expectedSessionId: string;
  readonly expectedCandidateGitSha: string;
  readonly expectedVendorId: string;
  readonly expectedAdapterId: string;
  readonly expectedAdapterVersion: string;
  readonly expectedVerifierId: string;
  readonly maximumEnvironment: AdapterCertificationEnvironment;
  readonly trustedNow: string;
}

export interface TrustedAdapterControlReceipt {
  readonly sessionId: string;
  readonly candidateGitSha: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly controlId: AdapterCertificationControlId;
  readonly evidenceManifestId: string;
  readonly evidenceSha256: string;
  readonly verifierId: string;
  readonly byteEvidenceVerified: true;
}

export interface AdapterCertificationEvaluation {
  readonly decision: AdapterCertificationDecision;
  readonly vendorId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly environment: AdapterCertificationEnvironment;
  readonly passedControls: readonly AdapterCertificationControlId[];
  readonly failedControls: readonly AdapterCertificationControlId[];
  readonly untestedControls: readonly AdapterCertificationControlId[];
  readonly reasonCodes: readonly string[];
  readonly evidenceSetDigest: string;
  readonly activationAuthorized: false;
  readonly liveIntegrationAuthorized: false;
  readonly publicRoadAuthorized: false;
  readonly authority: 'NONE';
}

const CURRENT_STATE_MINIMUM_CONTROLS = new Set<AdapterCertificationControlId>([
  'SCHEMA_CONFORMANCE',
  'CLOCK_BEHAVIOR',
  'COORDINATE_CORRECTNESS',
  'CALIBRATION_METADATA',
  'HEALTH_REPORTING',
  'SOURCE_LINEAGE',
  'SECURITY_IDENTITY',
  'EVIDENCE_HASHING',
  'FAILURE_ISOLATION',
  'AUTHORITY_ISOLATION',
]);

const ENVIRONMENT_RANK: Readonly<Record<AdapterCertificationEnvironment, number>> = {
  SIMULATION: 0,
  CONTROLLED_LAB: 1,
  SANDBOX: 2,
};

const CONTROL_SET = new Set<string>(ADAPTER_CERTIFICATION_CONTROLS);
const ENVIRONMENT_SET = new Set<string>(Object.keys(ENVIRONMENT_RANK));

export function evaluateAdapterCertification(input: {
  readonly package: AdapterCertificationPackage;
  readonly trustedContext: TrustedAdapterCertificationContext;
  readonly trustedReceipts: readonly TrustedAdapterControlReceipt[];
}): AdapterCertificationEvaluation {
  const errors = [...validateAdapterCertificationPackage(input.package)];
  errors.push(...validateTrustedContext(input.trustedContext));
  errors.push(...validateExactContextBinding(input.package, input.trustedContext));
  errors.push(...validateTrustedReceiptsShape(input.trustedReceipts, input.trustedContext));

  if (errors.length > 0) {
    return result(input.package, input.trustedReceipts, 'REJECTED', [], [], [], [...new Set(errors)].sort());
  }

  const controls = new Map(input.package.controlEvidence.map((item) => [item.controlId, item]));
  for (const controlId of ADAPTER_CERTIFICATION_CONTROLS) {
    if (!controls.has(controlId)) errors.push(`MISSING_CONTROL_EVIDENCE:${controlId}`);
  }
  if (controls.size !== ADAPTER_CERTIFICATION_CONTROLS.length) errors.push('CONTROL_SET_NOT_EXACT');

  const receipts = new Map<AdapterCertificationControlId, TrustedAdapterControlReceipt>();
  for (const receipt of input.trustedReceipts) {
    if (receipts.has(receipt.controlId)) errors.push(`DUPLICATE_TRUSTED_RECEIPT:${receipt.controlId}`);
    receipts.set(receipt.controlId, receipt);
  }
  if (receipts.size !== ADAPTER_CERTIFICATION_CONTROLS.length) errors.push('TRUSTED_RECEIPT_SET_NOT_EXACT');

  const trustedNowEpoch = Date.parse(input.trustedContext.trustedNow);
  for (const controlId of ADAPTER_CERTIFICATION_CONTROLS) {
    const evidence = controls.get(controlId);
    if (evidence === undefined) continue;
    const receipt = receipts.get(controlId);
    if (receipt === undefined) {
      errors.push(`MISSING_TRUSTED_RECEIPT:${controlId}`);
      continue;
    }
    if (receipt.byteEvidenceVerified !== true) errors.push(`EVIDENCE_BYTES_NOT_VERIFIED:${controlId}`);
    if (receipt.sessionId !== input.package.sessionId) errors.push(`RECEIPT_SESSION_MISMATCH:${controlId}`);
    if (receipt.candidateGitSha !== input.package.candidateGitSha) errors.push(`RECEIPT_CANDIDATE_MISMATCH:${controlId}`);
    if (receipt.adapterId !== input.package.capabilityManifest.adapterId) errors.push(`RECEIPT_ADAPTER_MISMATCH:${controlId}`);
    if (receipt.adapterVersion !== input.package.capabilityManifest.adapterVersion) errors.push(`RECEIPT_VERSION_MISMATCH:${controlId}`);
    if (receipt.verifierId !== input.trustedContext.expectedVerifierId) errors.push(`RECEIPT_VERIFIER_MISMATCH:${controlId}`);
    if (receipt.evidenceManifestId !== evidence.evidenceManifestId) errors.push(`RECEIPT_MANIFEST_MISMATCH:${controlId}`);
    if (receipt.evidenceSha256 !== evidence.evidenceSha256) errors.push(`RECEIPT_DIGEST_MISMATCH:${controlId}`);

    const observedAt = Date.parse(evidence.observedAt);
    if (Number.isFinite(trustedNowEpoch) && Number.isFinite(observedAt) && observedAt > trustedNowEpoch + 60_000) {
      errors.push(`CONTROL_EVIDENCE_FROM_FUTURE:${controlId}`);
    }
  }

  if (errors.length > 0) {
    return result(input.package, input.trustedReceipts, 'REJECTED', [], [], [], [...new Set(errors)].sort());
  }

  const passed = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'PASS');
  const failed = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'FAIL');
  const untested = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'NOT_TESTED');
  const reasons: string[] = [];

  if (failed.length > 0) {
    reasons.push(...failed.map((id) => `CONTROL_FAILED:${id}`));
    return result(input.package, input.trustedReceipts, 'REJECTED', passed, failed, untested, reasons);
  }

  if (!input.package.capabilityManifest.supportsProvenance || !input.package.capabilityManifest.supportsPayloadHashing) {
    reasons.push('EVIDENCE_ASSURANCE_CAPABILITY_MISSING');
    return result(input.package, input.trustedReceipts, 'REJECTED', passed, failed, untested, reasons);
  }

  const missingCurrentStateControls = [...CURRENT_STATE_MINIMUM_CONTROLS].filter((id) => controls.get(id)?.result !== 'PASS');
  if (!input.package.capabilityManifest.supportsHealthReporting || !input.package.capabilityManifest.supportsCalibrationMetadata) {
    reasons.push('CURRENT_STATE_HEALTH_OR_CALIBRATION_CAPABILITY_MISSING');
  }
  if (missingCurrentStateControls.length > 0) {
    reasons.push(...missingCurrentStateControls.map((id) => `CURRENT_STATE_CONTROL_NOT_PASS:${id}`));
  }

  if (reasons.length > 0 || input.package.environment === 'SIMULATION') {
    if (input.package.environment === 'SIMULATION') reasons.push('SIMULATION_EVIDENCE_CANNOT_CERTIFY_LIVE_ADAPTER');
    return result(input.package, input.trustedReceipts, 'CONTEXT_ONLY', passed, failed, untested, reasons);
  }

  if (untested.length > 0) {
    reasons.push(...untested.map((id) => `CONTROL_NOT_TESTED:${id}`));
    return result(input.package, input.trustedReceipts, 'CERTIFIED_WITH_LIMITATIONS', passed, failed, untested, reasons);
  }

  if (input.package.environment === 'CONTROLLED_LAB') {
    reasons.push('CONTROLLED_LAB_EVIDENCE_REQUIRES_SANDBOX_CONFIRMATION');
    return result(input.package, input.trustedReceipts, 'CERTIFIED_WITH_LIMITATIONS', passed, failed, untested, reasons);
  }

  return result(input.package, input.trustedReceipts, 'CERTIFIED', passed, failed, untested, ['ALL_CONTROLS_PASS_IN_APPROVED_SANDBOX']);
}

function validateTrustedContext(context: TrustedAdapterCertificationContext): string[] {
  const errors: string[] = [];
  const raw = context as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_TRUSTED_CONTEXT'];
  for (const [key, value] of Object.entries({
    expectedSessionId: raw.expectedSessionId,
    expectedVendorId: raw.expectedVendorId,
    expectedAdapterId: raw.expectedAdapterId,
    expectedAdapterVersion: raw.expectedAdapterVersion,
    expectedVerifierId: raw.expectedVerifierId,
  })) {
    if (!validIdentifier(value)) errors.push(`INVALID_TRUSTED_IDENTIFIER:${key}`);
  }
  if (typeof raw.expectedCandidateGitSha !== 'string' || !/^[a-f0-9]{40}$/.test(raw.expectedCandidateGitSha)) {
    errors.push('INVALID_TRUSTED_CANDIDATE_SHA');
  }
  if (typeof raw.maximumEnvironment !== 'string' || !ENVIRONMENT_SET.has(raw.maximumEnvironment)) {
    errors.push('INVALID_TRUSTED_MAXIMUM_ENVIRONMENT');
  }
  if (typeof raw.trustedNow !== 'string' || !Number.isFinite(Date.parse(raw.trustedNow))) errors.push('INVALID_TRUSTED_TIME');
  return errors;
}

function validateTrustedReceiptsShape(
  receipts: readonly TrustedAdapterControlReceipt[],
  context: TrustedAdapterCertificationContext,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(receipts)) return ['INVALID_TRUSTED_RECEIPTS'];
  const seen = new Set<string>();
  for (const rawReceipt of receipts as readonly unknown[]) {
    if (rawReceipt === null || typeof rawReceipt !== 'object' || Array.isArray(rawReceipt)) {
      errors.push('INVALID_TRUSTED_RECEIPT');
      continue;
    }
    const receipt = rawReceipt as Record<string, unknown>;
    const controlId = typeof receipt.controlId === 'string' ? receipt.controlId : 'UNKNOWN';
    if (!CONTROL_SET.has(controlId)) errors.push(`UNKNOWN_TRUSTED_RECEIPT_CONTROL:${controlId}`);
    if (seen.has(controlId)) errors.push(`DUPLICATE_TRUSTED_RECEIPT:${controlId}`);
    seen.add(controlId);
    if (!validIdentifier(receipt.sessionId)) errors.push(`INVALID_RECEIPT_SESSION:${controlId}`);
    if (typeof receipt.candidateGitSha !== 'string' || !/^[a-f0-9]{40}$/.test(receipt.candidateGitSha)) {
      errors.push(`INVALID_RECEIPT_CANDIDATE_SHA:${controlId}`);
    }
    if (!validIdentifier(receipt.adapterId)) errors.push(`INVALID_RECEIPT_ADAPTER_ID:${controlId}`);
    if (!validIdentifier(receipt.adapterVersion)) errors.push(`INVALID_RECEIPT_ADAPTER_VERSION:${controlId}`);
    if (!validBoundedText(receipt.evidenceManifestId, 256)) errors.push(`INVALID_RECEIPT_MANIFEST:${controlId}`);
    if (typeof receipt.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.evidenceSha256)) {
      errors.push(`INVALID_RECEIPT_DIGEST:${controlId}`);
    }
    if (!validIdentifier(receipt.verifierId)) errors.push(`INVALID_RECEIPT_VERIFIER:${controlId}`);
    if (receipt.verifierId !== context.expectedVerifierId) errors.push(`RECEIPT_VERIFIER_MISMATCH:${controlId}`);
    if (receipt.byteEvidenceVerified !== true) errors.push(`EVIDENCE_BYTES_NOT_VERIFIED:${controlId}`);
  }
  return errors;
}

function validateExactContextBinding(
  value: AdapterCertificationPackage,
  context: TrustedAdapterCertificationContext,
): string[] {
  const errors: string[] = [];
  const packageRaw = value as unknown as Record<string, unknown> | null;
  const contextRaw = context as unknown as Record<string, unknown> | null;
  if (packageRaw === null || contextRaw === null || typeof packageRaw !== 'object' || typeof contextRaw !== 'object') {
    return ['CERTIFICATION_CONTEXT_BINDING_UNAVAILABLE'];
  }
  const manifest = packageRaw.capabilityManifest as Record<string, unknown> | null;
  if (packageRaw.sessionId !== contextRaw.expectedSessionId) errors.push('SESSION_BINDING_MISMATCH');
  if (packageRaw.candidateGitSha !== contextRaw.expectedCandidateGitSha) errors.push('CANDIDATE_BINDING_MISMATCH');
  if (manifest === null || typeof manifest !== 'object') return [...errors, 'CAPABILITY_BINDING_UNAVAILABLE'];
  if (manifest.vendorId !== contextRaw.expectedVendorId) errors.push('VENDOR_BINDING_MISMATCH');
  if (manifest.adapterId !== contextRaw.expectedAdapterId) errors.push('ADAPTER_BINDING_MISMATCH');
  if (manifest.adapterVersion !== contextRaw.expectedAdapterVersion) errors.push('ADAPTER_VERSION_BINDING_MISMATCH');
  if (packageRaw.independentVerifierId !== contextRaw.expectedVerifierId) errors.push('VERIFIER_BINDING_MISMATCH');

  if (typeof packageRaw.environment === 'string'
    && typeof contextRaw.maximumEnvironment === 'string'
    && ENVIRONMENT_SET.has(packageRaw.environment)
    && ENVIRONMENT_SET.has(contextRaw.maximumEnvironment)) {
    if (environmentRank(packageRaw.environment as AdapterCertificationEnvironment)
      > environmentRank(contextRaw.maximumEnvironment as AdapterCertificationEnvironment)) {
      errors.push('ENVIRONMENT_EXCEEDS_AUTHORIZED_SCOPE');
    }
  }

  const trustedNow = typeof contextRaw.trustedNow === 'string' ? Date.parse(contextRaw.trustedNow) : Number.NaN;
  const testedAt = typeof packageRaw.testedAt === 'string' ? Date.parse(packageRaw.testedAt) : Number.NaN;
  if (Number.isFinite(trustedNow) && Number.isFinite(testedAt) && testedAt > trustedNow + 60_000) {
    errors.push('CERTIFICATION_TIME_FROM_FUTURE');
  }
  return errors;
}

function environmentRank(value: AdapterCertificationEnvironment): number {
  return ENVIRONMENT_RANK[value];
}

function result(
  value: AdapterCertificationPackage,
  receipts: readonly TrustedAdapterControlReceipt[],
  decision: AdapterCertificationDecision,
  passedControls: readonly AdapterCertificationControlId[],
  failedControls: readonly AdapterCertificationControlId[],
  untestedControls: readonly AdapterCertificationControlId[],
  reasonCodes: readonly string[],
): AdapterCertificationEvaluation {
  const raw = value as unknown as Record<string, unknown> | null;
  const manifest = raw !== null && typeof raw === 'object' && raw.capabilityManifest !== null && typeof raw.capabilityManifest === 'object'
    ? raw.capabilityManifest as Record<string, unknown>
    : {};
  const environment = raw !== null && typeof raw === 'object' && typeof raw.environment === 'string' && ENVIRONMENT_SET.has(raw.environment)
    ? raw.environment as AdapterCertificationEnvironment
    : 'SIMULATION';
  return {
    decision,
    vendorId: typeof manifest.vendorId === 'string' ? manifest.vendorId : 'INVALID_VENDOR',
    adapterId: typeof manifest.adapterId === 'string' ? manifest.adapterId : 'INVALID_ADAPTER',
    adapterVersion: typeof manifest.adapterVersion === 'string' ? manifest.adapterVersion : 'INVALID_VERSION',
    environment,
    passedControls: [...passedControls].sort(),
    failedControls: [...failedControls].sort(),
    untestedControls: [...untestedControls].sort(),
    reasonCodes: [...new Set(reasonCodes)].sort(),
    evidenceSetDigest: certificationEvidenceDigest(value, receipts),
    activationAuthorized: false,
    liveIntegrationAuthorized: false,
    publicRoadAuthorized: false,
    authority: 'NONE',
  };
}

function certificationEvidenceDigest(
  value: AdapterCertificationPackage,
  receipts: readonly TrustedAdapterControlReceipt[],
): string {
  return createHash('sha256').update(stableStringify({ package: value, receipts: [...receipts] })).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}
