import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import {
  CommandCenterRequestError,
  SimulatedHumanSafetyCommandCenterGateway,
  seedCommandCenterCases,
  type CommandCenterActionInput,
  type CommandCenterCaseView
} from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';

class MutableClock {
  constructor(private value: Date) {}
  now = (): Date => new Date(this.value);
  advance(ms: number): void { this.value = new Date(this.value.getTime() + ms); }
}

class FailingActionGateway extends SimulatedHumanSafetyCommandCenterGateway {
  override takeover(_caseId: string, _input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return Promise.reject(new CommandCenterRequestError({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'الخدمة غير متاحة ولم يتم تأكيد نتيجة الإجراء. حدّث البيانات قبل المحاولة مجددًا.',
      traceId: 'trace-outage-001',
      outcomeAmbiguous: true
    }));
  }
}

test('urgent cases remain visible and ordered first regardless of operator filter', async () => {
  const clock = new MutableClock(new Date('2026-07-31T04:00:00.000Z'));
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(clock.now())),
    { actorId: 'operator-9', roles: ['OPERATOR'] }, clock.now
  );
  await controller.load();
  controller.setFilter('MY_CASES');
  const visible = controller.visibleItems();
  assert.equal(visible[0]?.safetyCase.id, 'case-ros-eye-001');
  assert.ok(visible.some((item) => item.safetyCase.id === 'case-ros-eye-003'));
  assert.equal(controller.metrics().overdue, 1);
});

test('stale data fail closed for critical controls', async () => {
  const clock = new MutableClock(new Date('2026-07-31T04:00:00.000Z'));
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(clock.now())),
    { actorId: 'operator-9', roles: ['OPERATOR'], staleAfterMs: 1000 }, clock.now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  assert.equal(controller.canEscalate(), true);
  clock.advance(2000);
  controller.refreshStaleness();
  assert.equal(controller.canEscalate(), false);
  await assert.rejects(() => controller.escalate('تجاوزت مهلة الاستجابة', 'idem-stale-001', 'trace-stale-001'), /حدّث البيانات/);
});

test('duplicate takeover is idempotent and records one immutable audit outcome', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'operator-9', roles: ['OPERATOR'] }, () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  await controller.takeover('استحواذ بسبب عدم الاستجابة', 'idem-takeover-001', 'trace-takeover-001');
  const auditCount = controller.state.selected?.audit.length;
  await controller.takeover('استحواذ بسبب عدم الاستجابة', 'idem-takeover-001', 'trace-takeover-001');
  assert.equal(controller.state.selected?.contactSession?.state, 'OPERATOR_TAKEOVER');
  assert.equal(controller.state.selected?.safetyCase.assignedActorId, 'operator-9');
  assert.equal(controller.state.selected?.audit.length, auditCount);
  assert.equal(controller.state.selected?.audit.at(-1)?.immutable, true);
});

test('supervisor authorizes monitored high-risk resolution only with trusted healthy context', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'supervisor-1', roles: ['SUPERVISOR'] }, () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-002');
  assert.equal(controller.canAuthorizeResolution(), true);
  await controller.authorizeResolution('تمت مراجعة الأدلة والحالة تحت المراقبة', 'idem-resolution-001', 'trace-resolution-001');
  assert.equal(controller.state.selected?.safetyCase.state, 'RESOLVED');
  assert.equal(controller.state.selected?.safetyCase.highRiskResolutionAuthorization?.actorId, 'supervisor-1');
  assert.equal(controller.state.selected?.audit.at(-1)?.action, 'human_safety.resolution_authorized');
});

test('Arabic command-center rendering exposes urgency privacy explainability and fail-closed controls', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'supervisor-1', roles: ['SUPERVISOR'] }, () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  const html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /مركز قيادة سلامة الإنسان/);
  assert.match(html, /بيئة محاكاة فقط/);
  assert.match(html, /متجاوزة للمهلة/);
  assert.match(html, /توصية فقط/);
  assert.match(html, /سجل التدقيق غير القابل للتعديل/);
  assert.doesNotMatch(html, /24\.\d+,\s*46\.\d+/);
  assert.match(html, /نسخ مصادر القرار/);
  assert.match(html, /محجوبة: لا توجد لقطة مصادر حالية موثقة/);
});

test('Arabic command-center renders only verified governed source revisions as authoritative', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const cases = seedCommandCenterCases(now).map((item, index) => index !== 0 ? item : ({
    ...item,
    sourceVersionState: {
      status: 'VERIFIED' as const, reason: 'VERIFIED', inputVersion: 37, sourceSnapshotDigest: 'd'.repeat(64),
      caseRevision: 11, severityRevision: 12, contactRevision: null, evidenceRevision: 14, indicatorRevision: 15
    }
  }));
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(cases),
    { actorId: 'supervisor-1', roles: ['SUPERVISOR'] }, () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  const html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /<dt>الحالة<\/dt><dd>11<\/dd>/);
  assert.match(html, /<dt>الخطورة<\/dt><dd>12<\/dd>/);
  assert.match(html, /<dt>التواصل<\/dt><dd>غير موجود<\/dd>/);
  assert.match(html, /<dt>الأدلة<\/dt><dd>14<\/dd>/);
  assert.match(html, /<dt>المؤشرات<\/dt><dd>15<\/dd>/);
});

test('ambiguous remote action failure marks Human Safety data stale and disables retry', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new FailingActionGateway(seedCommandCenterCases(now)),
    { actorId: 'operator-9', roles: ['OPERATOR'] },
    () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  await assert.rejects(
    () => controller.takeover('استحواذ بشري بسبب عدم الاستجابة', 'idem-outage-001', 'trace-outage-001'),
    /لم يتم تأكيد نتيجة الإجراء/
  );
  assert.equal(controller.state.stale, true);
  assert.equal(controller.canTakeover(), false);
  const html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /تم تعطيل الإجراءات الحرجة/);
  assert.match(html, /disabled/);
});
