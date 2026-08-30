import type { RosRoleContract } from '@ros/contracts';
import { HttpRoadEventGateway } from './api-client.js';
import { OperationsDashboardController } from './dashboard.js';
import { renderDashboard } from './render.js';
import {
  requireTrustedBrowserSession,
  type OperationsWindow,
  type TrustedBrowserSession
} from './trusted-browser-session.js';

const rootElement = document.querySelector<HTMLElement>('#app');
if (rootElement === null) throw new Error('Dashboard root is missing');

try {
  startDashboard(rootElement, requireTrustedBrowserSession(window as OperationsWindow));
} catch {
  renderSessionFailure(rootElement);
}

function startDashboard(appRoot: HTMLElement, session: TrustedBrowserSession): void {
  const roles: readonly RosRoleContract[] = session.roles.filter(
    (role): role is 'OPERATOR' | 'SUPERVISOR' | 'AUDITOR' =>
    role === 'OPERATOR' || role === 'SUPERVISOR' || role === 'AUDITOR'
  );
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway(document.documentElement.dataset.apiBase ?? '', session),
    { roles }
  );

  function paint(): void {
    controller.refreshStaleness();
    appRoot.innerHTML = renderDashboard(controller.state, {
      canTransition: controller.canTransition(),
      canAuthorizeClosure: controller.canAuthorizeClosure(),
      now: new Date()
    });
    appRoot.querySelector('#refresh-button')?.addEventListener('click', () => { void reload(); });
    appRoot.querySelectorAll<HTMLElement>('[data-event-id]').forEach((button) => {
      button.addEventListener('click', () => { void select(button.dataset.eventId ?? ''); });
    });
    appRoot.querySelector<HTMLFormElement>('#transition-form')?.addEventListener('submit', (event) => { void transition(event); });
    appRoot.querySelector<HTMLFormElement>('#closure-form')?.addEventListener('submit', (event) => { void authorizeClosure(event); });
  }

  let reloadInFlight = false;
  async function reload(): Promise<void> {
    if (reloadInFlight) return;
    reloadInFlight = true;
    try { await controller.load(); paint(); }
    finally { reloadInFlight = false; }
  }

  async function select(id: string): Promise<void> { await controller.select(id); paint(); }

  async function transition(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const nextStatus = String(data.get('nextStatus')) as Parameters<typeof controller.transition>[0];
    const reason = String(data.get('reason') ?? '');
    if (!window.confirm(`تأكيد انتقال الحالة إلى ${nextStatus}؟ سيتم تسجيل القرار نهائيًا.`)) return;
    try { await controller.transition(nextStatus, reason); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الانتقال'); }
    paint();
  }

  async function authorizeClosure(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const reason = String(new FormData(form).get('reason') ?? '');
    if (!window.confirm('هذا تفويض حرج لإغلاق S3/S4 وسيظهر في سجل التدقيق. هل تريد المتابعة؟')) return;
    try { await controller.authorizeClosure(reason); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تفويض الإغلاق'); }
    paint();
  }

  void reload();
  window.setInterval(() => { void reload(); }, 10_000);
}

function renderSessionFailure(appRoot: HTMLElement): void {
  appRoot.innerHTML = `<main id="main-content" tabindex="-1"><header class="topbar"><div><p class="eyebrow">ROS — مركز العمليات</p><h1>تعذر بدء جلسة آمنة</h1></div></header><div class="alert error" role="alert">لا توجد جلسة OIDC موثوقة. أعد تسجيل الدخول من بوابة ROS ثم افتح لوحة العمليات مجددًا.</div></main>`;
}
