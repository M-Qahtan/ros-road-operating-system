import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import { SimulatedHumanSafetyCommandCenterGateway, seedCommandCenterCases } from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';

class MutableClock {
  constructor(private value: Date) {}
  now = (): Date => new Date(this.value);
  advance(ms: number): void { this.value = new Date(this.value.getTime() + ms); }
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
});
