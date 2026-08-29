import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FieldSafetyCompanionController,
  MemoryFieldCompanionStorage,
  SequentialFieldCompanionIdFactory,
  SimulatedFieldCompanionGateway
} from './field-companion.js';
import { renderFieldCompanion } from './render.js';

const now = new Date('2026-07-31T05:00:00.000Z');

function controller(gateway = new SimulatedFieldCompanionGateway(), storage = new MemoryFieldCompanionStorage()) {
  return { gateway, storage, companion: new FieldSafetyCompanionController(storage, gateway, new SequentialFieldCompanionIdFactory(), 'browser-flow', () => now) };
}

async function boot(companion: FieldSafetyCompanionController): Promise<void> {
  await companion.boot({ tenantId: 'tenant-riyadh', caseId: 'case-field-browser', sessionId: 'session-field-browser', language: 'ar', appInstanceId: 'app-browser-001', now: now.toISOString() });
}

test('Arabic RTL critical path renders consent, structured response, privacy and simulation boundaries', async () => {
  const { companion } = controller();
  await boot(companion);
  let html = renderFieldCompanion(companion.state);
  assert.match(html, /رفيق السلامة الميداني/);
  assert.match(html, /محاكاة آمنة/);
  assert.match(html, /أوافق/);
  assert.match(html, /لا يعرض التطبيق الإحداثيات الدقيقة|لا نعرض إحداثيات دقيقة/);
  await companion.setConsent('GRANTED');
  await companion.selectLanguage('ar');
  html = renderFieldCompanion(companion.state);
  assert.match(html, /أحتاج مساعدة/);
  assert.match(html, /لا أستطيع التحدث/);
  assert.doesNotMatch(html, /textarea/);
});

test('offline and reconnect path remains visible and does not lose pending escalation', async () => {
  const flow = controller();
  await boot(flow.companion);
  await flow.companion.setConsent('GRANTED');
  await flow.companion.selectLanguage('ar');
  await flow.companion.updateDevice({ network: 'OFFLINE', battery: 'LOW' });
  await flow.companion.respond(['HELP_REQUESTED']);
  let html = renderFieldCompanion(flow.companion.state);
  assert.match(html, /أنت دون اتصال/);
  assert.match(html, /لن تفقد ردودك؛ ستبقى في قائمة محلية/);
  assert.equal(flow.companion.state.pending.length, 1);
  await flow.companion.updateDevice({ network: 'ONLINE' });
  html = renderFieldCompanion(flow.companion.state);
  assert.match(html, /مشغل بشري يتابع الحالة الآن/);
  assert.deepEqual(flow.gateway.deliveries.map((operation) => operation.kind), ['CONSENT', 'LANGUAGE_SELECTION', 'STRUCTURED_REPLY']);
});

test('restart restores consent, queue and status without sensitive free text', async () => {
  const flow = controller();
  await boot(flow.companion);
  await flow.companion.setConsent('GRANTED');
  await flow.companion.selectLanguage('ar');
  await flow.companion.updateDevice({ network: 'OFFLINE', motion: 'POSSIBLE_IMPACT' });
  await flow.companion.respond(['CANNOT_SPEAK']);

  const restarted = new FieldSafetyCompanionController(flow.storage, flow.gateway, new SequentialFieldCompanionIdFactory(), 'browser-flow', () => now);
  await restarted.boot({ tenantId: 'tenant-riyadh', caseId: 'case-field-browser', sessionId: 'session-field-browser', language: 'ar', appInstanceId: 'app-browser-002', now: now.toISOString() });
  const html = renderFieldCompanion(restarted.state);
  assert.equal(restarted.state.session.consent, 'GRANTED');
  assert.equal(restarted.state.pending.length, 1);
  assert.match(html, /دون اتصال/);
  assert.match(html, /لا يتصل حاليًا بالإسعاف أو المرور/);
  assert.doesNotMatch(html, /تم إرسال الإسعاف|سيصل الإسعاف|تم تشخيص/);
});

test('large-control and screen-reader oriented semantics exist on the critical path', async () => {
  const { companion } = controller();
  await boot(companion);
  await companion.setConsent('GRANTED');
  await companion.selectLanguage('ar');
  const html = renderFieldCompanion(companion.state);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /aria-labelledby="interaction-title"/);
  assert.match(html, /<fieldset>/);
  assert.match(html, /<legend>/);
  assert.match(html, /class="primary large-action"/);
  assert.match(html, /role="status"/);
});
