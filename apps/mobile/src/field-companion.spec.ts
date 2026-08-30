import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FieldSafetyCompanionController,
  MemoryFieldCompanionStorage,
  SequentialFieldCompanionIdFactory,
  SimulatedFieldCompanionGateway
} from './field-companion.js';

const start = '2026-07-31T05:00:00.000Z';

function bootstrap(now = start, appInstanceId = 'app-instance-001') {
  return { tenantId: 'tenant-riyadh', caseId: 'case-field-001', sessionId: 'session-field-001', language: 'ar' as const, appInstanceId, now };
}

function harness(now = new Date(start)) {
  const storage = new MemoryFieldCompanionStorage();
  const gateway = new SimulatedFieldCompanionGateway();
  const ids = new SequentialFieldCompanionIdFactory();
  const controller = new FieldSafetyCompanionController(storage, gateway, ids, 'field-test', () => new Date(now));
  return { storage, gateway, ids, controller };
}

test('offline reply survives restart and flushes exactly once after reconnect', async () => {
  const first = harness();
  await first.controller.boot(bootstrap());
  await first.controller.setConsent('GRANTED');
  await first.controller.selectLanguage('ar');
  await first.controller.updateDevice({ network: 'OFFLINE' });
  await first.controller.respond(['YES']);
  assert.equal(first.controller.state.pending.length, 1);
  assert.equal(first.gateway.deliveries.length, 2);

  const restored = new FieldSafetyCompanionController(first.storage, first.gateway, first.ids, 'field-test', () => new Date(start));
  await restored.boot(bootstrap(start, 'app-instance-002'));
  assert.equal(restored.state.pending.length, 1);
  await restored.updateDevice({ network: 'ONLINE' });
  assert.equal(restored.state.pending.length, 0);
  assert.equal(first.gateway.deliveries.length, 3);
  await restored.flush();
  assert.equal(first.gateway.deliveries.length, 3);
});

test('help request triggers operator-takeover visibility without real dispatch claim', async () => {
  const { controller } = harness();
  await controller.boot(bootstrap());
  await controller.setConsent('GRANTED');
  await controller.selectLanguage('ar');
  await controller.respond(['HELP_REQUESTED']);
  assert.equal(controller.state.session.phase, 'OPERATOR_TAKEOVER');
  assert.equal(controller.state.session.operatorTakeoverVisible, true);
  assert.equal(controller.state.session.contactState, 'OPERATOR_TAKEOVER');
});

test('untrusted device clock blocks metadata sharing and moves status toward review', async () => {
  const { controller, gateway } = harness();
  await controller.boot(bootstrap());
  await controller.setConsent('GRANTED');
  await controller.updateDevice({ clockSkewMs: 301_000 });
  assert.equal(controller.state.session.statusMessageCode, 'device_time_untrusted');
  await assert.rejects(() => controller.shareDeviceMetadata(), /وقت الجهاز غير موثوق/);
  assert.deepEqual(gateway.deliveries.map((operation) => operation.kind), ['CONSENT']);
});

test('gateway outage retains bounded safe operation for later retry', async () => {
  const { controller, gateway } = harness();
  gateway.unavailable = true;
  await controller.boot(bootstrap());
  await controller.setConsent('GRANTED');
  await controller.selectLanguage('ar');
  await controller.respond(['YES']);
  assert.equal(controller.state.pending.length, 3);
  assert.deepEqual(controller.state.pending.map((operation) => operation.kind), ['CONSENT', 'LANGUAGE_SELECTION', 'STRUCTURED_REPLY']);
  assert.equal(controller.state.pending.find((operation) => operation.kind === 'STRUCTURED_REPLY')?.attemptCount, 1);
  gateway.unavailable = false;
  await controller.flush();
  assert.equal(controller.state.pending.length, 0);
  assert.deepEqual(gateway.deliveries.map((operation) => operation.kind), ['CONSENT', 'LANGUAGE_SELECTION', 'STRUCTURED_REPLY']);
});

test('privacy-safe telemetry excludes raw location conversation phone and token fields', async () => {
  const { controller } = harness();
  await controller.boot(bootstrap());
  const serialized = JSON.stringify(controller.privacySafeTelemetry());
  for (const forbidden of ['latitude', 'longitude', 'conversation', 'phone', 'token', 'medical']) assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  assert.match(serialized, /locationQuality/);
  assert.equal(controller.sharedDataSummary().length, 5);
});

test('structured reply rejects free-form equivalents and contradictory options', async () => {
  const { controller } = harness();
  await controller.boot(bootstrap());
  await controller.setConsent('GRANTED');
  await controller.selectLanguage('ar');
  await assert.rejects(() => controller.respond(['YES', 'NO']), /متعارضة/);
  await assert.rejects(() => controller.respond(['ACCESSIBILITY_SUPPORT_REQUIRED']), /غير صالح/);
});

test('declined consent stops structured collection and requests human review', async () => {
  const { controller, gateway } = harness();
  await controller.boot(bootstrap());
  await controller.setConsent('DECLINED');
  assert.equal(controller.state.session.phase, 'HUMAN_REVIEW');
  assert.equal(controller.state.session.allowedReplyOptions.length, 0);
  assert.equal(gateway.deliveries[0]?.kind, 'CONSENT');
  assert.deepEqual(gateway.deliveries[0]?.payload, { decision: 'DECLINED', occurredAt: start });
  await assert.rejects(() => controller.respond(['YES']), /الموافقة مطلوبة/);
});

test('offline consent and language are durable idempotent operations across restart', async () => {
  const first = harness();
  await first.controller.boot(bootstrap());
  await first.controller.updateDevice({ network: 'OFFLINE' });
  await first.controller.setConsent('GRANTED');
  await first.controller.selectLanguage('en');
  assert.deepEqual(first.controller.state.pending.map((operation) => operation.kind), ['CONSENT', 'LANGUAGE_SELECTION']);
  assert.deepEqual(first.controller.state.pending.map((operation) => operation.payload), [
    { decision: 'GRANTED', occurredAt: start },
    { language: 'en', occurredAt: start }
  ]);
  assert.equal(new Set(first.controller.state.pending.map((operation) => operation.idempotencyKey)).size, 2);

  const restored = new FieldSafetyCompanionController(first.storage, first.gateway, first.ids, 'field-test', () => new Date(start));
  await restored.boot(bootstrap(start, 'app-instance-002'));
  assert.equal(restored.state.pending.length, 2);
  await restored.updateDevice({ network: 'ONLINE' });
  assert.equal(restored.state.pending.length, 0);
  assert.deepEqual(first.gateway.deliveries.map((operation) => operation.kind), ['CONSENT', 'LANGUAGE_SELECTION']);
  await restored.flush();
  assert.equal(first.gateway.deliveries.length, 2);
});
