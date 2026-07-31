import type { HumanSafetyActorRole } from '@ros/contracts';
import { HumanSafetyCommandCenterController, type CommandCenterFilter } from './human-safety-command-center.js';
import { HttpHumanSafetyCommandCenterGateway, SimulatedHumanSafetyCommandCenterGateway } from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';

const rootElement = document.querySelector<HTMLElement>('#app');
if (rootElement === null) throw new Error('Command center root is missing');
const appRoot: HTMLElement = rootElement;
const roles = (document.documentElement.dataset.roles ?? 'OPERATOR').split(',').map((role) => role.trim()).filter((role): role is HumanSafetyActorRole => isRole(role));
const actorId = document.documentElement.dataset.actorId ?? 'operator-simulation';
const mode = document.documentElement.dataset.rosEyeMode ?? 'simulation';
const gateway = mode === 'http'
  ? new HttpHumanSafetyCommandCenterGateway(document.documentElement.dataset.apiBase ?? '', actorId, roles)
  : new SimulatedHumanSafetyCommandCenterGateway();
const controller = new HumanSafetyCommandCenterController(gateway, { actorId, roles });

function paint(): void {
  controller.refreshStaleness();
  appRoot.innerHTML = renderHumanSafetyCommandCenter(controller.state, controller, new Date());
  appRoot.querySelector('#refresh-button')?.addEventListener('click', () => { void reload(); });
  appRoot.querySelector<HTMLSelectElement>('#case-filter')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isFilter(value)) controller.setFilter(value);
    paint();
  });
  appRoot.querySelectorAll<HTMLElement>('[data-case-id]').forEach((button) => button.addEventListener('click', () => { void select(button.dataset.caseId ?? ''); }));
  appRoot.querySelector<HTMLFormElement>('#takeover-form')?.addEventListener('submit', (event) => { void takeover(event); });
  appRoot.querySelector<HTMLFormElement>('#escalate-form')?.addEventListener('submit', (event) => { void escalate(event); });
  appRoot.querySelector<HTMLFormElement>('#reassign-form')?.addEventListener('submit', (event) => { void reassign(event); });
  appRoot.querySelector<HTMLFormElement>('#resolution-form')?.addEventListener('submit', (event) => { void authorizeResolution(event); });
}

async function reload(): Promise<void> { await controller.load(); paint(); }
async function select(caseId: string): Promise<void> { await controller.select(caseId); paint(); }
async function takeover(event: SubmitEvent): Promise<void> { event.preventDefault(); const reason = field(event, 'takeover-reason'); if (!window.confirm('سيتم إيقاف الأتمتة المتعارضة وإسناد التواصل إلى المشغل. هل تريد المتابعة؟')) return; await runAction(() => controller.takeover(reason, crypto.randomUUID(), traceId())); }
async function escalate(event: SubmitEvent): Promise<void> { event.preventDefault(); const reason = field(event, 'escalate-reason'); if (!window.confirm('سيتم تصعيد الحالة للمراجعة البشرية العليا دون إرسال جهة حقيقية. هل تريد المتابعة؟')) return; await runAction(() => controller.escalate(reason, crypto.randomUUID(), traceId())); }
async function reassign(event: SubmitEvent): Promise<void> { event.preventDefault(); const assigneeId = field(event, 'assigneeId'); const reason = field(event, 'reassign-reason'); if (!window.confirm(`سيتم إسناد الحالة إلى ${assigneeId}. هل تريد المتابعة؟`)) return; await runAction(() => controller.reassign(assigneeId, reason, crypto.randomUUID(), traceId())); }
async function authorizeResolution(event: SubmitEvent): Promise<void> { event.preventDefault(); const reason = field(event, 'resolution-reason'); if (!window.confirm('هذا تفويض بشري عالي الخطورة وسيُسجل في سجل تدقيق غير قابل للتعديل. هل تريد المتابعة؟')) return; await runAction(() => controller.authorizeResolution(reason, crypto.randomUUID(), traceId())); }
async function runAction(action: () => Promise<unknown>): Promise<void> { try { await action(); } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء'); } paint(); }
function field(event: SubmitEvent, name: string): string { return String(new FormData(event.currentTarget as HTMLFormElement).get(name) ?? ''); }
function traceId(): string { return `dashboard-${crypto.randomUUID()}`; }
function isRole(value: string): value is HumanSafetyActorRole { return ['SYSTEM', 'OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD', 'AUDITOR', 'SIMULATED_CHANNEL'].includes(value); }
function isFilter(value: string): value is CommandCenterFilter { return ['ALL', 'URGENT', 'UNASSIGNED', 'MY_CASES'].includes(value); }

void reload();
setInterval(() => paint(), 5000);
