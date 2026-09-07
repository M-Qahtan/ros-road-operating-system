import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import { SimulatedHumanSafetyCommandCenterGateway, seedCommandCenterCases } from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter, renderNextEvidence } from './human-safety-render.js';

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

test('advisor integrates with the command center and invalidates after human takeover', async () => {
  const now = new Date('2026-09-07T04:00:00.000Z');
  const gateway = new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now), () => now);
  const controller = new HumanSafetyCommandCenterController(gateway, { actorId: 'operator-21', roles: ['OPERATOR'] }, () => now);
  await controller.load();
  await controller.select('case-ros-eye-001');
  const html = renderHumanSafetyCommandCenter(controller.state, controller, now);
  assert.match(html, /الدليل التالي — مراجعة استشارية/);
  const panel = renderNextEvidence(controller.state.selected!, now, false);
  assert.match(panel, /راجع آخر نتيجة للتواصل/);
  assert.match(panel, /مراجعة بشرية عاجلة/);
  assert.match(panel, /لم تُثبت مطابقة التوصية لجميع البيانات الحالية/);
  assert.match(panel, /جمع أي بيانات جديدة يحتاج تفويضًا مستقلًا/);
  assert.doesNotMatch(panel, /<button|<form|<input/);
  await controller.takeover('متابعة حالة الإنسان', 'idem-advice-takeover', 'trace-advice-takeover');
  assert.equal(controller.state.selected!.nextEvidenceAdvice?.status, 'ABSTAIN');
  assert.equal(controller.state.selected!.safetyCase.severity, 'S4');
  assert.doesNotMatch(renderNextEvidence(controller.state.selected!, now, false), /راجع آخر نتيجة للتواصل/);
});

test('read-only advice expires on the display clock and cannot be revived by a refresh', async () => {
  let now = new Date('2026-09-07T04:00:00.000Z');
  const gateway = new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now), () => now);
  const original = await gateway.get('case-ros-eye-001');
  assert.match(renderNextEvidence(original, now, false), /راجع آخر نتيجة للتواصل/);
  assert.equal(renderNextEvidence(original, new Date(now.getTime() + 1000), false), renderNextEvidence(original, now, false));
  assert.doesNotMatch(renderNextEvidence(original, now, true), /راجع آخر نتيجة للتواصل/);
  now = new Date(original.nextEvidenceAdvice!.expiresAt!);
  // No fetch is necessary to remove expired suggestions.
  assert.doesNotMatch(renderNextEvidence(original, now, false), /راجع آخر نتيجة للتواصل/);
  const refreshed = await gateway.get(original.safetyCase.id);
  assert.equal(refreshed.nextEvidenceAdvice!.expiresAt, original.nextEvidenceAdvice!.expiresAt);
  assert.equal(refreshed.nextEvidenceAdvice!.status, 'ABSTAIN');
  assert.match(renderNextEvidence(refreshed, now, false), /مراجعة بشرية عاجلة/);
});

test('legacy, mismatched and malformed source contexts do not display actionable evidence guidance', async () => {
  const now = new Date('2026-09-07T04:00:00.000Z');
  const seed = seedCommandCenterCases(now);
  assert.match(renderNextEvidence(seed[0]!, now, false), /خدمة الاقتراح غير متاحة/);
  const gateway = new SimulatedHumanSafetyCommandCenterGateway(seed, () => now);
  const original = await gateway.get('case-ros-eye-001');
  for (const changed of [
    { ...original, safetyCase: { ...original.safetyCase, version: original.safetyCase.version + 1 } },
    { ...original, contactSession: { ...original.contactSession!, version: original.contactSession!.version + 1 } },
    { ...original, recommendation: { ...original.recommendation!, deterministicFingerprint: '9'.repeat(64) } },
    { ...original, nextEvidenceAdvice: { ...original.nextEvidenceAdvice!, expiresAt: 'invalid-time' } }
  ]) assert.doesNotMatch(renderNextEvidence(changed, now, false), /راجع آخر نتيجة للتواصل/);
  assert.doesNotMatch(renderNextEvidence(original, new Date('2026-09-07T03:59:00.000Z'), false), /راجع آخر نتيجة للتواصل/);
});
