import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTrustedBrowserSession, type OperationsWindow } from './trusted-browser-session.js';

const validSession = {
  actorId: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPERVISOR'] as const,
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION',
  getAccessToken: () => Promise.resolve('signed-oidc-token')
};

test('trusted browser session rejects a missing OIDC bridge', () => {
  assert.throws(() => requireTrustedBrowserSession({} as OperationsWindow), /OIDC/);
});
test('trusted browser session accepts the validated identity and access scope', () => {
  assert.equal(
    requireTrustedBrowserSession({ rosOidcSession: validSession } as unknown as OperationsWindow),
    validSession
  );
});

test('trusted browser session rejects untrusted roles and malformed access scope', () => {
  assert.throws(() => requireTrustedBrowserSession({
    rosOidcSession: { ...validSession, roles: ['ROOT'] }
  } as unknown as OperationsWindow), /أدوار/);
  assert.throws(() => requireTrustedBrowserSession({
    rosOidcSession: { ...validSession, tenantId: '../other-tenant' }
  } as unknown as OperationsWindow), /نطاق/);
  assert.throws(() => requireTrustedBrowserSession({
    rosOidcSession: { ...validSession, actorId: 'self-asserted-operator' }
  } as unknown as OperationsWindow), /هوية/);
});
