import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IntegrationPrincipalPolicy,
  OidcTokenVerifierPort,
  VerifiedOidcClaims,
  resolveTrustedIntegrationPrincipal
} from './integration-principal.js';

const NOW = 1_800_000_000;
const CLAIMS: VerifiedOidcClaims = {
  subject: 'integration-service-1',
  issuer: 'https://identity.example.test',
  audience: ['ros-api'],
  clientId: 'traffic-sandbox',
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION',
  authenticationMethods: ['pwd', 'mfa'],
  issuedAtEpochSeconds: NOW - 60,
  expiresAtEpochSeconds: NOW + 300
};
const POLICY: IntegrationPrincipalPolicy = {
  issuer: 'https://identity.example.test',
  audience: 'ros-api',
  allowedBindings: [
    { clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION' },
    { clientId: 'insurance-sandbox', tenantId: 'riyadh-pilot', purpose: 'INSURANCE_COORDINATION' }
  ],
  requireMfa: true,
  maxTokenAgeSeconds: 600,
  maxClockSkewSeconds: 30
};

function verifier(claims: VerifiedOidcClaims = CLAIMS): OidcTokenVerifierPort {
  return { verifyBearerToken: async () => claims };
}

test('accepts only an exact binding returned by the trusted verifier', async () => {
  assert.deepEqual(await resolveTrustedIntegrationPrincipal('signed-token', verifier(), POLICY, NOW), {
    subject: 'integration-service-1', clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION', mfaVerified: true, roles: ['INTEGRATION_SERVICE']
  });
});

test('accepts only provisioned human roles on the exact binding', async () => {
  const policy: IntegrationPrincipalPolicy = {
    ...POLICY,
    allowedBindings: [{
      clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION',
      roles: ['OPERATOR', 'SUPERVISOR']
    }]
  };
  const principal = await resolveTrustedIntegrationPrincipal(
    'signed-token', verifier({ ...CLAIMS, roles: ['OPERATOR'] }), policy, NOW
  );
  assert.deepEqual(principal.roles, ['OPERATOR']);
  await assert.rejects(
    resolveTrustedIntegrationPrincipal('signed-token', verifier({ ...CLAIMS, roles: ['AUDITOR'] }), policy, NOW),
    /not allowlisted/
  );
  await assert.rejects(
    resolveTrustedIntegrationPrincipal('signed-token', verifier(CLAIMS), policy, NOW),
    /roles claim is required/
  );
});

test('rejects issuer audience and exact principal-binding drift', async () => {
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuer: 'https://evil.example' }), POLICY, NOW), /issuer is not trusted/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, audience: 'other-api' }), POLICY, NOW), /audience is not trusted/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, clientId: 'unknown-client' }), POLICY, NOW), /principal binding is not authorized/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, tenantId: 'other-tenant' }), POLICY, NOW), /principal binding is not authorized/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' }), POLICY, NOW), /principal binding is not authorized/);
});

test('rejects a Cartesian cross-combination of values that are each allowed in different bindings', async () => {
  await assert.rejects(
    resolveTrustedIntegrationPrincipal(
      'token',
      verifier({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' }),
      POLICY,
      NOW
    ),
    /principal binding is not authorized/
  );
});

test('requires explicit MFA and rejects unsafe token timing', async () => {
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, authenticationMethods: ['otp'] }), POLICY, NOW), /Explicit MFA authentication is required/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, expiresAtEpochSeconds: NOW - 31 }), POLICY, NOW), /Token is expired/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuedAtEpochSeconds: NOW + 31 }), POLICY, NOW), /issued-at time is in the future/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuedAtEpochSeconds: NOW - 631 }), POLICY, NOW), /older than the allowed session age/);
});
