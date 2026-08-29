import type {
  ApiEnvelope,
  AttachSignalRequest,
  CreateRoadEventRequest,
  HumanContactState,
  RoadEventResponse
} from '@ros/contracts';
import type {
  FieldCompanionDeliveryReceipt,
  FieldCompanionGateway,
  FieldCompanionQueuedOperation
} from './field-companion.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
export const ROS_MOBILE_APP_VERSION = '0.1.0' as const;
export const DEVICE_REGISTRATION_CONSENT_POLICY_VERSION = 'ros-field-companion-device-registration-consent/v1' as const;
const CONTACT_STATES = new Set<HumanContactState>([
  'CREATED', 'CONSENT_PENDING', 'LANGUAGE_SELECTION', 'CONTACTING',
  'AWAITING_RESPONSE', 'PARTIAL_RESPONSE', 'RESPONSE_CONFIRMED',
  'DISCONNECTED', 'NO_RESPONSE', 'UNREACHABLE', 'OPERATOR_TAKEOVER',
  'HUMAN_REVIEW', 'ESCALATED', 'COMPLETED'
]);

export interface NearbyNotification {
  readonly id: string;
  readonly roadEventId: string;
  readonly severity: 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
  readonly distanceMeters: number;
  readonly occurredAt: string;
  readonly acknowledgedAt: string | null;
}

export interface NearbyNotificationPage {
  readonly items: readonly NearbyNotification[];
  readonly generatedAt: string;
}

export interface NotificationAcknowledgement {
  readonly notificationId: string;
  readonly acknowledgedAt: string;
}

export interface ContactSessionOpenReceipt {
  readonly caseId: string;
  readonly sessionId: string;
  readonly disposition: string;
}

export interface DeviceRegistrationReceipt {
  readonly deviceId: string;
  readonly disposition: 'REGISTERED' | 'IDEMPOTENT';
  readonly registeredAt: string;
  readonly consentGrantedAt: string;
}

export interface MobileIncidentJourneyResult {
  readonly deviceRegistration: DeviceRegistrationReceipt;
  readonly roadEvent: RoadEventResponse;
  readonly contactSession: ContactSessionOpenReceipt;
  readonly pendingOperationCount: number;
}

export type MobileFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpMobileMvpGatewayOptions {
  readonly apiBaseUrl: string;
  /** The token remains in caller-owned memory. This gateway never persists it. */
  readonly accessToken: () => string | null;
  readonly fetcher?: MobileFetch;
  readonly timeoutMs?: number;
}

export class MobileMvpAuthenticationError extends Error {
  override readonly name = 'MobileMvpAuthenticationError';
}

export class MobileMvpConsentRequiredError extends Error {
  override readonly name = 'MobileMvpConsentRequiredError';
}

export class MobileMvpDeviceRegistrationRequiredError extends Error {
  override readonly name = 'MobileMvpDeviceRegistrationRequiredError';
}

export class MobileMvpResponseError extends Error {
  override readonly name = 'MobileMvpResponseError';
  constructor(
    readonly status: number,
    readonly code: string,
    readonly traceId: string | null
  ) {
    super(`ROS API request failed (${code})`);
  }
}

export async function submitMobileIncidentJourney(input: {
  readonly gateway: Pick<HttpFieldCompanionGateway, 'registerDevice' | 'createIncidentReport' | 'attachSimulatedSignal' | 'openContactSession'>;
  readonly caseId: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly registrationOperationId: string;
  readonly appVersion: string;
  readonly consent: { readonly decision: 'GRANTED' | 'DECLINED'; readonly occurredAt: string };
  readonly signalId: string;
  readonly language: 'ar' | 'en' | 'UNKNOWN';
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly flushPending: () => Promise<{ readonly pending: readonly unknown[] }>;
}): Promise<MobileIncidentJourneyResult> {
  const deviceRegistration = await registerConsentedDevice({
    gateway: input.gateway,
    deviceId: input.deviceId,
    registrationOperationId: input.registrationOperationId,
    appVersion: input.appVersion,
    consent: input.consent
  });
  const roadEvent = await input.gateway.createIncidentReport({ id: input.caseId, occurredAt: input.occurredAt, latitude: input.latitude, longitude: input.longitude }, `mobile-incident-${input.caseId}`);
  await input.gateway.attachSimulatedSignal(input.caseId, { signalId: input.signalId, matchScore: 1, mergeReasons: ['MOBILE_USER_CONFIRMED'] }, `mobile-signal-${input.signalId}`);
  const contactSession = await input.gateway.openContactSession(input.caseId, { sessionId: input.sessionId, language: input.language, preferredChannel: 'IN_APP' }, `mobile-contact-${input.sessionId}`);
  const flushed = await input.flushPending();
  return { deviceRegistration, roadEvent, contactSession, pendingOperationCount: flushed.pending.length };
}

export async function registerConsentedDevice(input: {
  readonly gateway: Pick<HttpFieldCompanionGateway, 'registerDevice'>;
  readonly deviceId: string;
  readonly registrationOperationId: string;
  readonly appVersion: string;
  readonly consent: { readonly decision: 'GRANTED' | 'DECLINED'; readonly occurredAt: string };
}): Promise<DeviceRegistrationReceipt> {
  if (input.consent.decision !== 'GRANTED') throw new MobileMvpConsentRequiredError('Explicit consent is required before device registration');
  return await input.gateway.registerDevice({
    deviceId: input.deviceId,
    platform: 'WEB',
    appVersion: input.appVersion,
    consent: { decision: 'GRANTED', policyVersion: DEVICE_REGISTRATION_CONSENT_POLICY_VERSION, occurredAt: input.consent.occurredAt }
  }, `mobile-device-registration-${input.registrationOperationId}`);
}

/**
 * Authenticated browser adapter for the MVP API. Tenant, purpose, actor and roles
 * are intentionally absent: the API derives them from the verified OIDC principal.
 */
export class HttpFieldCompanionGateway implements FieldCompanionGateway {
  readonly simulation = false;
  private readonly fetcher: MobileFetch;
  private readonly timeoutMs: number;
  private readonly apiBaseUrl: string;
  private registeredDeviceId: string | null = null;

  constructor(private readonly options: HttpMobileMvpGatewayOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60_000) {
      throw new RangeError('Mobile API timeout must be between 100 and 60000 ms');
    }
  }

  async deliver(input: {
    readonly tenantId: string;
    readonly caseId: string;
    readonly sessionId: string;
    readonly operation: FieldCompanionQueuedOperation;
  }): Promise<FieldCompanionDeliveryReceipt> {
    const receipt = await this.request<unknown>('/api/v1/field-companion/deliveries', {
      method: 'POST',
      idempotencyKey: input.operation.idempotencyKey,
      body: { caseId: input.caseId, sessionId: input.sessionId, operation: input.operation }
    });
    return deliveryReceipt(receipt, input.operation.idempotencyKey);
  }

  async registerDevice(input: {
    readonly deviceId: string;
    readonly platform: 'WEB';
    readonly appVersion: string;
    readonly consent: { readonly decision: 'GRANTED'; readonly policyVersion: typeof DEVICE_REGISTRATION_CONSENT_POLICY_VERSION; readonly occurredAt: string };
  }, idempotencyKey: string): Promise<DeviceRegistrationReceipt> {
    requireUuid(input.deviceId, 'deviceId');
    if (input.platform !== 'WEB' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(input.appVersion) || input.consent.policyVersion !== DEVICE_REGISTRATION_CONSENT_POLICY_VERSION || !timestamp(input.consent.occurredAt)) {
      throw new TypeError('Device registration input is invalid');
    }
    requireDeviceRegistrationKey(idempotencyKey);
    if (this.registeredDeviceId !== null && this.registeredDeviceId !== input.deviceId) throw new MobileMvpDeviceRegistrationRequiredError('Gateway cannot rebind to a different device resource');
    const value = await this.request<unknown>('/api/v1/field-companion/devices/registrations', {
      method: 'POST', idempotencyKey, body: input, requiresRegisteredDevice: false
    });
    const receipt = deviceRegistrationReceipt(value, input.deviceId);
    this.registeredDeviceId = receipt.deviceId;
    return receipt;
  }

  async nearby(input: {
    readonly latitude: number;
    readonly longitude: number;
    readonly radiusMeters: number;
  }): Promise<NearbyNotificationPage> {
    validateLocation(input.latitude, input.longitude);
    if (!Number.isFinite(input.radiusMeters) || input.radiusMeters < 50 || input.radiusMeters > 50_000) {
      throw new RangeError('Notification radius must be between 50 and 50000 meters');
    }
    const query = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      radiusMeters: String(input.radiusMeters)
    });
    return nearbyPage(await this.request<unknown>(`/api/v1/notifications/nearby?${query.toString()}`, { method: 'GET' }));
  }

  async acknowledgeNotification(notificationId: string, idempotencyKey: string): Promise<NotificationAcknowledgement> {
    requireId(notificationId, 'notificationId');
    requireIdempotencyKey(idempotencyKey);
    return acknowledgement(await this.request<unknown>(
      `/api/v1/notifications/${encodeURIComponent(notificationId)}/acknowledgements`,
      { method: 'POST', idempotencyKey, body: {} }
    ), notificationId);
  }

  async createIncidentReport(request: CreateRoadEventRequest, idempotencyKey: string): Promise<RoadEventResponse> {
    requireUuid(request.id, 'roadEventId');
    validateLocation(request.latitude, request.longitude);
    requireIdempotencyKey(idempotencyKey);
    return await this.request<RoadEventResponse>('/api/v1/road-events', {
      method: 'POST', idempotencyKey, body: request
    });
  }

  async attachSimulatedSignal(roadEventId: string, request: AttachSignalRequest, idempotencyKey: string): Promise<RoadEventResponse> {
    requireUuid(roadEventId, 'roadEventId');
    requireId(request.signalId, 'signalId');
    requireIdempotencyKey(idempotencyKey);
    return await this.request<RoadEventResponse>(`/api/v1/road-events/${encodeURIComponent(roadEventId)}/signals`, {
      method: 'POST', idempotencyKey, body: request
    });
  }

  async openContactSession(roadEventId: string, input: {
    readonly sessionId: string;
    readonly language: 'ar' | 'en' | 'UNKNOWN';
    readonly preferredChannel: 'IN_APP';
  }, idempotencyKey: string): Promise<ContactSessionOpenReceipt> {
    requireUuid(roadEventId, 'roadEventId');
    requireUuid(input.sessionId, 'sessionId');
    requireIdempotencyKey(idempotencyKey);
    const value = await this.request<unknown>(`/api/v1/road-events/${encodeURIComponent(roadEventId)}/contact-sessions`, {
      method: 'POST', idempotencyKey, body: input
    });
    return contactSessionReceipt(value, roadEventId, input.sessionId);
  }

  private async request<T>(path: string, input: {
    readonly method: 'GET' | 'POST';
    readonly idempotencyKey?: string;
    readonly body?: unknown;
    readonly requiresRegisteredDevice?: boolean;
  }): Promise<T> {
    const token = bearerToken(this.options.accessToken());
    const requiresRegisteredDevice = input.requiresRegisteredDevice ?? true;
    if (requiresRegisteredDevice && this.registeredDeviceId === null) throw new MobileMvpDeviceRegistrationRequiredError('Authenticated device registration is required');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${token}`
    };
    if (input.body !== undefined) headers['content-type'] = 'application/json';
    if (requiresRegisteredDevice) headers['x-device-id'] = this.registeredDeviceId!;
    if (input.idempotencyKey !== undefined) {
      requireIdempotencyKey(input.idempotencyKey);
      headers['idempotency-key'] = input.idempotencyKey;
    }
    try {
      const response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      const envelope = await responseEnvelope(await boundedJson(response), response.status);
      if (!response.ok || !envelope.success || envelope.data === null) {
        throw new MobileMvpResponseError(response.status, envelope.error?.code ?? 'INVALID_API_RESPONSE', envelope.traceId);
      }
      return envelope.data as T;
    } catch (error) {
      if (error instanceof MobileMvpResponseError || error instanceof MobileMvpAuthenticationError) throw error;
      if (controller.signal.aborted) throw new MobileMvpResponseError(0, 'REQUEST_TIMEOUT', null);
      throw new MobileMvpResponseError(0, 'NETWORK_UNAVAILABLE', null);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0 || text.length > MAX_RESPONSE_BYTES) {
    throw new MobileMvpResponseError(response.status, 'INVALID_API_RESPONSE', null);
  }
  try { return JSON.parse(text) as unknown; } catch { throw new MobileMvpResponseError(response.status, 'INVALID_API_RESPONSE', null); }
}

async function responseEnvelope(value: unknown, status: number): Promise<ApiEnvelope<unknown>> {
  if (!record(value) || typeof value.success !== 'boolean' || !('data' in value) || !('error' in value) || typeof value.traceId !== 'string') {
    throw new MobileMvpResponseError(status, 'INVALID_API_RESPONSE', null);
  }
  if (value.error !== null && (!record(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string')) {
    throw new MobileMvpResponseError(status, 'INVALID_API_RESPONSE', value.traceId);
  }
  return value as unknown as ApiEnvelope<unknown>;
}

function deliveryReceipt(value: unknown, idempotencyKey: string): FieldCompanionDeliveryReceipt {
  if (!record(value) || value.idempotencyKey !== idempotencyKey || !['ACCEPTED', 'DUPLICATE', 'HUMAN_REVIEW', 'OPERATOR_TAKEOVER'].includes(String(value.disposition))
    || !CONTACT_STATES.has(value.contactState as HumanContactState) || typeof value.statusMessageCode !== 'string' || !timestamp(value.receivedAt)) {
    throw new MobileMvpResponseError(200, 'INVALID_DELIVERY_RECEIPT', null);
  }
  return value as unknown as FieldCompanionDeliveryReceipt;
}

function nearbyPage(value: unknown): NearbyNotificationPage {
  if (!record(value) || !Array.isArray(value.items) || !timestamp(value.generatedAt)) throw new MobileMvpResponseError(200, 'INVALID_NOTIFICATION_RESPONSE', null);
  const items = value.items.map((item) => nearbyItem(item));
  return { items, generatedAt: value.generatedAt as string };
}

function nearbyItem(value: unknown): NearbyNotification {
  if (!record(value) || !validId(value.id) || !validId(value.roadEventId) || !['S0', 'S1', 'S2', 'S3', 'S4'].includes(String(value.severity))
    || typeof value.distanceMeters !== 'number' || !Number.isFinite(value.distanceMeters) || value.distanceMeters < 0 || !timestamp(value.occurredAt)
    || (value.acknowledgedAt !== null && !timestamp(value.acknowledgedAt))) {
    throw new MobileMvpResponseError(200, 'INVALID_NOTIFICATION_RESPONSE', null);
  }
  return value as unknown as NearbyNotification;
}

function acknowledgement(value: unknown, notificationId: string): NotificationAcknowledgement {
  if (!record(value) || value.notificationId !== notificationId || !timestamp(value.acknowledgedAt)) {
    throw new MobileMvpResponseError(200, 'INVALID_ACKNOWLEDGEMENT_RESPONSE', null);
  }
  return value as unknown as NotificationAcknowledgement;
}

function contactSessionReceipt(value: unknown, caseId: string, sessionId: string): ContactSessionOpenReceipt {
  if (!record(value) || value.caseId !== caseId || value.sessionId !== sessionId || typeof value.disposition !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.disposition)) {
    throw new MobileMvpResponseError(200, 'INVALID_CONTACT_SESSION_RESPONSE', null);
  }
  return value as unknown as ContactSessionOpenReceipt;
}

function deviceRegistrationReceipt(value: unknown, deviceId: string): DeviceRegistrationReceipt {
  if (!record(value) || value.deviceId !== deviceId || !['REGISTERED', 'IDEMPOTENT'].includes(String(value.disposition)) || !timestamp(value.registeredAt) || !timestamp(value.consentGrantedAt)) {
    throw new MobileMvpResponseError(200, 'INVALID_DEVICE_REGISTRATION_RESPONSE', null);
  }
  return value as unknown as DeviceRegistrationReceipt;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (trimmed === '') return '';
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new TypeError('Mobile API base URL is invalid'); }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') throw new TypeError('Mobile API base URL is invalid');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new TypeError('Mobile API must use HTTPS outside loopback');
  return url.toString().replace(/\/$/, '');
}

function bearerToken(value: string | null): string {
  if (value === null || value.trim() === '' || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new MobileMvpAuthenticationError('Authenticated ROS session is required');
  }
  return value;
}

function validateLocation(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError('Location is outside valid coordinates');
  }
}

function requireId(value: string, field: string): void { if (!validId(value)) throw new TypeError(`${field} is invalid`); }
function requireUuid(value: string, field: string): void { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new TypeError(`${field} must be a UUID`); }
function requireIdempotencyKey(value: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) throw new TypeError('Idempotency key is invalid'); }
function requireDeviceRegistrationKey(value: string): void { if (!/^mobile-device-registration-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new TypeError('Device registration idempotency key is invalid'); }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
