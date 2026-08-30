import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardSecurityHeaders } from './web-security.js';

test('dashboard responses deny framing and unsafe content interpretation', () => {
  const headers = dashboardSecurityHeaders('https://api.ros.example');

  assert.match(headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /base-uri 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /object-src 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /connect-src 'self' https:\/\/api\.ros\.example/);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cache-control'], 'no-store');
});
