import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMobileSecurityHeaders } from './server-security.js';

test('mobile responses deny framing and harden content handling', () => {
  const headers = buildMobileSecurityHeaders('https://api.ros.example');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.match(headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /base-uri 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /object-src 'none'/);
  assert.match(headers['content-security-policy'] ?? '', /connect-src 'self' https:\/\/api\.ros\.example/);
});

test('security header builder rejects injected or credential-bearing origins', () => {
  assert.throws(() => buildMobileSecurityHeaders("https://api.ros.example'; frame-ancestors *"), TypeError);
  assert.throws(() => buildMobileSecurityHeaders('https://user:secret@api.ros.example'), TypeError);
});
