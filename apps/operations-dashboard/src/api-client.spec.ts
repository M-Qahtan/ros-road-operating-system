import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestError, HttpRoadEventGateway } from './api-client.js';

const session = {
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION',
  getAccessToken: () => Promise.resolve('signed-oidc-token')
};

function envelopeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
test('RoadEvent browser requests carry trusted bearer scope and no self-asserted identity', async () => {
  let captured: RequestInit | undefined;
  let requestedUrl = '';
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    captured = init;
    return envelopeResponse(200, {
      success: true,
      data: { items: [], total: 0, limit: 100, offset: 0 },
      error: null,
      traceId: 'trace-list-001'
    });
  };

  await new HttpRoadEventGateway('https://api.example.test', session, fetcher).list();

  const headers = new Headers(captured?.headers);
  assert.equal(requestedUrl, 'https://api.example.test/api/v1/road-events?limit=100&offset=0');
  assert.equal(headers.get('authorization'), 'Bearer signed-oidc-token');
  assert.equal(headers.get('x-tenant-id'), 'riyadh-pilot');
  assert.equal(headers.get('x-purpose'), 'TRAFFIC_COORDINATION');
  assert.equal(headers.has('x-actor-id'), false);
  assert.equal(headers.has('x-ros-roles'), false);
  assert.equal(captured?.redirect, 'error');
  assert.equal(captured?.cache, 'no-store');
});

test('RoadEvent browser fails closed before fetch when token or transport is unsafe', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests += 1;
    throw new Error('must not be called');
  };

  await assert.rejects(
    () => new HttpRoadEventGateway('', { ...session, getAccessToken: () => Promise.resolve('   ') }, fetcher).list(),
    /جلسة دخول/
  );
  await assert.rejects(
    () => new HttpRoadEventGateway('http://api.example.test', session, fetcher).list(),
    /إعداد اتصال آمن/
  );
  assert.equal(requests, 0);
});

for (const example of [
  { status: 401, code: 'AUTHENTICATION_REQUIRED', message: /تسجيل الدخول/ },
  { status: 403, code: 'FORBIDDEN', message: /صلاحية/ },
  { status: 409, code: 'CONFLICT', message: /تغيرت البيانات/ },
  { status: 503, code: 'SERVICE_UNAVAILABLE', message: /غير متاحة/ }
] as const) {
  test(`RoadEvent browser sanitizes ${example.status} without leaking server detail`, async () => {
    const gateway = new HttpRoadEventGateway('', session, async () => envelopeResponse(example.status, {
      success: false,
      data: null,
      error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@internal-db' },
      traceId: 'trace-safe-001'
    }));
    await assert.rejects(() => gateway.list(), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, example.status);
      assert.equal(error.code, example.code);
      assert.match(error.message, example.message);
      assert.doesNotMatch(error.message, /postgres|secret|internal-db/i);
      return true;
    });
  });
}
