import assert from 'node:assert/strict';
import test from 'node:test';
import { corsPreflightAllowed, createCorsPolicy, resolveTraceId } from '../request-security.js';

test('resolveTraceId accepts a bounded safe identifier', () => {
  assert.equal(resolveTraceId('trace_01HZX-abc.def'), 'trace_01HZX-abc.def');
});

test('resolveTraceId replaces malformed, repeated and oversized identifiers', () => {
  for (const candidate of [
    'trace id',
    'a'.repeat(65),
    ['one', 'two'],
    'line\nbreak',
    ''
  ] as const) {
    const traceId = resolveTraceId(candidate);
    assert.match(traceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test('CORS policy accepts exact HTTPS origins and local HTTP only outside production', () => {
  const policy = createCorsPolicy({
    NODE_ENV: 'staging',
    ROS_CORS_ALLOWED_ORIGINS: 'http://localhost:3001,https://mobile.ros.example'
  });
  assert.equal(policy.allowedOrigins.has('http://localhost:3001'), true);
  assert.equal(policy.allowedOrigins.has('https://mobile.ros.example'), true);
  assert.throws(
    () => createCorsPolicy({ NODE_ENV: 'staging', ROS_CORS_ALLOWED_ORIGINS: 'http://dashboard.example' }),
    /loopback/
  );
  assert.throws(
    () => createCorsPolicy({ NODE_ENV: 'production', ROS_CORS_ALLOWED_ORIGINS: 'http://localhost:3001' }),
    /HTTPS/
  );
});

test('CORS policy rejects wildcard, path, credentials and duplicate origins', () => {
  for (const value of [
    '*',
    'https://dashboard.example/path',
    'https://user:pass@dashboard.example',
    'https://dashboard.example,https://dashboard.example'
  ]) {
    assert.throws(() => createCorsPolicy({ NODE_ENV: 'production', ROS_CORS_ALLOWED_ORIGINS: value }));
  }
});

test('preflight permits only the bounded methods and request headers', () => {
  assert.equal(corsPreflightAllowed('POST', 'Authorization, Content-Type, Idempotency-Key'), true);
  assert.equal(corsPreflightAllowed('POST', 'Authorization, Content-Type, Idempotency-Key, X-Device-Id'), true);
  assert.equal(corsPreflightAllowed('DELETE', 'Authorization'), false);
  assert.equal(corsPreflightAllowed('POST', 'Authorization, Cookie'), false);
  assert.equal(corsPreflightAllowed('POST', 'Authorization, X-Device-Ownership'), false);
});
