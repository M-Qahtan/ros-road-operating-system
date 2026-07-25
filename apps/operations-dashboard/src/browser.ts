import { HttpRoadEventGateway } from './api-client.js';
import { OperationsDashboardController } from './dashboard.js';
import { renderDashboard } from './render.js';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Dashboard root is missing');

const roles = (document.documentElement.dataset.roles ?? 'OPERATOR').split(',') as ('OPERATOR' | 'SUPERVISOR' | 'AUDITOR' | 'INTEGRATION_SERVICE')[];
const controller = new OperationsDashboardController(
  new HttpRoadEventGateway(document.documentElement.dataset.apiBase ?? '', { actorId: 'dashboard-local-operator', roles }),
  { roles }
);

function paint(): void {
  controller.refreshStaleness();
  root.innerHTML = renderDashboard(controller.state, {
    canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(),
    now: new Date()
  });
  root.querySelector('#refresh-button')?.addEventListener('click', () => { void reload(); });
  root.querySelectorAll<HTMLElement>('[data-event-id]').forEach((button) => {
    button.addEventListener('click', () => { void select(button.dataset.eventId ?? ''); });
  });
  root.querySelector<HTMLFormElement>('#transition-form')?.addEventListener('submit', (event) => { void transition(event); });
  root.querySelector<HTMLFormElement>('#closure-form')?.addEventListener('submit', (event) => { void authorizeClosure(event); });
}

async function reload(): Promise<void> { await controller.load(); paint(); }
async function select(id: string): Promise<void> { await controller.select(id); paint(); }

async function transition(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const nextStatus = String(data.get('nextStatus')) as Parameters<typeof controller.transition>[0];
  const reason = String(data.get('reason') ?? '');
  if (!window.confirm(`تأكيد انتقال الحالة إلى ${nextStatus}؟ سيتم تسجيل القرار نهائيًا.`)) return;
  try { await controller.transition(nextStatus, reason); } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تنفيذ الانتقال'); }
  paint();
}

async function authorizeClosure(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const reason = String(new FormData(form).get('reason') ?? '');
  if (!window.confirm('هذا تفويض حرج لإغلاق S3/S4 وسيظهر في سجل التدقيق. هل تريد المتابعة؟')) return;
  try { await controller.authorizeClosure(reason); } catch (error) { window.alert(error instanceof Error ? error.message : 'تعذر تفويض الإغلاق'); }
  paint();
}

void reload();
setInterval(() => paint(), 10_000);
