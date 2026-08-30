import assert from 'node:assert/strict';
import test from 'node:test';
import type { FieldCompanionQueuedOperation } from './field-companion.js';
import {
  HttpFieldCompanionGateway,
  DEVICE_REGISTRATION_CONSENT_POLICY_VERSION,
  MobileMvpAuthenticationError,
  MobileMvpConsentRequiredError,
  MobileMvpDeviceRegistrationRequiredError,
  MobileMvpResponseError,
  ROS_MOBILE_APP_VERSION,
  registerConsentedDevice,
  submitMobileIncidentJourney,
  type MobileFetch
} from './mvp-http-gateway.js';

const NOW = '2026-08-20T09:00:00.000Z';
const TOKEN = 'signed.oidc.jwt';
const ROAD_EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REGISTRATION_OPERATION_ID = '11111111-1111-4111-8111-111111111111';

function operation(overrides: Partial<FieldCompanionQueuedOperation> = {}): FieldCompanionQueuedOperation {
  return {
    operationId: 'field-op-001',
    idempotencyKey: 'field-idem-001',
    kind: 'DEVICE_METADATA',
    createdAt: NOW,
    expiresAt: '2026-08-21T09:00:00.000Z',
    attemptCount: 0,
    payload: {
      network: 'ONLINE', battery: 'NORMAL', locationQuality: 'APPROXIMATE', motion: 'STABLE',
      clockSkewBucket: 'WITHIN_POLICY', observedAt: NOW,
      sharedCategories: ['DEVICE_CONDITION', 'MOTION_INDICATOR', 'LOCATION_QUALITY_ONLY']
    },
    ...overrides
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function ok(data: unknown, traceId = 'trace-mobile-001'): Response {
  return json({ success: true, data, error: null, traceId });
}

function registrationRequest() {
  return { deviceId: DEVICE_ID, platform: 'WEB' as const, appVersion: ROS_MOBILE_APP_VERSION, consent: { decision: 'GRANTED' as const, policyVersion: DEVICE_REGISTRATION_CONSENT_POLICY_VERSION, occurredAt: NOW } };
}

async function registerGateway(gateway: HttpFieldCompanionGateway): Promise<void> {
  await gateway.registerDevice(registrationRequest(), `mobile-device-registration-${REGISTRATION_OPERATION_ID}`);
}

test('delivery uses Bearer and matching idempotency contract without self-attested scope', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: MobileFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith('/devices/registrations')) return ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW });
    return ok({
      idempotencyKey: 'field-idem-001', disposition: 'ACCEPTED', contactState: 'AWAITING_RESPONSE',
      statusMessageCode: 'device_registered', receivedAt: NOW
    }, 'trace-delivery');
  };
  const gateway = new HttpFieldCompanionGateway({ apiBaseUrl: 'https://api.ros.example', accessToken: () => TOKEN, fetcher });
  await registerGateway(gateway);
  calls.length = 0;

  const receipt = await gateway.deliver({ tenantId: 'tenant-must-not-leak', caseId: 'case-mobile-001', sessionId: 'session-mobile-001', operation: operation() });

  assert.equal(receipt.statusMessageCode, 'device_registered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.ros.example/api/v1/field-companion/deliveries');
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(headers['x-device-id'], DEVICE_ID);
  assert.equal(headers['idempotency-key'], 'field-idem-001');
  assert.equal(headers['x-tenant-id'], undefined);
  assert.equal(headers['x-purpose'], undefined);
  assert.equal(headers['x-actor-id'], undefined);
  const body = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['caseId', 'operation', 'sessionId']);
  assert.equal(body.caseId, 'case-mobile-001');
  assert.equal(JSON.stringify(body).includes('tenant-must-not-leak'), false);
  assert.equal(gateway.simulation, false);
});

test('missing Bearer fails closed before network access and never falls back to simulation', async () => {
  let networkCalls = 0;
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => null,
    fetcher: async () => { networkCalls += 1; throw new Error('must not run'); }
  });
  await assert.rejects(
    gateway.deliver({ tenantId: 'tenant-mobile', caseId: 'case-mobile-001', sessionId: 'session-mobile-001', operation: operation() }),
    MobileMvpAuthenticationError
  );
  assert.equal(networkCalls, 0);
});

test('nearby polling validates location, authenticates and parses bounded notification data', async () => {
  let observedUrl = '';
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input, init) => {
      observedUrl = String(input);
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
      if (observedUrl.endsWith('/devices/registrations')) return ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW });
      assert.equal((init?.headers as Record<string, string>)['x-device-id'], DEVICE_ID);
      return ok({
        items: [{ id: 'notification-001', roadEventId: 'event-001', severity: 'S3', distanceMeters: 240.5, occurredAt: NOW, acknowledgedAt: null }],
        generatedAt: NOW
      });
    }
  });
  await registerGateway(gateway);
  const page = await gateway.nearby({ latitude: 24.7136, longitude: 46.6753, radiusMeters: 5000 });
  assert.equal(observedUrl, '/api/v1/notifications/nearby?latitude=24.7136&longitude=46.6753&radiusMeters=5000');
  assert.equal(page.items[0]?.severity, 'S3');
  await assert.rejects(gateway.nearby({ latitude: 91, longitude: 46.6753, radiusMeters: 5000 }), RangeError);
});

test('notification acknowledgement is idempotent and rejects mismatched response identity', async () => {
  const calls: RequestInit[] = [];
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: 'https://api.ros.example/', accessToken: () => TOKEN,
    fetcher: async (input, init) => {
      calls.push(init ?? {});
      if (String(input).endsWith('/devices/registrations')) return ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW });
      return ok({ notificationId: 'notification-001', acknowledgedAt: NOW });
    }
  });
  await registerGateway(gateway);
  calls.length = 0;
  const receipt = await gateway.acknowledgeNotification('notification-001', 'notification-ack-001');
  assert.equal(receipt.notificationId, 'notification-001');
  assert.equal((calls[0]!.headers as Record<string, string>)['idempotency-key'], 'notification-ack-001');

  const mismatch = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input) => String(input).endsWith('/devices/registrations')
      ? ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW })
      : ok({ notificationId: 'notification-other', acknowledgedAt: NOW })
  });
  await registerGateway(mismatch);
  await assert.rejects(mismatch.acknowledgeNotification('notification-001', 'notification-ack-002'), (error: unknown) => {
    assert.ok(error instanceof MobileMvpResponseError);
    assert.equal(error.code, 'INVALID_ACKNOWLEDGEMENT_RESPONSE');
    return true;
  });
});

test('incident report and simulated signal use only existing RoadEvent contracts', async () => {
  const calls: { url: string; body: unknown; idempotencyKey: string | undefined }[] = [];
  const roadEvent = {
    id: ROAD_EVENT_ID, status: 'DETECTED',
    severity: { level: 'S2', score: 40, confidence: 0.5, reasonCodes: ['MOBILE_REPORT'], requiresHumanReview: true },
    latitude: 24.7136, longitude: 46.6753, occurredAt: NOW, version: 1, closureAuthorization: null
  };
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      if (String(input).endsWith('/devices/registrations')) return ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW });
      assert.equal(headers['x-device-id'], DEVICE_ID);
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)), idempotencyKey: headers['idempotency-key'] });
      return ok(roadEvent);
    }
  });
  await registerGateway(gateway);
  await gateway.createIncidentReport({ id: roadEvent.id, occurredAt: NOW, latitude: 24.7136, longitude: 46.6753 }, 'incident-idem-001');
  await gateway.attachSimulatedSignal(roadEvent.id, { signalId: 'signal-mobile-001', matchScore: 0.85, mergeReasons: ['USER_CONFIRMED'] }, 'signal-idem-001');
  assert.deepEqual(calls, [
    { url: '/api/v1/road-events', body: { id: roadEvent.id, occurredAt: NOW, latitude: 24.7136, longitude: 46.6753 }, idempotencyKey: 'incident-idem-001' },
    { url: `/api/v1/road-events/${ROAD_EVENT_ID}/signals`, body: { signalId: 'signal-mobile-001', matchScore: 0.85, mergeReasons: ['USER_CONFIRMED'] }, idempotencyKey: 'signal-idem-001' }
  ]);
});

test('device registration is authenticated, minimal and repeats with the same device idempotency identity', async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  let disposition: 'REGISTERED' | 'IDEMPOTENT' = 'REGISTERED';
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      const current = disposition;
      disposition = 'IDEMPOTENT';
      return ok({ deviceId: DEVICE_ID, disposition: current, registeredAt: NOW, consentGrantedAt: NOW });
    }
  });
  const request = registrationRequest();
  assert.equal((await gateway.registerDevice(request, `mobile-device-registration-${REGISTRATION_OPERATION_ID}`)).disposition, 'REGISTERED');
  assert.equal((await gateway.registerDevice(request, `mobile-device-registration-${REGISTRATION_OPERATION_ID}`)).disposition, 'IDEMPOTENT');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, '/api/v1/field-companion/devices/registrations');
    assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(call.headers['idempotency-key'], `mobile-device-registration-${REGISTRATION_OPERATION_ID}`);
    assert.equal(call.headers['x-device-id'], undefined);
    assert.deepEqual(call.body, request);
    assert.equal(JSON.stringify(call.body).match(/tenant|purpose|actor|roles/gi), null);
  }
});

test('device registration rejects mismatched or malformed success envelopes', async () => {
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async () => ok({ deviceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW })
  });
  await assert.rejects(gateway.registerDevice(registrationRequest(), `mobile-device-registration-${REGISTRATION_OPERATION_ID}`), (error: unknown) => {
    assert.ok(error instanceof MobileMvpResponseError);
    assert.equal(error.code, 'INVALID_DEVICE_REGISTRATION_RESPONSE');
    return true;
  });
});

test('declined consent never calls the registration gateway', async () => {
  let calls = 0;
  await assert.rejects(registerConsentedDevice({
    gateway: { registerDevice: async () => { calls += 1; throw new Error('must not register'); } },
    deviceId: DEVICE_ID, registrationOperationId: REGISTRATION_OPERATION_ID, appVersion: ROS_MOBILE_APP_VERSION,
    consent: { decision: 'DECLINED', occurredAt: NOW }
  }), MobileMvpConsentRequiredError);
  assert.equal(calls, 0);
});

test('unregistered gateway blocks incident before network access', async () => {
  let networkCalls = 0;
  const gateway = new HttpFieldCompanionGateway({ apiBaseUrl: '', accessToken: () => TOKEN, fetcher: async () => { networkCalls += 1; throw new Error('must not run'); } });
  await assert.rejects(gateway.createIncidentReport({ id: ROAD_EVENT_ID, occurredAt: NOW, latitude: 24.7, longitude: 46.6 }, 'incident-idem-001'), MobileMvpDeviceRegistrationRequiredError);
  assert.equal(networkCalls, 0);
});

test('registration failure blocks create, signal, contact and flush', async () => {
  const calls: string[] = [];
  const blocked = async () => { calls.push('unexpected'); throw new Error('must not run'); };
  await assert.rejects(submitMobileIncidentJourney({
    gateway: {
      registerDevice: async () => { calls.push('register'); throw new MobileMvpResponseError(503, 'DEVICE_REGISTRATION_UNAVAILABLE', 'trace-registration'); },
      createIncidentReport: blocked,
      attachSimulatedSignal: blocked,
      openContactSession: blocked
    },
    caseId: ROAD_EVENT_ID, sessionId: SESSION_ID, deviceId: DEVICE_ID, registrationOperationId: REGISTRATION_OPERATION_ID,
    appVersion: ROS_MOBILE_APP_VERSION, consent: { decision: 'GRANTED', occurredAt: NOW }, signalId: 'signal-mobile-001',
    language: 'ar', occurredAt: NOW, latitude: 24.7, longitude: 46.6,
    flushPending: async () => { calls.push('unexpected'); return { pending: [] }; }
  }), (error: unknown) => error instanceof MobileMvpResponseError && error.code === 'DEVICE_REGISTRATION_UNAVAILABLE');
  assert.deepEqual(calls, ['register']);
});

test('contact session opens against the same RoadEvent UUID with a durable idempotency key', async () => {
  let observed: { url: string; body: unknown; idempotencyKey: string | undefined } | undefined;
  const gateway = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      if (String(input).endsWith('/devices/registrations')) return ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW });
      assert.equal(headers['x-device-id'], DEVICE_ID);
      observed = { url: String(input), body: JSON.parse(String(init?.body)), idempotencyKey: headers['idempotency-key'] };
      return ok({ caseId: ROAD_EVENT_ID, sessionId: SESSION_ID, disposition: 'CREATED' });
    }
  });
  await registerGateway(gateway);

  const receipt = await gateway.openContactSession(ROAD_EVENT_ID, { sessionId: SESSION_ID, language: 'ar', preferredChannel: 'IN_APP' }, `mobile-contact-${SESSION_ID}`);

  assert.deepEqual(receipt, { caseId: ROAD_EVENT_ID, sessionId: SESSION_ID, disposition: 'CREATED' });
  assert.deepEqual(observed, {
    url: `/api/v1/road-events/${ROAD_EVENT_ID}/contact-sessions`,
    body: { sessionId: SESSION_ID, language: 'ar', preferredChannel: 'IN_APP' },
    idempotencyKey: `mobile-contact-${SESSION_ID}`
  });
  await assert.rejects(gateway.openContactSession('case-not-a-uuid', { sessionId: SESSION_ID, language: 'ar', preferredChannel: 'IN_APP' }, 'contact-idem-001'), TypeError);
});

test('incident journey reuses case UUID, opens contact, then flushes durable operations in order', async () => {
  const order: string[] = [];
  const roadEvent = {
    id: ROAD_EVENT_ID, status: 'DETECTED' as const,
    severity: { level: 'S2' as const, score: 40, confidence: 0.5, reasonCodes: ['MOBILE_REPORT'], requiresHumanReview: true },
    latitude: 24.7136, longitude: 46.6753, occurredAt: NOW, version: 1, closureAuthorization: null
  };
  const gateway = {
    registerDevice: async (request: { readonly deviceId: string }, key: string) => { order.push(`register:${request.deviceId}:${key}`); return { deviceId: request.deviceId, disposition: 'REGISTERED' as const, registeredAt: NOW, consentGrantedAt: NOW }; },
    createIncidentReport: async (request: { readonly id: string }, key: string) => { order.push(`create:${request.id}:${key}`); return roadEvent; },
    attachSimulatedSignal: async (roadEventId: string, request: { readonly signalId: string }, key: string) => { order.push(`signal:${roadEventId}:${request.signalId}:${key}`); return roadEvent; },
    openContactSession: async (roadEventId: string, request: { readonly sessionId: string }, key: string) => { order.push(`contact:${roadEventId}:${request.sessionId}:${key}`); return { caseId: roadEventId, sessionId: request.sessionId, disposition: 'CREATED' }; }
  };
  const result = await submitMobileIncidentJourney({
    gateway, caseId: ROAD_EVENT_ID, sessionId: SESSION_ID, deviceId: DEVICE_ID, registrationOperationId: REGISTRATION_OPERATION_ID, appVersion: ROS_MOBILE_APP_VERSION,
    consent: { decision: 'GRANTED', occurredAt: NOW }, signalId: 'signal-mobile-001', language: 'ar', occurredAt: NOW,
    latitude: 24.7136, longitude: 46.6753,
    flushPending: async () => { order.push('flush'); return { pending: [] }; }
  });
  assert.equal(result.contactSession.caseId, ROAD_EVENT_ID);
  assert.equal(result.pendingOperationCount, 0);
  assert.deepEqual(order, [
    `register:${DEVICE_ID}:mobile-device-registration-${REGISTRATION_OPERATION_ID}`,
    `create:${ROAD_EVENT_ID}:mobile-incident-${ROAD_EVENT_ID}`,
    `signal:${ROAD_EVENT_ID}:signal-mobile-001:mobile-signal-signal-mobile-001`,
    `contact:${ROAD_EVENT_ID}:${SESSION_ID}:mobile-contact-${SESSION_ID}`,
    'flush'
  ]);
});

test('API denial and malformed success response remain failures', async () => {
  const denied = new HttpFieldCompanionGateway({
    apiBaseUrl: '', accessToken: () => TOKEN,
    fetcher: async (input) => String(input).endsWith('/devices/registrations')
      ? ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW })
      : json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'denied' }, traceId: 'trace-denied' }, 403)
  });
  await registerGateway(denied);
  await assert.rejects(denied.nearby({ latitude: 24, longitude: 46, radiusMeters: 1000 }), (error: unknown) => {
    assert.ok(error instanceof MobileMvpResponseError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.traceId, 'trace-denied');
    return true;
  });

  const malformed = new HttpFieldCompanionGateway({ apiBaseUrl: '', accessToken: () => TOKEN, fetcher: async (input) => String(input).endsWith('/devices/registrations') ? ok({ deviceId: DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW, consentGrantedAt: NOW }) : json({ data: [] }) });
  await registerGateway(malformed);
  await assert.rejects(malformed.nearby({ latitude: 24, longitude: 46, radiusMeters: 1000 }), MobileMvpResponseError);
});
