import assert from 'node:assert/strict';
import test from 'node:test';
import { AdvisoryRouteRequest, computeAdvisoryRouteSafely } from './map-provider.js';
import { GoogleRoutesSandboxProvider } from './google-routes-sandbox-provider.js';

const NOW = 1_800_000_000_000;
const REQUEST: AdvisoryRouteRequest = {
  origin: { latitude: 24.7136, longitude: 46.6753 },
  destination: { latitude: 24.7743, longitude: 46.7386 },
  routingPreference: 'TRAFFIC_AWARE'
};
const API_KEY = 'test-only-google-maps-key-0000001';

test('Google adapter sends only minimum route inputs and an explicit narrow field mask', async () => {
  const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return new Response(JSON.stringify({
      routes: [{ duration: '901.5s', distanceMeters: 12_345, polyline: { encodedPolyline: 'abc123' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = new GoogleRoutesSandboxProvider(
    { resolveApiKey: async () => API_KEY },
    { fetchImpl, nowEpochMs: () => NOW, timeoutMs: 1_000, ttlMs: 30_000 }
  );

  const result = await computeAdvisoryRouteSafely(provider, REQUEST, NOW);
  assert.equal(result.status, 'OK');
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(call.init?.method, 'POST');
  assert.equal(call.init?.redirect, 'error');
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('x-goog-api-key'), API_KEY);
  assert.equal(headers.get('x-goog-fieldmask'), 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline');

  const body = JSON.parse(String(call.init?.body)) as Readonly<Record<string, unknown>>;
  assert.deepEqual(body, {
    origin: { location: { latLng: REQUEST.origin } },
    destination: { location: { latLng: REQUEST.destination } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE'
  });
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /roadEvent|evidence|medical|legal|actor|tenant|purpose|phone|token/i);
  assert.doesNotMatch(serialized, new RegExp(API_KEY));
});

test('Google adapter converts HTTP, content-type and malformed-response failures into DEGRADED state', async () => {
  const cases: Array<typeof fetch> = [
    async () => new Response('unavailable', { status: 503, headers: { 'content-type': 'text/plain' } }),
    async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => new Response(JSON.stringify({ routes: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => new Response(JSON.stringify({ routes: [{ duration: 'bad', distanceMeters: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  ];

  for (const fetchImpl of cases) {
    const provider = new GoogleRoutesSandboxProvider(
      { resolveApiKey: async () => API_KEY },
      { fetchImpl, nowEpochMs: () => NOW, timeoutMs: 1_000, ttlMs: 30_000 }
    );
    assert.equal((await computeAdvisoryRouteSafely(provider, REQUEST, NOW)).status, 'DEGRADED');
  }
});

test('Google adapter rejects malformed credentials without issuing a network request', async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = new GoogleRoutesSandboxProvider(
    { resolveApiKey: async () => 'short key with spaces' },
    { fetchImpl, nowEpochMs: () => NOW }
  );
  const result = await computeAdvisoryRouteSafely(provider, REQUEST, NOW);
  assert.equal(result.status, 'DEGRADED');
  assert.equal(called, false);
});

test('oversized Google response is rejected before it can become advisory routing data', async () => {
  const fetchImpl: typeof fetch = async () => new Response('x', {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(65 * 1024) }
  });
  const provider = new GoogleRoutesSandboxProvider(
    { resolveApiKey: async () => API_KEY },
    { fetchImpl, nowEpochMs: () => NOW }
  );
  assert.equal((await computeAdvisoryRouteSafely(provider, REQUEST, NOW)).status, 'DEGRADED');
});
