import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdvisoryRouteRequest,
  MapProviderPort,
  computeAdvisoryRouteSafely,
  parseMinimumNecessaryRouteRequest
} from './map-provider.js';

const NOW = 1_800_000_000_000;
const REQUEST: AdvisoryRouteRequest = {
  origin: { latitude: 24.7136, longitude: 46.6753 },
  destination: { latitude: 24.7743, longitude: 46.7386 },
  routingPreference: 'TRAFFIC_AWARE'
};

test('minimum-necessary parser accepts only coordinates and routing preference', () => {
  assert.deepEqual(parseMinimumNecessaryRouteRequest(REQUEST), REQUEST);
  assert.throws(() => parseMinimumNecessaryRouteRequest({
    ...REQUEST,
    roadEventId: '550e8400-e29b-41d4-a716-446655440000'
  }), /unsupported field roadEventId/);
  assert.throws(() => parseMinimumNecessaryRouteRequest({
    ...REQUEST,
    evidence: { objectKey: 'secret-evidence' }
  }), /unsupported field evidence/);
  assert.throws(() => parseMinimumNecessaryRouteRequest({
    ...REQUEST,
    medicalNarrative: 'not allowed'
  }), /unsupported field medicalNarrative/);
});

test('route request rejects malformed coordinates and unsupported routing modes', () => {
  assert.throws(() => parseMinimumNecessaryRouteRequest({
    ...REQUEST,
    origin: { latitude: 91, longitude: 46.6 }
  }), /coordinate range/);
  assert.throws(() => parseMinimumNecessaryRouteRequest({
    ...REQUEST,
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL'
  }), /unsupported/);
});

test('provider failure degrades safely without inventing route authority', async () => {
  const provider: MapProviderPort = {
    providerId: 'test-provider',
    computeAdvisoryRoute: async () => { throw new Error('provider unavailable'); }
  };
  assert.deepEqual(await computeAdvisoryRouteSafely(provider, REQUEST, NOW), {
    providerId: 'test-provider',
    status: 'DEGRADED',
    observedAtEpochMs: NOW,
    expiresAtEpochMs: NOW,
    degradedReason: 'provider unavailable'
  });
});

test('stale, wrong-provider and malformed route metrics all fail toward DEGRADED', async () => {
  const stale: MapProviderPort = {
    providerId: 'test-provider',
    computeAdvisoryRoute: async () => ({
      providerId: 'test-provider', status: 'OK', observedAtEpochMs: NOW - 60_000,
      expiresAtEpochMs: NOW - 1, distanceMeters: 1_000, durationSeconds: 100
    })
  };
  assert.equal((await computeAdvisoryRouteSafely(stale, REQUEST, NOW)).status, 'DEGRADED');

  const wrongProvider: MapProviderPort = {
    providerId: 'test-provider',
    computeAdvisoryRoute: async () => ({
      providerId: 'other-provider', status: 'OK', observedAtEpochMs: NOW,
      expiresAtEpochMs: NOW + 30_000, distanceMeters: 1_000, durationSeconds: 100
    })
  };
  assert.equal((await computeAdvisoryRouteSafely(wrongProvider, REQUEST, NOW)).status, 'DEGRADED');

  const malformedMetrics: MapProviderPort = {
    providerId: 'test-provider',
    computeAdvisoryRoute: async () => ({
      providerId: 'test-provider', status: 'OK', observedAtEpochMs: NOW,
      expiresAtEpochMs: NOW + 30_000, distanceMeters: -1, durationSeconds: 100
    })
  };
  assert.equal((await computeAdvisoryRouteSafely(malformedMetrics, REQUEST, NOW)).status, 'DEGRADED');
});

test('fresh advisory result remains explicitly provider-derived and bounded', async () => {
  const provider: MapProviderPort = {
    providerId: 'test-provider',
    computeAdvisoryRoute: async () => ({
      providerId: 'test-provider', status: 'OK', observedAtEpochMs: NOW,
      expiresAtEpochMs: NOW + 30_000, distanceMeters: 12_345, durationSeconds: 901.5,
      encodedPolyline: 'abc123'
    })
  };
  assert.deepEqual(await computeAdvisoryRouteSafely(provider, REQUEST, NOW), {
    providerId: 'test-provider',
    status: 'OK',
    observedAtEpochMs: NOW,
    expiresAtEpochMs: NOW + 30_000,
    distanceMeters: 12_345,
    durationSeconds: 901.5,
    encodedPolyline: 'abc123'
  });
});
