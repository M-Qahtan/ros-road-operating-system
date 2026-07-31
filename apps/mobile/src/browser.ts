import type { FieldCompanionBattery, FieldCompanionLocationQuality, FieldCompanionMotion, FieldCompanionNetwork, FieldCompanionIdFactory } from './field-companion.js';
import {
  BrowserFieldCompanionStorage,
  FieldSafetyCompanionController,
  SimulatedFieldCompanionGateway
} from './field-companion.js';
import { renderFieldCompanion } from './render.js';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Field companion root is missing');
const appRoot: HTMLElement = root;
const storage = new BrowserFieldCompanionStorage();
const gateway = new SimulatedFieldCompanionGateway();
const ids: FieldCompanionIdFactory = { create: (prefix) => `${prefix}-${crypto.randomUUID()}` };
const storageKey = document.documentElement.dataset.storageKey ?? 'ros-eye-field-companion-simulation';
let appInstanceId = `app-${crypto.randomUUID()}`;
let controller = createController();

function createController(): FieldSafetyCompanionController {
  return new FieldSafetyCompanionController(storage, gateway, ids, storageKey);
}

async function boot(): Promise<void> {
  await controller.boot({
    tenantId: document.documentElement.dataset.tenantId ?? 'tenant-riyadh-simulation',
    caseId: document.documentElement.dataset.caseId ?? 'case-field-simulation-001',
    sessionId: document.documentElement.dataset.sessionId ?? 'session-field-simulation-001',
    language: 'ar', appInstanceId, now: new Date().toISOString()
  });
  paint();
}

function paint(): void {
  appRoot.innerHTML = renderFieldCompanion(controller.state);
  appRoot.querySelectorAll<HTMLButtonElement>('[data-consent]').forEach((button) => button.addEventListener('click', () => { void run(() => controller.setConsent(button.dataset.consent === 'GRANTED' ? 'GRANTED' : 'DECLINED')); }));
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
}

async function submitReply(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const selected = [...new FormData(event.currentTarget as HTMLFormElement).getAll('reply')].map(String) as Parameters<FieldSafetyCompanionController['respond']>[0];
  await run(() => controller.respond(selected));
}

async function restart(): Promise<void> {
  appInstanceId = `app-${crypto.randomUUID()}`;
  controller = createController();
  await boot();
}

async function updateNetwork(value: string): Promise<void> { if (isNetwork(value)) await run(() => controller.updateDevice({ network: value })); }
async function updateBattery(value: string): Promise<void> { if (isBattery(value)) await run(() => controller.updateDevice({ battery: value })); }
async function updateMotion(value: string): Promise<void> { if (isMotion(value)) await run(() => controller.updateDevice({ motion: value })); }
async function updateLocation(value: string): Promise<void> { if (isLocation(value)) await run(() => controller.updateDevice({ locationQuality: value })); }

async function run(action: () => Promise<unknown>): Promise<void> {
  try { await action(); } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء'); }
  paint();
}

function isNetwork(value: string): value is FieldCompanionNetwork { return ['ONLINE', 'DEGRADED', 'OFFLINE'].includes(value); }
function isBattery(value: string): value is FieldCompanionBattery { return ['NORMAL', 'LOW', 'CRITICAL'].includes(value); }
function isMotion(value: string): value is FieldCompanionMotion { return ['STABLE', 'HARD_BRAKE', 'POSSIBLE_IMPACT', 'POSSIBLE_ROLLOVER'].includes(value); }
function isLocation(value: string): value is FieldCompanionLocationQuality { return ['PRECISE_AVAILABLE_RESTRICTED', 'APPROXIMATE', 'UNAVAILABLE'].includes(value); }

void boot();
