import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTER_CAPABILITY_SCHEMA,
  ADAPTER_CERTIFICATION_CONTROLS,
  ADAPTER_CERTIFICATION_SCHEMA,
  type AdapterCertificationControlId,
  type AdapterCertificationEnvironment,
  type AdapterCertificationPackage,
} from '@ros/contracts';
import {
  evaluateAdapterCertification,
  type TrustedAdapterCertificationContext,
  type TrustedAdapterControlReceipt,
} from './adapter-certification.js';

const candidateSha = 'a'.repeat(40);
const verifierId = 'ros-independent-lab';

function certificationPackage(
  environment: AdapterCertificationEnvironment,
  overrides: Partial<AdapterCertificationPackage> = {},
): AdapterCertificationPackage {
  return {
    schema: ADAPTER_CERTIFICATION_SCHEMA,
    sessionId: 'cert-session-001',
    candidateGitSha: candidateSha,
    environment,
    capabilityManifest: {
      schema: ADAPTER_CAPABILITY_SCHEMA,
      vendorId: 'vendor-a',
      adapterId: 'vendor-a-lidar4d',
      adapterVersion: '1.2.0',
      sourceClasses: ['LIDAR_4D'],
      payloadKinds: ['LIDAR_4D_FRAME', 'TRACK_SET'],
      protocols: ['UDP/IP'],
      firmwareConstraints: ['firmware>=5.0.0'],
      supportsHealthReporting: true,
      supportsCalibrationMetadata: true,
      supportsProvenance: true,
      supportsPayloadHashing: true,
      authority: 'NONE',
    },
    independentVerifierId: verifierId,
    testedAt: '2026-09-12T05:00:00+03:00',
    controlEvidence: ADAPTER_CERTIFICATION_CONTROLS.map((controlId, index) => ({
      controlId,
      result: 'PASS' as const,
      evidenceManifestId: `manifest-${controlId.toLowerCase()}`,
      evidenceSha256: index.toString(16).padStart(64, '0'),
      observedAt: '2026-09-12T04:59:00+03:00',
      verifierId,
    })),
    ...overrides,
  };
}

function trustedContext(environment: AdapterCertificationEnvironment): TrustedAdapterCertificationContext {
  return {
    expectedSessionId: 'cert-session-001',
    expectedCandidateGitSha: candidateSha,
    expectedVendorId: 'vendor-a',
    expectedAdapterId: 'vendor-a-lidar4d',
    expectedAdapterVersion: '1.2.0',
    expectedVerifierId: verifierId,
    maximumEnvironment: environment,
    trustedNow: '2026-09-12T05:02:00+03:00',
  };
}

function trustedReceipts(value: AdapterCertificationPackage): TrustedAdapterControlReceipt[] {
  return value.controlEvidence.map((item) => ({
    sessionId: value.sessionId,
    candidateGitSha: value.candidateGitSha,
    adapterId: value.capabilityManifest.adapterId,
    adapterVersion: value.capabilityManifest.adapterVersion,
    controlId: item.controlId,
    evidenceManifestId: item.evidenceManifestId,
    evidenceSha256: item.evidenceSha256,
    verifierId,
    byteEvidenceVerified: true,
  }));
}

function evaluate(value: AdapterCertificationPackage, environment = value.environment) {
  return evaluateAdapterCertification({
    package: value,
    trustedContext: trustedContext(environment),
    trustedReceipts: trustedReceipts(value),
  });
}

test('all controls passing in approved sandbox yields certification without activation authority', () => {
  const result = evaluate(certificationPackage('SANDBOX'));

  assert.equal(result.decision, 'CERTIFIED');
  assert.equal(result.passedControls.length, ADAPTER_CERTIFICATION_CONTROLS.length);
  assert.equal(result.activationAuthorized, false);
  assert.equal(result.liveIntegrationAuthorized, false);
  assert.equal(result.publicRoadAuthorized, false);
  assert.equal(result.authority, 'NONE');
  assert.match(result.evidenceSetDigest, /^[a-f0-9]{64}$/);
  assert(result.reasonCodes.includes('ALL_CONTROLS_PASS_IN_APPROVED_SANDBOX'));
});

test('controlled lab can never self-promote to full certification', () => {
  const result = evaluate(certificationPackage('CONTROLLED_LAB'));

  assert.equal(result.decision, 'CERTIFIED_WITH_LIMITATIONS');
  assert(result.reasonCodes.includes('CONTROLLED_LAB_EVIDENCE_REQUIRES_SANDBOX_CONFIRMATION'));
});

test('simulation evidence remains context-only even with every control passing', () => {
  const result = evaluate(certificationPackage('SIMULATION'));

  assert.equal(result.decision, 'CONTEXT_ONLY');
  assert(result.reasonCodes.includes('SIMULATION_EVIDENCE_CANNOT_CERTIFY_LIVE_ADAPTER'));
});

test('a failed material control rejects the adapter', () => {
  const value = certificationPackage('SANDBOX');
  const controlEvidence = value.controlEvidence.map((item) => item.controlId === 'AUTHORITY_ISOLATION'
    ? { ...item, result: 'FAIL' as const }
    : item);
  const result = evaluate({ ...value, controlEvidence });

  assert.equal(result.decision, 'REJECTED');
  assert(result.failedControls.includes('AUTHORITY_ISOLATION'));
  assert(result.reasonCodes.includes('CONTROL_FAILED:AUTHORITY_ISOLATION'));
});

test('non-critical untested control yields limited certification rather than full certification', () => {
  const value = certificationPackage('SANDBOX');
  const controlEvidence = value.controlEvidence.map((item) => item.controlId === 'BACKPRESSURE'
    ? { ...item, result: 'NOT_TESTED' as const }
    : item);
  const result = evaluate({ ...value, controlEvidence });

  assert.equal(result.decision, 'CERTIFIED_WITH_LIMITATIONS');
  assert(result.untestedControls.includes('BACKPRESSURE'));
  assert(result.reasonCodes.includes('CONTROL_NOT_TESTED:BACKPRESSURE'));
});

test('forged byte verification is rejected even when TypeScript shape is bypassed', () => {
  const value = certificationPackage('SANDBOX');
  const receipts = trustedReceipts(value);
  const forged = receipts.map((receipt, index) => index === 0
    ? { ...receipt, byteEvidenceVerified: 'true' as unknown as true }
    : receipt);

  const result = evaluateAdapterCertification({
    package: value,
    trustedContext: trustedContext('SANDBOX'),
    trustedReceipts: forged,
  });

  assert.equal(result.decision, 'REJECTED');
  assert(result.reasonCodes.some((reason) => reason.startsWith('EVIDENCE_BYTES_NOT_VERIFIED:')));
});

test('trusted receipt digest mismatch rejects certification', () => {
  const value = certificationPackage('SANDBOX');
  const receipts = trustedReceipts(value);
  const target = receipts[0]!;
  const forged = [{ ...target, evidenceSha256: 'f'.repeat(64) }, ...receipts.slice(1)];

  const result = evaluateAdapterCertification({
    package: value,
    trustedContext: trustedContext('SANDBOX'),
    trustedReceipts: forged,
  });

  assert.equal(result.decision, 'REJECTED');
  assert(result.reasonCodes.includes(`RECEIPT_DIGEST_MISMATCH:${target.controlId}`));
});

test('vendor cannot act as its own independent verifier', () => {
  const base = certificationPackage('SANDBOX');
  const controlEvidence = base.controlEvidence.map((item) => ({ ...item, verifierId: 'vendor-a' }));
  const value: AdapterCertificationPackage = {
    ...base,
    independentVerifierId: 'vendor-a',
    controlEvidence,
  };
  const context = { ...trustedContext('SANDBOX'), expectedVerifierId: 'vendor-a' };
  const receipts = trustedReceipts(value).map((item) => ({ ...item, verifierId: 'vendor-a' }));

  const result = evaluateAdapterCertification({ package: value, trustedContext: context, trustedReceipts: receipts });

  assert.equal(result.decision, 'REJECTED');
  assert(result.reasonCodes.includes('VERIFIER_NOT_INDEPENDENT_FROM_VENDOR'));
});

test('future certification timestamps fail closed', () => {
  const value = certificationPackage('SANDBOX', { testedAt: '2026-09-12T06:30:00+03:00' });
  const result = evaluateAdapterCertification({
    package: value,
    trustedContext: trustedContext('SANDBOX'),
    trustedReceipts: trustedReceipts(value),
  });

  assert.equal(result.decision, 'REJECTED');
  assert(result.reasonCodes.includes('CERTIFICATION_TIME_FROM_FUTURE'));
});

test('critical current-state control not tested demotes adapter to context-only', () => {
  const value = certificationPackage('SANDBOX');
  const controlId: AdapterCertificationControlId = 'CLOCK_BEHAVIOR';
  const controlEvidence = value.controlEvidence.map((item) => item.controlId === controlId
    ? { ...item, result: 'NOT_TESTED' as const }
    : item);
  const result = evaluate({ ...value, controlEvidence });

  assert.equal(result.decision, 'CONTEXT_ONLY');
  assert(result.reasonCodes.includes(`CURRENT_STATE_CONTROL_NOT_PASS:${controlId}`));
});
