import type {
  FieldCompanionBattery,
  FieldCompanionIdFactory,
  FieldCompanionLocationQuality,
  FieldCompanionMotion,
  FieldCompanionNetwork
} from './field-companion.js';
import { BrowserFieldCompanionStorage, FieldSafetyCompanionController } from './field-companion.js';
import { clearLegacyUnscopedMobileStorage, createBrowserGateway, resolveDeviceRegistrationOperation, resolveMobileResourceIdentifiers, resolveMobileStorageSubjectId, scopedMobileStorageKey, type MobileBrowserGatewaySelection } from './browser-runtime.js';
import { MobileMvpAuthenticationError, MobileMvpDeviceRegistrationRequiredError, MobileMvpResponseError, ROS_MOBILE_APP_VERSION, registerConsentedDevice, submitMobileIncidentJourney, type HttpFieldCompanionGateway, type NearbyNotification } from './mvp-http-gateway.js';
import { renderFieldCompanion, type MobileMvpRenderState } from './render.js';

declare global {
  interface Window {
    /** Set by the authenticated host. The token is consumed in memory and is never persisted by this app. */
    __ROS_MOBILE_RUNTIME__?: {
      readonly getAccessToken?: () => string | null;
      readonly accessToken?: string;
      /** Stable OIDC subject used only to isolate this browser's local state. */
      readonly subjectId?: string;
      readonly caseId?: string;
      readonly sessionId?: string;
      readonly deviceId?: string;
      /** Display/correlation only; the server derives trusted scope from OIDC. */
      readonly tenantId?: string;
    };
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Field companion root is missing');
const appRoot: HTMLElement = root;
const storage = new BrowserFieldCompanionStorage();
const ids: FieldCompanionIdFactory = { create: (prefix) => `${prefix}-${crypto.randomUUID()}` };
const hostRuntime = window.__ROS_MOBILE_RUNTIME__;
let storageSubjectId: string;
let caseId: string;
let sessionId: string;
let deviceId: string;
const tenantId = hostRuntime?.tenantId ?? document.documentElement.dataset.tenantId ?? 'tenant-local-resource';
let storageKey: string;
const accessToken = hostRuntime?.getAccessToken ?? (() => hostRuntime?.accessToken ?? null);
let selection: MobileBrowserGatewaySelection;
let controller: FieldSafetyCompanionController;
let appInstanceId: string;
let pollingTimer: ReturnType<typeof setInterval> | null = null;
let mvpState: MobileMvpRenderState = { enabled: false, busy: false, statusCode: 'READY', errorCode: null, notifications: [] };

async function start(): Promise<void> {
  try {
    selection = createBrowserGateway({
      accessToken,
      ...(document.documentElement.dataset.mobileMode === undefined ? {} : { configuredMode: document.documentElement.dataset.mobileMode }),
      ...(document.documentElement.dataset.apiBase === undefined ? {} : { apiBaseUrl: document.documentElement.dataset.apiBase })
    });
    storageSubjectId = resolveMobileStorageSubjectId(selection.mode, hostRuntime?.subjectId);
    const fieldStateStorageKey = document.documentElement.dataset.storageKey ?? 'ros-eye-field-companion-mvp';
    clearLegacyUnscopedMobileStorage(localStorage, fieldStateStorageKey);
    const resourceIds = resolveMobileResourceIdentifiers({
      storage: localStorage,
      storageSubjectId,
      ...(hostRuntime?.caseId === undefined ? {} : { hostCaseId: hostRuntime.caseId }),
      ...(hostRuntime?.sessionId === undefined ? {} : { hostSessionId: hostRuntime.sessionId }),
      ...(hostRuntime?.deviceId === undefined ? {} : { hostDeviceId: hostRuntime.deviceId })
    });
    caseId = resourceIds.caseId;
    sessionId = resourceIds.sessionId;
    deviceId = resourceIds.deviceId;
    appInstanceId = deviceId;
    storageKey = scopedMobileStorageKey(fieldStateStorageKey, storageSubjectId);
    mvpState = { ...mvpState, enabled: selection.mode === 'MVP' };
    controller = createController();
    await boot();
  } catch (error) {
    renderFatal(error);
  }
}

function createController(): FieldSafetyCompanionController {
  return new FieldSafetyCompanionController(storage, selection.gateway, ids, storageKey);
}

async function boot(): Promise<void> {
  await controller.boot({ tenantId, caseId, sessionId, language: 'ar', appInstanceId, now: new Date().toISOString() });
  if (selection.mode === 'MVP' && controller.state.session.consent === 'GRANTED') await ensureDeviceRegistration(selection.gateway);
  paint();
}

function paint(): void {
  appRoot.innerHTML = renderFieldCompanion(controller.state, mvpState);
  appRoot.querySelectorAll<HTMLButtonElement>('[data-consent]').forEach((button) => button.addEventListener('click', () => { void run(async () => {
    const decision = button.dataset.consent === 'GRANTED' ? 'GRANTED' : 'DECLINED';
    await controller.setConsent(decision);
    if (decision === 'GRANTED' && selection.mode === 'MVP') await ensureDeviceRegistration(selection.gateway);
  }); }));
  appRoot.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => button.addEventListener('click', () => { void run(() => controller.selectLanguage(button.dataset.language === 'en' ? 'en' : 'ar')); }));
  appRoot.querySelector<HTMLFormElement>('#reply-form')?.addEventListener('submit', (event) => { void submitReply(event); });
  appRoot.querySelector<HTMLButtonElement>('#share-device')?.addEventListener('click', () => { void run(() => controller.shareDeviceMetadata()); });
  appRoot.querySelector<HTMLButtonElement>('#reconnect')?.addEventListener('click', () => { void run(() => controller.reconnect()); });
  appRoot.querySelector<HTMLSelectElement>('#network-control')?.addEventListener('change', (event) => { void updateNetwork((event.currentTarget as HTMLSelectElement).value); });
  appRoot.querySelector<HTMLSelectElement>('#battery-control')?.addEventListener('change', (event) => { void updateBattery((event.currentTarget as HTMLSelectElement).value); });
  appRoot.querySelector<HTMLSelectElement>('#motion-control')?.addEventListener('change', (event) => { void updateMotion((event.currentTarget as HTMLSelectElement).value); });
  appRoot.querySelector<HTMLSelectElement>('#location-control')?.addEventListener('change', (event) => { void updateLocation((event.currentTarget as HTMLSelectElement).value); });
  appRoot.querySelector<HTMLInputElement>('#clock-control')?.addEventListener('change', (event) => { void run(() => controller.updateDevice({ clockSkewMs: Number((event.currentTarget as HTMLInputElement).value) })); });
  appRoot.querySelector<HTMLButtonElement>('#simulate-restart')?.addEventListener('click', () => { void restart(); });
  appRoot.querySelector<HTMLButtonElement>('#simulate-takeover')?.addEventListener('click', () => { void run(() => controller.receiveOperatorTakeover()); });
  appRoot.querySelector<HTMLButtonElement>('#poll-nearby')?.addEventListener('click', () => { void beginNearbyPolling(); });
  appRoot.querySelector<HTMLButtonElement>('#report-incident')?.addEventListener('click', () => { void reportIncident(); });
  appRoot.querySelectorAll<HTMLButtonElement>('[data-ack-notification]').forEach((button) => button.addEventListener('click', () => {
    const notificationId = button.dataset.ackNotification;
    if (notificationId !== undefined) void acknowledge(notificationId);
  }));
}

async function submitReply(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const selected = [...new FormData(event.currentTarget as HTMLFormElement).getAll('reply')].map(String) as Parameters<FieldSafetyCompanionController['respond']>[0];
  await run(() => controller.respond(selected));
}

async function restart(): Promise<void> {
  controller = createController();
  await boot();
}

async function beginNearbyPolling(): Promise<void> {
  if (pollingTimer !== null) clearInterval(pollingTimer);
  await pollNearby();
  if (mvpState.errorCode === null) {
    pollingTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && controller.state.session.consent === 'GRANTED') void pollNearby();
    }, 30_000);
  }
}

async function pollNearby(): Promise<void> {
  const gateway = requireHttpGateway();
  requireConsent();
  setMvp({ busy: true, statusCode: 'LOCATING', errorCode: null });
  try {
    await ensureDeviceRegistration(gateway);
    const location = await currentLocation();
    setMvp({ statusCode: 'POLLING' });
    const page = await gateway.nearby({ latitude: location.latitude, longitude: location.longitude, radiusMeters: notificationRadius() });
    setMvp({ busy: false, statusCode: 'NEARBY_UPDATED', errorCode: null, notifications: page.items });
  } catch (error) {
    setMvp({ busy: false, errorCode: errorCode(error) });
  }
}

async function acknowledge(notificationId: string): Promise<void> {
  const gateway = requireHttpGateway();
  requireConsent();
  setMvp({ busy: true, statusCode: 'ACKNOWLEDGING', errorCode: null });
  try {
    const idempotencyKey = `mobile-ack-${notificationId}`;
    const receipt = await gateway.acknowledgeNotification(notificationId, idempotencyKey.slice(0, 128));
    const notifications: NearbyNotification[] = mvpState.notifications.map((item) => item.id === receipt.notificationId ? { ...item, acknowledgedAt: receipt.acknowledgedAt } : item);
    setMvp({ busy: false, statusCode: 'ACKNOWLEDGED', errorCode: null, notifications });
  } catch (error) {
    setMvp({ busy: false, errorCode: errorCode(error) });
  }
}

async function reportIncident(): Promise<void> {
  const gateway = requireHttpGateway();
  requireConsent();
  setMvp({ busy: true, statusCode: 'LOCATING', errorCode: null });
  try {
    const location = await currentLocation();
    const consentOccurredAt = controller.state.session.consentOccurredAt;
    if (controller.state.session.consent !== 'GRANTED' || consentOccurredAt === null) throw new Error('CONSENT_REQUIRED');
    const registration = resolveDeviceRegistrationOperation({ storage: localStorage, storageSubjectId, deviceId, appVersion: ROS_MOBILE_APP_VERSION, consentOccurredAt });
    const roadEventId = caseId;
    const signalId = await deterministicUuid(`${tenantId}|${caseId}|${sessionId}|mobile-signal`);
    const occurredAt = controller.state.device.observedAt;
    setMvp({ statusCode: 'REPORTING' });
    const result = await submitMobileIncidentJourney({
      gateway, caseId: roadEventId, sessionId, deviceId, registrationOperationId: registration.operationId, appVersion: ROS_MOBILE_APP_VERSION,
      consent: { decision: 'GRANTED', occurredAt: consentOccurredAt }, signalId, language: controller.state.session.language,
      occurredAt, latitude: location.latitude, longitude: location.longitude,
      flushPending: () => controller.flush()
    });
    setMvp({ busy: false, statusCode: result.pendingOperationCount === 0 ? 'INCIDENT_REPORTED' : 'INCIDENT_REPORTED_PENDING_SYNC', errorCode: null });
  } catch (error) {
    setMvp({ busy: false, errorCode: errorCode(error) });
  }
}

async function currentLocation(): Promise<{ readonly latitude: number; readonly longitude: number }> {
  if (navigator.geolocation === undefined) throw new Error('LOCATION_DENIED');
  return await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
    () => reject(new Error('LOCATION_DENIED')),
    { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 }
  ));
}

async function deterministicUuid(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireHttpGateway(): HttpFieldCompanionGateway {
  if (selection.mode !== 'MVP') throw new MobileMvpAuthenticationError('Authenticated ROS session is required');
  return selection.gateway;
}

function requireConsent(): void {
  if (controller.state.session.consent !== 'GRANTED') throw new Error('CONSENT_REQUIRED');
}

async function ensureDeviceRegistration(gateway: HttpFieldCompanionGateway): Promise<void> {
  requireConsent();
  const consentOccurredAt = controller.state.session.consentOccurredAt;
  if (consentOccurredAt === null) throw new Error('CONSENT_REQUIRED');
  const operation = resolveDeviceRegistrationOperation({ storage: localStorage, storageSubjectId, deviceId, appVersion: ROS_MOBILE_APP_VERSION, consentOccurredAt });
  await registerConsentedDevice({
    gateway, deviceId, registrationOperationId: operation.operationId, appVersion: ROS_MOBILE_APP_VERSION,
    consent: { decision: 'GRANTED', occurredAt: consentOccurredAt }
  });
}

function setMvp(update: Partial<MobileMvpRenderState>): void {
  mvpState = { ...mvpState, ...update };
  paint();
}

async function updateNetwork(value: string): Promise<void> { if (isNetwork(value)) await run(() => controller.updateDevice({ network: value })); }
async function updateBattery(value: string): Promise<void> { if (isBattery(value)) await run(() => controller.updateDevice({ battery: value })); }
async function updateMotion(value: string): Promise<void> { if (isMotion(value)) await run(() => controller.updateDevice({ motion: value })); }
async function updateLocation(value: string): Promise<void> { if (isLocation(value)) await run(() => controller.updateDevice({ locationQuality: value })); }

async function run(action: () => Promise<unknown>): Promise<void> {
  try { await action(); } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء'); }
  paint();
}

function renderFatal(error: unknown): void {
  const code = errorCode(error);
  const message = code === 'AUTH_REQUIRED' ? 'يلزم تسجيل دخول موثق لبدء تطبيق ROS. لم يتم تشغيل وضع المحاكاة تلقائيًا.' : 'تعذر بدء التطبيق بصورة آمنة.';
  appRoot.innerHTML = `<main id="main-content"><div class="alert warning" role="alert"><strong>${message}</strong></div></main>`;
}

function errorCode(error: unknown): string {
  if (error instanceof MobileMvpAuthenticationError) return 'AUTH_REQUIRED';
  if (error instanceof MobileMvpDeviceRegistrationRequiredError) return 'DEVICE_REGISTRATION_REQUIRED';
  if (error instanceof MobileMvpResponseError) return error.code;
  if (error instanceof Error && error.message === 'LOCATION_DENIED') return 'LOCATION_DENIED';
  return 'UNKNOWN';
}

function notificationRadius(): number {
  const value = Number(document.documentElement.dataset.notificationRadiusMeters ?? '5000');
  return Number.isFinite(value) && value >= 50 && value <= 50_000 ? value : 5000;
}

function isNetwork(value: string): value is FieldCompanionNetwork { return ['ONLINE', 'DEGRADED', 'OFFLINE'].includes(value); }
function isBattery(value: string): value is FieldCompanionBattery { return ['NORMAL', 'LOW', 'CRITICAL'].includes(value); }
function isMotion(value: string): value is FieldCompanionMotion { return ['STABLE', 'HARD_BRAKE', 'POSSIBLE_IMPACT', 'POSSIBLE_ROLLOVER'].includes(value); }
function isLocation(value: string): value is FieldCompanionLocationQuality { return ['PRECISE_AVAILABLE_RESTRICTED', 'APPROXIMATE', 'UNAVAILABLE'].includes(value); }

void start();
