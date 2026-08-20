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
  issuer: 'https://identity.example.test', audience: 'ros-api',
  allowedClientIds: ['traffic-sandbox'], allowedTenantIds: ['riyadh-pilot'],
  allowedPurposes: ['TRAFFIC_COORDINATION'], requireMfa: true,
  maxTokenAgeSeconds: 600, maxClockSkewSeconds: 30
};

function verifier(claims: VerifiedOidcClaims = CLAIMS): OidcTokenVerifierPort {
  return { verifyBearerToken: async () => claims };
}

test('accepts only claims returned by trusted verifier', async () => {
  assert.deepEqual(await resolveTrustedIntegrationPrincipal('signed-token', verifier(), POLICY, NOW), {
    subject: 'integration-service-1', clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION', mfaVerified: true
  });
});

test('rejects issuer audience client tenant and purpose drift', async () => {
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuer: 'https://evil.example' }), POLICY, NOW), /issuer is not trusted/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, audience: 'other-api' }), POLICY, NOW), /audience is not trusted/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, clientId: 'unknown-client' }), POLICY, NOW), /client is not authorized/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, tenantId: 'other-tenant' }), POLICY, NOW), /tenant is not authorized/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' }), POLICY, NOW), /purpose is not authorized/);
});

test('rejects missing MFA and unsafe token timing', async () => {
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, authenticationMethods: ['pwd'] }), POLICY, NOW), /MFA authentication is required/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, expiresAtEpochSeconds: NOW - 31 }), POLICY, NOW), /Token is expired/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuedAtEpochSeconds: NOW + 31 }), POLICY, NOW), /issued-at time is in the future/);
  await assert.rejects(resolveTrustedIntegrationPrincipal('token', verifier({ ...CLAIMS, issuedAtEpochSeconds: NOW - 631 }), POLICY, NOW), /older than the allowed session age/);
});
