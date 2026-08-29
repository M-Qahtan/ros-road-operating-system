import { SimulatedFieldCompanionGateway } from './field-companion.js';
import {
  HttpFieldCompanionGateway,
  DEVICE_REGISTRATION_CONSENT_POLICY_VERSION,
  MobileMvpAuthenticationError,
  type MobileFetch
} from './mvp-http-gateway.js';

export type MobileBrowserMode = 'MVP' | 'SIMULATION';
export const MOBILE_RESOURCE_IDS_STORAGE_KEY = 'ros-eye.mobile-resource-identifiers.v1';
export const MOBILE_DEVICE_REGISTRATION_STORAGE_KEY = 'ros-eye.mobile-device-registration-operation.v1';
export const MOBILE_SIMULATION_STORAGE_SUBJECT_ID = '00000000-0000-4000-8000-000000000000';

export interface MobileResourceIdentifiers {
  readonly caseId: string;
  readonly sessionId: string;
  readonly deviceId: string;
}

export interface MobileResourceIdentifierStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface MobileDeviceRegistrationOperation {
  readonly operationId: string;
  readonly fingerprint: string;
}

export interface MobileBrowserRuntimeInput {
  readonly configuredMode?: string;
  readonly apiBaseUrl?: string;
  readonly accessToken: () => string | null;
  readonly fetcher?: MobileFetch;
}

export type MobileBrowserGatewaySelection =
  | { readonly mode: 'MVP'; readonly gateway: HttpFieldCompanionGateway }
  | { readonly mode: 'SIMULATION'; readonly gateway: SimulatedFieldCompanionGateway };

/** Persist resource correlation only. These UUIDs never grant tenant, purpose, role or actor authority. */
export function resolveMobileResourceIdentifiers(input: {
  readonly storage: MobileResourceIdentifierStorage;
  readonly storageSubjectId: string;
  readonly hostCaseId?: string;
  readonly hostSessionId?: string;
  readonly hostDeviceId?: string;
  readonly createUuid?: () => string;
}): MobileResourceIdentifiers {
  if (input.hostCaseId !== undefined && !uuid(input.hostCaseId)) throw new TypeError('Authenticated host caseId must be a UUID');
  if (input.hostSessionId !== undefined && !uuid(input.hostSessionId)) throw new TypeError('Authenticated host sessionId must be a UUID');
  if (input.hostDeviceId !== undefined && !uuid(input.hostDeviceId)) throw new TypeError('Authenticated host deviceId must be a UUID');
  const storageKey = scopedMobileStorageKey(MOBILE_RESOURCE_IDS_STORAGE_KEY, input.storageSubjectId);
  const persisted = readPersistedResourceIds(input.storage, storageKey);
  const createUuid = input.createUuid ?? (() => crypto.randomUUID());
  const caseId = input.hostCaseId ?? persisted?.caseId ?? createUuid();
  const sessionId = input.hostSessionId ?? persisted?.sessionId ?? createUuid();
  const deviceId = input.hostDeviceId ?? persisted?.deviceId ?? createUuid();
  if (!uuid(caseId) || !uuid(sessionId) || !uuid(deviceId)) throw new TypeError('Generated mobile resource identifiers must be UUIDs');
  const resolved = { caseId, sessionId, deviceId } as const;
  input.storage.setItem(storageKey, JSON.stringify(resolved));
  return resolved;
}

/** Reuses an operation UUID only while the exact device, version and consent evidence are unchanged. */
export function resolveDeviceRegistrationOperation(input: {
  readonly storage: MobileResourceIdentifierStorage;
  readonly storageSubjectId: string;
  readonly deviceId: string;
  readonly appVersion: string;
  readonly consentOccurredAt: string;
  readonly createUuid?: () => string;
}): MobileDeviceRegistrationOperation {
  if (!uuid(input.deviceId) || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(input.appVersion) || !Number.isFinite(Date.parse(input.consentOccurredAt))) {
    throw new TypeError('Device registration operation input is invalid');
  }
  const fingerprint = JSON.stringify({
    deviceId: input.deviceId,
    appVersion: input.appVersion,
    consentPolicyVersion: DEVICE_REGISTRATION_CONSENT_POLICY_VERSION,
    consentOccurredAt: new Date(input.consentOccurredAt).toISOString()
  });
  const storageKey = scopedMobileStorageKey(MOBILE_DEVICE_REGISTRATION_STORAGE_KEY, input.storageSubjectId);
  const persisted = readRegistrationOperation(input.storage, storageKey);
  if (persisted !== null && persisted.fingerprint === fingerprint) return persisted;
  const operationId = (input.createUuid ?? (() => crypto.randomUUID()))();
  if (!uuid(operationId)) throw new TypeError('Device registration operation id must be a UUID');
  const operation = { operationId, fingerprint } as const;
  input.storage.setItem(storageKey, JSON.stringify(operation));
  return operation;
}

export function resolveMobileStorageSubjectId(mode: MobileBrowserMode, subjectId?: string): string {
  if (mode === 'SIMULATION') return MOBILE_SIMULATION_STORAGE_SUBJECT_ID;
  if (!uuid(subjectId)) throw new MobileMvpAuthenticationError('Authenticated ROS subject is required');
  return subjectId.toLowerCase();
}

export function scopedMobileStorageKey(baseKey: string, subjectId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(baseKey) || !uuid(subjectId)) {
    throw new TypeError('Mobile storage scope is invalid');
  }
  return `${baseKey}.${subjectId.toLowerCase()}`;
}

export function clearLegacyUnscopedMobileStorage(storage: MobileResourceIdentifierStorage, fieldStateKey: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(fieldStateKey)) throw new TypeError('Mobile storage key is invalid');
  storage.removeItem?.(MOBILE_RESOURCE_IDS_STORAGE_KEY);
  storage.removeItem?.(MOBILE_DEVICE_REGISTRATION_STORAGE_KEY);
  storage.removeItem?.(fieldStateKey);
}

/** Defaults to authenticated HTTP. Simulation is available only by an exact opt-in. */
export function createBrowserGateway(input: MobileBrowserRuntimeInput): MobileBrowserGatewaySelection {
  if (input.configuredMode?.trim().toLowerCase() === 'simulation') {
    return { mode: 'SIMULATION', gateway: new SimulatedFieldCompanionGateway() };
  }
  const token = input.accessToken();
  if (token === null || token.trim() === '') throw new MobileMvpAuthenticationError('Authenticated ROS session is required');
  return {
    mode: 'MVP',
    gateway: new HttpFieldCompanionGateway({
      apiBaseUrl: input.apiBaseUrl ?? '',
      accessToken: input.accessToken,
      ...(input.fetcher === undefined ? {} : { fetcher: input.fetcher })
    })
  };
}

function readPersistedResourceIds(storage: MobileResourceIdentifierStorage, storageKey: string): MobileResourceIdentifiers | null {
  const serialized = storage.getItem(storageKey);
  if (serialized === null) return null;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['caseId', 'sessionId', 'deviceId'].includes(key)) || !uuid(record.caseId) || !uuid(record.sessionId) || !uuid(record.deviceId)) return null;
    return { caseId: record.caseId, sessionId: record.sessionId, deviceId: record.deviceId };
  } catch { return null; }
}

function readRegistrationOperation(storage: MobileResourceIdentifierStorage, storageKey: string): MobileDeviceRegistrationOperation | null {
  const serialized = storage.getItem(storageKey);
  if (serialized === null) return null;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['operationId', 'fingerprint'].includes(key)) || !uuid(record.operationId) || typeof record.fingerprint !== 'string') return null;
    return { operationId: record.operationId, fingerprint: record.fingerprint };
  } catch { return null; }
}

function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
