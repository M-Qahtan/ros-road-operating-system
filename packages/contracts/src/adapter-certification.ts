import type { SensorSourceClass } from './sensor-perception.js';

export const ADAPTER_CERTIFICATION_SCHEMA = 'ros.adapter-certification/v1' as const;
export const ADAPTER_CAPABILITY_SCHEMA = 'ros.adapter-capability/v1' as const;

export type AdapterCertificationEnvironment = 'SIMULATION' | 'CONTROLLED_LAB' | 'SANDBOX';

export type AdapterPayloadKind =
  | 'RGB_FRAME'
  | 'THERMAL_FRAME'
  | 'RADAR_FRAME'
  | 'MAGNETIC_OBSERVATION'
  | 'LIDAR_4D_FRAME'
  | 'V2X_MESSAGE'
  | 'TRACK_SET'
  | 'ENVIRONMENT';

export interface AdapterCapabilityManifest {
  readonly schema: typeof ADAPTER_CAPABILITY_SCHEMA;
  readonly vendorId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceClasses: readonly SensorSourceClass[];
  readonly payloadKinds: readonly AdapterPayloadKind[];
  readonly protocols: readonly string[];
  readonly firmwareConstraints: readonly string[];
  readonly supportsHealthReporting: boolean;
  readonly supportsCalibrationMetadata: boolean;
  readonly supportsProvenance: boolean;
  readonly supportsPayloadHashing: boolean;
  /** Adapters are evidence/data providers, never ROS authority providers. */
  readonly authority: 'NONE';
}

export type AdapterCertificationControlId =
  | 'SCHEMA_CONFORMANCE'
  | 'CLOCK_BEHAVIOR'
  | 'COORDINATE_CORRECTNESS'
  | 'CALIBRATION_METADATA'
  | 'HEALTH_REPORTING'
  | 'REPLAY_HANDLING'
  | 'DUPLICATE_HANDLING'
  | 'BACKPRESSURE'
  | 'FIRMWARE_PROVENANCE'
  | 'SOURCE_LINEAGE'
  | 'SECURITY_IDENTITY'
  | 'EVIDENCE_HASHING'
  | 'FAILURE_ISOLATION'
  | 'AUTHORITY_ISOLATION';

export const ADAPTER_CERTIFICATION_CONTROLS: readonly AdapterCertificationControlId[] = [
  'SCHEMA_CONFORMANCE',
  'CLOCK_BEHAVIOR',
  'COORDINATE_CORRECTNESS',
  'CALIBRATION_METADATA',
  'HEALTH_REPORTING',
  'REPLAY_HANDLING',
  'DUPLICATE_HANDLING',
  'BACKPRESSURE',
  'FIRMWARE_PROVENANCE',
  'SOURCE_LINEAGE',
  'SECURITY_IDENTITY',
  'EVIDENCE_HASHING',
  'FAILURE_ISOLATION',
  'AUTHORITY_ISOLATION',
] as const;

export type AdapterCertificationControlResult = 'PASS' | 'FAIL' | 'NOT_TESTED';

export interface AdapterCertificationControlEvidence {
  readonly controlId: AdapterCertificationControlId;
  readonly result: AdapterCertificationControlResult;
  readonly evidenceManifestId: string;
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly verifierId: string;
  readonly notes?: readonly string[];
}

export interface AdapterCertificationPackage {
  readonly schema: typeof ADAPTER_CERTIFICATION_SCHEMA;
  readonly sessionId: string;
  readonly candidateGitSha: string;
  readonly environment: AdapterCertificationEnvironment;
  readonly capabilityManifest: AdapterCapabilityManifest;
  readonly independentVerifierId: string;
  readonly testedAt: string;
  readonly controlEvidence: readonly AdapterCertificationControlEvidence[];
}

export function validateAdapterCapabilityManifest(value: AdapterCapabilityManifest): readonly string[] {
  const errors: string[] = [];
  if (value.schema !== ADAPTER_CAPABILITY_SCHEMA) errors.push('UNSUPPORTED_CAPABILITY_SCHEMA');
  if (!validIdentifier(value.vendorId)) errors.push('INVALID_VENDOR_ID');
  if (!validIdentifier(value.adapterId)) errors.push('INVALID_ADAPTER_ID');
  if (!validVersion(value.adapterVersion)) errors.push('INVALID_ADAPTER_VERSION');
  if (!Array.isArray(value.sourceClasses) || value.sourceClasses.length === 0) errors.push('MISSING_SOURCE_CLASS');
  if (!Array.isArray(value.payloadKinds) || value.payloadKinds.length === 0) errors.push('MISSING_PAYLOAD_KIND');
  if (hasDuplicates(value.sourceClasses)) errors.push('DUPLICATE_SOURCE_CLASS');
  if (hasDuplicates(value.payloadKinds)) errors.push('DUPLICATE_PAYLOAD_KIND');
  if (!Array.isArray(value.protocols) || value.protocols.some((item) => !validBoundedText(item, 128))) errors.push('INVALID_PROTOCOL');
  if (!Array.isArray(value.firmwareConstraints) || value.firmwareConstraints.some((item) => !validBoundedText(item, 256))) {
    errors.push('INVALID_FIRMWARE_CONSTRAINT');
  }
  if (value.authority !== 'NONE') errors.push('ADAPTER_AUTHORITY_FORBIDDEN');
  return errors;
}

export function validateAdapterCertificationPackage(value: AdapterCertificationPackage): readonly string[] {
  const errors: string[] = [];
  if (value.schema !== ADAPTER_CERTIFICATION_SCHEMA) errors.push('UNSUPPORTED_CERTIFICATION_SCHEMA');
  if (!validIdentifier(value.sessionId)) errors.push('INVALID_SESSION_ID');
  if (!/^[a-f0-9]{40}$/.test(value.candidateGitSha)) errors.push('INVALID_CANDIDATE_GIT_SHA');
  if (!['SIMULATION', 'CONTROLLED_LAB', 'SANDBOX'].includes(value.environment)) errors.push('INVALID_CERTIFICATION_ENVIRONMENT');
  if (!validIdentifier(value.independentVerifierId)) errors.push('INVALID_INDEPENDENT_VERIFIER_ID');
  if (!Number.isFinite(Date.parse(value.testedAt))) errors.push('INVALID_TESTED_AT');
  errors.push(...validateAdapterCapabilityManifest(value.capabilityManifest));
  if (value.independentVerifierId === value.capabilityManifest.vendorId) errors.push('VERIFIER_NOT_INDEPENDENT_FROM_VENDOR');

  if (!Array.isArray(value.controlEvidence)) {
    errors.push('INVALID_CONTROL_EVIDENCE');
    return errors;
  }

  const controlIds = value.controlEvidence.map((item) => item.controlId);
  if (hasDuplicates(controlIds)) errors.push('DUPLICATE_CONTROL_EVIDENCE');
  const supportedControls = new Set(ADAPTER_CERTIFICATION_CONTROLS);
  for (const item of value.controlEvidence) {
    if (!supportedControls.has(item.controlId)) errors.push('UNKNOWN_CONTROL_ID');
    if (!['PASS', 'FAIL', 'NOT_TESTED'].includes(item.result)) errors.push(`INVALID_CONTROL_RESULT:${item.controlId}`);
    if (!validBoundedText(item.evidenceManifestId, 256)) errors.push(`INVALID_EVIDENCE_MANIFEST:${item.controlId}`);
    if (!/^[a-f0-9]{64}$/.test(item.evidenceSha256)) errors.push(`INVALID_EVIDENCE_SHA256:${item.controlId}`);
    if (!Number.isFinite(Date.parse(item.observedAt))) errors.push(`INVALID_OBSERVED_AT:${item.controlId}`);
    if (!validIdentifier(item.verifierId)) errors.push(`INVALID_VERIFIER_ID:${item.controlId}`);
    if (item.verifierId !== value.independentVerifierId) errors.push(`VERIFIER_BINDING_MISMATCH:${item.controlId}`);
    if (item.notes !== undefined && (!Array.isArray(item.notes) || item.notes.some((note) => !validBoundedText(note, 512)))) {
      errors.push(`INVALID_CONTROL_NOTE:${item.controlId}`);
    }
  }

  return errors;
}

function validIdentifier(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validVersion(value: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value);
}

function validBoundedText(value: string, maxLength: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function hasDuplicates<T>(values: readonly T[]): boolean {
  return new Set(values).size !== values.length;
}
