import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import { SimulatedHumanSafetyCommandCenterGateway, seedCommandCenterCases } from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';

test('operator workflow handles no-response takeover escalation and immutable traceability', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'operator-21', roles: ['OPERATOR'] }, () => now
  );
  await controller.load();
  await controller.select('case-ros-eye-001');
  let html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /لا توجد استجابة/);
  assert.match(html, /متجاوزة/);
  await controller.takeover('تحويل التواصل إلى مشغل بشري', 'idem-browser-takeover', 'trace-browser-takeover');
  html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /استحواذ المشغل/);
  assert.match(html, /operator-21/);
  assert.match(html, /trace-browser-takeover/);
  await controller.escalate('استمرار عدم الاستجابة بعد الاستحواذ', 'idem-browser-escalate', 'trace-browser-escalate');
  html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /مصعّدة/);
  assert.match(html, /trace-browser-escalate/);
  assert.match(html, /لا يرسل جهة حقيقية/);
});

test('stale selected view renders blocking banner and disables every critical action', async () => {
  let current = new Date('2026-07-31T04:00:00.000Z');
  const controller = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(current)),
    { actorId: 'supervisor-1', roles: ['SUPERVISOR'], staleAfterMs: 500 }, () => current
  );
  await controller.load();
  await controller.select('case-ros-eye-002');
  current = new Date(current.getTime() + 1000);
  controller.refreshStaleness();
  const html = renderHumanSafetyCommandCenter(controller.state, controller, current);
  assert.match(html, /تم تعطيل الإجراءات الحرجة/);
  assert.ok((html.match(/disabled/g) ?? []).length >= 4);
});

test('authorized resolution remains supervisor-only and visible in audit', async () => {
  const now = new Date('2026-07-31T04:00:00.000Z');
  const operator = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'operator-1', roles: ['OPERATOR'] }, () => now
  );
  await operator.load();
  await operator.select('case-ros-eye-002');
  assert.equal(operator.canAuthorizeResolution(), false);
  const supervisor = new HumanSafetyCommandCenterController(
    new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now)),
    { actorId: 'supervisor-1', roles: ['SUPERVISOR'] }, () => now
  );
  await supervisor.load();
  await supervisor.select('case-ros-eye-002');
  await supervisor.authorizeResolution('مراجعة بشرية مكتملة والأدلة موثوقة', 'idem-browser-resolution', 'trace-browser-resolution');
  const html = renderHumanSafetyCommandCenter(supervisor.state, supervisor, now);
  assert.match(html, /محلولة/);
  assert.match(html, /human_safety\.resolution_authorized/);
  assert.match(html, /trace-browser-resolution/);
});
