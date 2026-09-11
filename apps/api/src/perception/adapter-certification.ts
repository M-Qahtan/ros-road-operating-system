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

export function evaluateAdapterCertification(input: {
  readonly package: AdapterCertificationPackage;
  readonly trustedContext: TrustedAdapterCertificationContext;
  readonly trustedReceipts: readonly TrustedAdapterControlReceipt[];
}): AdapterCertificationEvaluation {
  const errors = [...validateAdapterCertificationPackage(input.package)];
  errors.push(...validateTrustedContext(input.trustedContext));
  errors.push(...validateExactContextBinding(input.package, input.trustedContext));

  if (errors.length > 0) {
    return result(input.package, 'REJECTED', [], [], [], [...new Set(errors)].sort());
  }

  const controls = new Map(input.package.controlEvidence.map((item) => [item.controlId, item]));
  for (const controlId of ADAPTER_CERTIFICATION_CONTROLS) {
    if (!controls.has(controlId)) errors.push(`MISSING_CONTROL_EVIDENCE:${controlId}`);
  }
  if (controls.size !== ADAPTER_CERTIFICATION_CONTROLS.length) errors.push('CONTROL_SET_NOT_EXACT');

  const receipts = new Map<string, TrustedAdapterControlReceipt>();
  for (const receipt of input.trustedReceipts) {
    const key = receipt.controlId;
    if (receipts.has(key)) errors.push(`DUPLICATE_TRUSTED_RECEIPT:${key}`);
    receipts.set(key, receipt);
  }

  for (const controlId of ADAPTER_CERTIFICATION_CONTROLS) {
    const evidence = controls.get(controlId);
    if (evidence === undefined) continue;
    const receipt = receipts.get(controlId);
    if (receipt === undefined) {
      errors.push(`MISSING_TRUSTED_RECEIPT:${controlId}`);
      continue;
    }
    if (!receipt.byteEvidenceVerified) errors.push(`EVIDENCE_BYTES_NOT_VERIFIED:${controlId}`);
    if (receipt.sessionId !== input.package.sessionId) errors.push(`RECEIPT_SESSION_MISMATCH:${controlId}`);
    if (receipt.candidateGitSha !== input.package.candidateGitSha) errors.push(`RECEIPT_CANDIDATE_MISMATCH:${controlId}`);
    if (receipt.adapterId !== input.package.capabilityManifest.adapterId) errors.push(`RECEIPT_ADAPTER_MISMATCH:${controlId}`);
    if (receipt.adapterVersion !== input.package.capabilityManifest.adapterVersion) errors.push(`RECEIPT_VERSION_MISMATCH:${controlId}`);
    if (receipt.verifierId !== input.trustedContext.expectedVerifierId) errors.push(`RECEIPT_VERIFIER_MISMATCH:${controlId}`);
    if (receipt.evidenceManifestId !== evidence.evidenceManifestId) errors.push(`RECEIPT_MANIFEST_MISMATCH:${controlId}`);
    if (receipt.evidenceSha256 !== evidence.evidenceSha256) errors.push(`RECEIPT_DIGEST_MISMATCH:${controlId}`);
  }

  if (errors.length > 0) {
    return result(input.package, 'REJECTED', [], [], [], [...new Set(errors)].sort());
  }

  const passed = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'PASS');
  const failed = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'FAIL');
  const untested = ADAPTER_CERTIFICATION_CONTROLS.filter((id) => controls.get(id)?.result === 'NOT_TESTED');
  const reasons: string[] = [];

  if (failed.length > 0) {
    reasons.push(...failed.map((id) => `CONTROL_FAILED:${id}`));
    return result(input.package, 'REJECTED', passed, failed, untested, reasons);
  }

  if (!input.package.capabilityManifest.supportsProvenance || !input.package.capabilityManifest.supportsPayloadHashing) {
    reasons.push('EVIDENCE_ASSURANCE_CAPABILITY_MISSING');
    return result(input.package, 'REJECTED', passed, failed, untested, reasons);
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
    return result(input.package, 'CONTEXT_ONLY', passed, failed, untested, reasons);
  }

  if (untested.length > 0) {
    reasons.push(...untested.map((id) => `CONTROL_NOT_TESTED:${id}`));
    return result(input.package, 'CERTIFIED_WITH_LIMITATIONS', passed, failed, untested, reasons);
  }

  if (input.package.environment === 'CONTROLLED_LAB') {
    reasons.push('CONTROLLED_LAB_EVIDENCE_REQUIRES_SANDBOX_CONFIRMATION');
    return result(input.package, 'CERTIFIED_WITH_LIMITATIONS', passed, failed, untested, reasons);
  }

  return result(input.package, 'CERTIFIED', passed, failed, untested, ['ALL_CONTROLS_PASS_IN_APPROVED_SANDBOX']);
}

function validateTrustedContext(context: TrustedAdapterCertificationContext): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(Date.parse(context.trustedNow))) errors.push('INVALID_TRUSTED_TIME');
  if (!/^[a-f0-9]{40}$/.test(context.expectedCandidateGitSha)) errors.push('INVALID_TRUSTED_CANDIDATE_SHA');
  return errors;
}

function validateExactContextBinding(
  value: AdapterCertificationPackage,
  context: TrustedAdapterCertificationContext,
): string[] {
  const errors: string[] = [];
  if (value.sessionId !== context.expectedSessionId) errors.push('SESSION_BINDING_MISMATCH');
  if (value.candidateGitSha !== context.expectedCandidateGitSha) errors.push('CANDIDATE_BINDING_MISMATCH');
  if (value.capabilityManifest.vendorId !== context.expectedVendorId) errors.push('VENDOR_BINDING_MISMATCH');
  if (value.capabilityManifest.adapterId !== context.expectedAdapterId) errors.push('ADAPTER_BINDING_MISMATCH');
  if (value.capabilityManifest.adapterVersion !== context.expectedAdapterVersion) errors.push('ADAPTER_VERSION_BINDING_MISMATCH');
  if (value.independentVerifierId !== context.expectedVerifierId) errors.push('VERIFIER_BINDING_MISMATCH');
  if (environmentRank(value.environment) > environmentRank(context.maximumEnvironment)) errors.push('ENVIRONMENT_EXCEEDS_AUTHORIZED_SCOPE');

  const trustedNow = Date.parse(context.trustedNow);
  const testedAt = Date.parse(value.testedAt);
  if (Number.isFinite(trustedNow) && Number.isFinite(testedAt) && testedAt > trustedNow + 60_000) errors.push('CERTIFICATION_TIME_FROM_FUTURE');
  return errors;
}

function environmentRank(value: AdapterCertificationEnvironment): number {
  switch (value) {
    case 'SIMULATION': return 0;
    case 'CONTROLLED_LAB': return 1;
    case 'SANDBOX': return 2;
  }
}

function result(
  value: AdapterCertificationPackage,
  decision: AdapterCertificationDecision,
  passedControls: readonly AdapterCertificationControlId[],
  failedControls: readonly AdapterCertificationControlId[],
  untestedControls: readonly AdapterCertificationControlId[],
  reasonCodes: readonly string[],
): AdapterCertificationEvaluation {
  return {
    decision,
    vendorId: value.capabilityManifest?.vendorId ?? 'INVALID_VENDOR',
    adapterId: value.capabilityManifest?.adapterId ?? 'INVALID_ADAPTER',
    adapterVersion: value.capabilityManifest?.adapterVersion ?? 'INVALID_VERSION',
    environment: value.environment ?? 'SIMULATION',
    passedControls: [...passedControls].sort(),
    failedControls: [...failedControls].sort(),
    untestedControls: [...untestedControls].sort(),
    reasonCodes: [...new Set(reasonCodes)].sort(),
    activationAuthorized: false,
    liveIntegrationAuthorized: false,
    publicRoadAuthorized: false,
    authority: 'NONE',
  };
}
