import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTER_CAPABILITY_SCHEMA,
  ADAPTER_CERTIFICATION_CONTROLS,
  ADAPTER_CERTIFICATION_SCHEMA,
  validateAdapterCapabilityManifest,
  validateAdapterCertificationPackage,
  type AdapterCapabilityManifest,
  type AdapterCertificationPackage,
} from './adapter-certification.js';

const digest = 'a'.repeat(64);
const candidateSha = 'b'.repeat(40);

function manifest(): AdapterCapabilityManifest {
  return {
    schema: ADAPTER_CAPABILITY_SCHEMA,
    vendorId: 'vendor-a',
    adapterId: 'adapter-lidar4d',
    adapterVersion: '1.0.0',
    sourceClasses: ['LIDAR_4D'],
    payloadKinds: ['LIDAR_4D_FRAME'],
    protocols: ['UDP/IP'],
    firmwareConstraints: [],
    supportsHealthReporting: true,
    supportsCalibrationMetadata: true,
    supportsProvenance: true,
    supportsPayloadHashing: true,
    authority: 'NONE',
  };
}

function packageValue(): AdapterCertificationPackage {
  return {
    schema: ADAPTER_CERTIFICATION_SCHEMA,
    sessionId: 'session-001',
    candidateGitSha: candidateSha,
    environment: 'SANDBOX',
    capabilityManifest: manifest(),
    independentVerifierId: 'independent-lab',
    testedAt: '2026-09-12T05:00:00+03:00',
    controlEvidence: ADAPTER_CERTIFICATION_CONTROLS.map((controlId) => ({
      controlId,
      result: 'PASS',
      evidenceManifestId: `manifest-${controlId.toLowerCase()}`,
      evidenceSha256: digest,
      observedAt: '2026-09-12T04:59:00+03:00',
      verifierId: 'independent-lab',
    })),
  };
}

test('valid adapter capability and certification package pass structural validation', () => {
  assert.deepEqual(validateAdapterCapabilityManifest(manifest()), []);
  assert.deepEqual(validateAdapterCertificationPackage(packageValue()), []);
});

test('spoofed source class fails runtime validation', () => {
  const value = {
    ...manifest(),
    sourceClasses: ['MAGIC_SENSOR'],
  } as unknown as AdapterCapabilityManifest;

  assert(validateAdapterCapabilityManifest(value).includes('UNSUPPORTED_SOURCE_CLASS'));
});

test('spoofed payload kind fails runtime validation', () => {
  const value = {
    ...manifest(),
    payloadKinds: ['OMNISCIENT_FRAME'],
  } as unknown as AdapterCapabilityManifest;

  assert(validateAdapterCapabilityManifest(value).includes('UNSUPPORTED_PAYLOAD_KIND'));
});

test('adapter authority cannot be imported through a forged manifest', () => {
  const value = {
    ...manifest(),
    authority: 'COMMAND',
  } as unknown as AdapterCapabilityManifest;

  assert(validateAdapterCapabilityManifest(value).includes('ADAPTER_AUTHORITY_FORBIDDEN'));
});

test('capability booleans must be actual booleans rather than truthy strings', () => {
  const value = {
    ...manifest(),
    supportsProvenance: 'true',
  } as unknown as AdapterCapabilityManifest;

  assert(validateAdapterCapabilityManifest(value).includes('INVALID_CAPABILITY_BOOLEAN:supportsProvenance'));
});

test('control evidence cannot claim an unknown certification control', () => {
  const base = packageValue();
  const controlEvidence = [
    ...base.controlEvidence,
    {
      ...base.controlEvidence[0]!,
      controlId: 'VENDOR_SELF_APPROVAL',
    },
  ] as unknown as AdapterCertificationPackage['controlEvidence'];
  const errors = validateAdapterCertificationPackage({ ...base, controlEvidence });

  assert(errors.includes('UNKNOWN_CONTROL_ID'));
});

test('control evidence after the declared test session fails closed', () => {
  const base = packageValue();
  const controlEvidence = base.controlEvidence.map((item, index) => index === 0
    ? { ...item, observedAt: '2026-09-12T05:10:00+03:00' }
    : item);
  const errors = validateAdapterCertificationPackage({ ...base, controlEvidence });

  assert(errors.some((error) => error.startsWith('CONTROL_EVIDENCE_AFTER_TEST_SESSION:')));
});

test('duplicate controls are rejected', () => {
  const base = packageValue();
  const controlEvidence = [...base.controlEvidence, base.controlEvidence[0]!];
  const errors = validateAdapterCertificationPackage({ ...base, controlEvidence });

  assert(errors.includes('DUPLICATE_CONTROL_EVIDENCE'));
});

test('vendor cannot declare itself as the independent verifier', () => {
  const base = packageValue();
  const controlEvidence = base.controlEvidence.map((item) => ({ ...item, verifierId: 'vendor-a' }));
  const errors = validateAdapterCertificationPackage({
    ...base,
    independentVerifierId: 'vendor-a',
    controlEvidence,
  });

  assert(errors.includes('VERIFIER_NOT_INDEPENDENT_FROM_VENDOR'));
});
