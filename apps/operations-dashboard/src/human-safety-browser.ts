import type { HumanSafetyActorRole } from '@ros/contracts';
import { HumanSafetyCommandCenterController, type CommandCenterFilter } from './human-safety-command-center.js';
import { HttpHumanSafetyCommandCenterGateway } from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';
import {
  requireTrustedBrowserSession,
  type OperationsWindow,
  type TrustedBrowserSession
} from './trusted-browser-session.js';

const rootElement = document.querySelector<HTMLElement>('#app');
if (rootElement === null) throw new Error('Command center root is missing');

try {
  startCommandCenter(rootElement, requireTrustedBrowserSession(window as OperationsWindow));
} catch {
  renderSessionFailure(rootElement);
}

function startCommandCenter(appRoot: HTMLElement, session: TrustedBrowserSession): void {
  const roles: readonly HumanSafetyActorRole[] = session.roles;
  const gateway = new HttpHumanSafetyCommandCenterGateway(document.documentElement.dataset.apiBase ?? '', session);
  const controller = new HumanSafetyCommandCenterController(gateway, { actorId: session.actorId, roles });

  function paint(): void {
    controller.refreshStaleness();
    appRoot.innerHTML = renderHumanSafetyCommandCenter(controller.state, controller, new Date());
    appRoot.querySelector('#refresh-button')?.addEventListener('click', () => { void reload(); });
    appRoot.querySelector<HTMLSelectElement>('#case-filter')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isFilter(value)) controller.setFilter(value);
      paint();
    });
    appRoot.querySelectorAll<HTMLElement>('[data-case-id]').forEach((button) => {
      button.addEventListener('click', () => { void select(button.dataset.caseId ?? ''); });
    });
    appRoot.querySelector<HTMLFormElement>('#takeover-form')?.addEventListener('submit', (event) => { void takeover(event); });
    appRoot.querySelector<HTMLFormElement>('#escalate-form')?.addEventListener('submit', (event) => { void escalate(event); });
    appRoot.querySelector<HTMLFormElement>('#reassign-form')?.addEventListener('submit', (event) => { void reassign(event); });
    appRoot.querySelector<HTMLFormElement>('#resolution-form')?.addEventListener('submit', (event) => { void authorizeResolution(event); });
  }

  let reloadInFlight = false;
  async function reload(): Promise<void> {
    if (reloadInFlight) return;
    reloadInFlight = true;
    try { await controller.load(); paint(); }
    finally { reloadInFlight = false; }
  }

  async function select(caseId: string): Promise<void> { await controller.select(caseId); paint(); }
  async function takeover(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const reason = field(event, 'takeover-reason');
    if (!window.confirm('سيتم إيقاف الأتمتة المتعارضة وإسناد التواصل إلى المشغل. هل تريد المتابعة؟')) return;
    await runAction(() => controller.takeover(reason, crypto.randomUUID(), traceId()));
  }
  async function escalate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const reason = field(event, 'escalate-reason');
    if (!window.confirm('سيتم تصعيد الحالة للمراجعة البشرية العليا دون إرسال جهة حقيقية. هل تريد المتابعة؟')) return;
    await runAction(() => controller.escalate(reason, crypto.randomUUID(), traceId()));
  }
  async function reassign(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const assigneeId = field(event, 'assigneeId');
    const reason = field(event, 'reassign-reason');
    if (!window.confirm(`سيتم إسناد الحالة إلى ${assigneeId}. هل تريد المتابعة؟`)) return;
    await runAction(() => controller.reassign(assigneeId, reason, crypto.randomUUID(), traceId()));
  }
  async function authorizeResolution(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const reason = field(event, 'resolution-reason');
    if (!window.confirm('هذا تفويض بشري عالي الخطورة وسيُسجل في سجل تدقيق غير قابل للتعديل. هل تريد المتابعة؟')) return;
    await runAction(() => controller.authorizeResolution(reason, crypto.randomUUID(), traceId()));
  }
  async function runAction(action: () => Promise<unknown>): Promise<void> {
    try { await action(); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء'); }
    paint();
  }

  void reload();
  window.setInterval(() => { void reload(); }, 5000);
}

function field(event: SubmitEvent, name: string): string {
  return String(new FormData(event.currentTarget as HTMLFormElement).get(name) ?? '');
}
function traceId(): string { return `dashboard-${crypto.randomUUID()}`; }
function isFilter(value: string): value is CommandCenterFilter {
  return ['ALL', 'URGENT', 'UNASSIGNED', 'MY_CASES'].includes(value);
}
function renderSessionFailure(appRoot: HTMLElement): void {
  appRoot.innerHTML = `<main id="main-content" tabindex="-1"><header class="topbar"><div><p class="eyebrow">ROS Eye — مركز قيادة سلامة الإنسان</p><h1>تعذر بدء جلسة آمنة</h1></div></header><div class="alert error" role="alert">لا توجد جلسة OIDC موثوقة. أعد تسجيل الدخول من بوابة ROS قبل عرض حالات سلامة الإنسان.</div></main>`;
}
