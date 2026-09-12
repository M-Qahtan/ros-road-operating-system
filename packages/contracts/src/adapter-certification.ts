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

const SENSOR_SOURCE_CLASSES = new Set<SensorSourceClass>([
  'RGB_CAMERA',
  'THERMAL_CAMERA',
  'RADAR',
  'LIDAR_3D',
  'LIDAR_4D',
  'MAGNETIC_SENSOR',
  'VEHICLE',
  'RSU',
  'WEATHER',
  'EXTERNAL_PERCEPTION_PLATFORM',
]);

const ADAPTER_PAYLOAD_KINDS = new Set<AdapterPayloadKind>([
  'RGB_FRAME',
  'THERMAL_FRAME',
  'RADAR_FRAME',
  'MAGNETIC_OBSERVATION',
  'LIDAR_4D_FRAME',
  'V2X_MESSAGE',
  'TRACK_SET',
  'ENVIRONMENT',
]);

const CERTIFICATION_ENVIRONMENTS = new Set<AdapterCertificationEnvironment>([
  'SIMULATION', 'CONTROLLED_LAB', 'SANDBOX',
]);

const CONTROL_RESULTS = new Set<AdapterCertificationControlResult>(['PASS', 'FAIL', 'NOT_TESTED']);

export function validateAdapterCapabilityManifest(value: AdapterCapabilityManifest): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_CAPABILITY_MANIFEST'];

  if (raw.schema !== ADAPTER_CAPABILITY_SCHEMA) errors.push('UNSUPPORTED_CAPABILITY_SCHEMA');
  if (!validIdentifier(raw.vendorId)) errors.push('INVALID_VENDOR_ID');
  if (!validIdentifier(raw.adapterId)) errors.push('INVALID_ADAPTER_ID');
  if (!validVersion(raw.adapterVersion)) errors.push('INVALID_ADAPTER_VERSION');

  if (!Array.isArray(raw.sourceClasses) || raw.sourceClasses.length === 0) {
    errors.push('MISSING_SOURCE_CLASS');
  } else {
    if (hasDuplicates(raw.sourceClasses)) errors.push('DUPLICATE_SOURCE_CLASS');
    if (raw.sourceClasses.some((item) => typeof item !== 'string' || !SENSOR_SOURCE_CLASSES.has(item as SensorSourceClass))) {
      errors.push('UNSUPPORTED_SOURCE_CLASS');
    }
  }

  if (!Array.isArray(raw.payloadKinds) || raw.payloadKinds.length === 0) {
    errors.push('MISSING_PAYLOAD_KIND');
  } else {
    if (hasDuplicates(raw.payloadKinds)) errors.push('DUPLICATE_PAYLOAD_KIND');
    if (raw.payloadKinds.some((item) => typeof item !== 'string' || !ADAPTER_PAYLOAD_KINDS.has(item as AdapterPayloadKind))) {
      errors.push('UNSUPPORTED_PAYLOAD_KIND');
    }
  }

  if (!Array.isArray(raw.protocols) || raw.protocols.length === 0 || raw.protocols.some((item) => !validBoundedText(item, 128))) {
    errors.push('INVALID_PROTOCOL');
  }
  if (!Array.isArray(raw.firmwareConstraints) || raw.firmwareConstraints.some((item) => !validBoundedText(item, 256))) {
    errors.push('INVALID_FIRMWARE_CONSTRAINT');
  }

  for (const key of [
    'supportsHealthReporting',
    'supportsCalibrationMetadata',
    'supportsProvenance',
    'supportsPayloadHashing',
  ] as const) {
    if (typeof raw[key] !== 'boolean') errors.push(`INVALID_CAPABILITY_BOOLEAN:${key}`);
  }

  if (raw.authority !== 'NONE') errors.push('ADAPTER_AUTHORITY_FORBIDDEN');
  return errors;
}

export function validateAdapterCertificationPackage(value: AdapterCertificationPackage): readonly string[] {
  const errors: string[] = [];
  const raw = value as unknown as Record<string, unknown> | null;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['INVALID_CERTIFICATION_PACKAGE'];

  if (raw.schema !== ADAPTER_CERTIFICATION_SCHEMA) errors.push('UNSUPPORTED_CERTIFICATION_SCHEMA');
  if (!validIdentifier(raw.sessionId)) errors.push('INVALID_SESSION_ID');
  if (typeof raw.candidateGitSha !== 'string' || !/^[a-f0-9]{40}$/.test(raw.candidateGitSha)) errors.push('INVALID_CANDIDATE_GIT_SHA');
  if (typeof raw.environment !== 'string' || !CERTIFICATION_ENVIRONMENTS.has(raw.environment as AdapterCertificationEnvironment)) {
    errors.push('INVALID_CERTIFICATION_ENVIRONMENT');
  }
  if (!validIdentifier(raw.independentVerifierId)) errors.push('INVALID_INDEPENDENT_VERIFIER_ID');
  const testedAt = typeof raw.testedAt === 'string' ? Date.parse(raw.testedAt) : Number.NaN;
  if (!Number.isFinite(testedAt)) errors.push('INVALID_TESTED_AT');

  if (raw.capabilityManifest === null || typeof raw.capabilityManifest !== 'object' || Array.isArray(raw.capabilityManifest)) {
    errors.push('INVALID_CAPABILITY_MANIFEST');
  } else {
    errors.push(...validateAdapterCapabilityManifest(raw.capabilityManifest as AdapterCapabilityManifest));
    const manifest = raw.capabilityManifest as unknown as Record<string, unknown>;
    if (typeof raw.independentVerifierId === 'string' && raw.independentVerifierId === manifest.vendorId) {
      errors.push('VERIFIER_NOT_INDEPENDENT_FROM_VENDOR');
    }
  }

  if (!Array.isArray(raw.controlEvidence)) {
    errors.push('INVALID_CONTROL_EVIDENCE');
    return errors;
  }

  const supportedControls = new Set<AdapterCertificationControlId>(ADAPTER_CERTIFICATION_CONTROLS);
  const controlIds: unknown[] = [];
  for (const rawItem of raw.controlEvidence) {
    if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      errors.push('INVALID_CONTROL_EVIDENCE_ITEM');
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    controlIds.push(item.controlId);
    if (typeof item.controlId !== 'string' || !supportedControls.has(item.controlId as AdapterCertificationControlId)) {
      errors.push('UNKNOWN_CONTROL_ID');
      continue;
    }
    const controlId = item.controlId;
    if (typeof item.result !== 'string' || !CONTROL_RESULTS.has(item.result as AdapterCertificationControlResult)) {
      errors.push(`INVALID_CONTROL_RESULT:${controlId}`);
    }
    if (!validBoundedText(item.evidenceManifestId, 256)) errors.push(`INVALID_EVIDENCE_MANIFEST:${controlId}`);
    if (typeof item.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.evidenceSha256)) {
      errors.push(`INVALID_EVIDENCE_SHA256:${controlId}`);
    }
    const observedAt = typeof item.observedAt === 'string' ? Date.parse(item.observedAt) : Number.NaN;
    if (!Number.isFinite(observedAt)) {
      errors.push(`INVALID_OBSERVED_AT:${controlId}`);
    } else if (Number.isFinite(testedAt) && observedAt > testedAt + 60_000) {
      errors.push(`CONTROL_EVIDENCE_AFTER_TEST_SESSION:${controlId}`);
    }
    if (!validIdentifier(item.verifierId)) errors.push(`INVALID_VERIFIER_ID:${controlId}`);
    if (typeof raw.independentVerifierId === 'string' && item.verifierId !== raw.independentVerifierId) {
      errors.push(`VERIFIER_BINDING_MISMATCH:${controlId}`);
    }
    if (item.notes !== undefined && (!Array.isArray(item.notes) || item.notes.some((note) => !validBoundedText(note, 512)))) {
      errors.push(`INVALID_CONTROL_NOTE:${controlId}`);
    }
  }

  if (hasDuplicates(controlIds)) errors.push('DUPLICATE_CONTROL_EVIDENCE');
  return errors;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value);
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function hasDuplicates<T>(values: readonly T[]): boolean {
  return new Set(values).size !== values.length;
}
