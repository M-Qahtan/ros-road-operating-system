import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationPrincipalPolicy, OidcTokenVerifierPort, VerifiedOidcClaims } from '../integrations/integration-principal.js';
import { createActorResolverForEnvironment, createOidcIntegrationActorResolver } from './actor-resolver.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_800_000_000;
const CLAIMS: VerifiedOidcClaims = {
  subject: ACTOR_ID,
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

test('development simulation requires explicit actor and access scope headers', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'test' });
  assert.deepEqual(await resolver.resolve({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'OPERATOR,SUPERVISOR',
    'x-tenant-id': 'riyadh-pilot',
    'x-purpose': 'road-safety-response'
  }), {
    actorId: ACTOR_ID,
    roles: ['OPERATOR', 'SUPERVISOR'],
    tenantId: 'riyadh-pilot',
    purpose: 'road-safety-response'
  });
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': ACTOR_ID, 'x-ros-roles': 'OPERATOR' }),
    /access-scope headers/
  );
});

test('production denies self-attested headers without a trusted resolver', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'production', ROS_AUTH_PROFILE: 'simulation' });
  await assert.rejects(resolver.resolve({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'attacker-tenant',
    'x-purpose': 'attacker-purpose'
  }), /self-attested actor headers are disabled/);
});

test('trusted OIDC identity supplies authoritative tenant and purpose and ignores attacker headers', async () => {
  const oidc = createOidcIntegrationActorResolver(verifier(), POLICY, () => NOW);
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'production' }, oidc);
  assert.deepEqual(await resolver.resolve({
    authorization: 'Bearer signed-token',
    'x-actor-id': 'attacker-controlled',
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'attacker-tenant',
    'x-purpose': 'INSURANCE_COORDINATION'
  }), {
    actorId: ACTOR_ID,
    roles: ['INTEGRATION_SERVICE'],
    tenantId: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION'
  });
});

test('trusted OIDC resolver rejects missing bearer, unauthorized scope, missing MFA and non-UUID subject', async () => {
  const resolver = createOidcIntegrationActorResolver(verifier(), POLICY, () => NOW);
  await assert.rejects(resolver.resolve({}), /Bearer authorization is required/);
  await assert.rejects(
    createOidcIntegrationActorResolver(verifier({ ...CLAIMS, tenantId: 'other-tenant' }), POLICY, () => NOW)
      .resolve({ authorization: 'Bearer signed-token' }),
    /could not be verified/
  );
  await assert.rejects(
    createOidcIntegrationActorResolver(verifier({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' }), POLICY, () => NOW)
      .resolve({ authorization: 'Bearer signed-token' }),
    /could not be verified/
  );
  await assert.rejects(
    createOidcIntegrationActorResolver(verifier({ ...CLAIMS, authenticationMethods: ['pwd'] }), POLICY, () => NOW)
      .resolve({ authorization: 'Bearer signed-token' }),
    /could not be verified/
  );
  await assert.rejects(
    createOidcIntegrationActorResolver(verifier({ ...CLAIMS, subject: 'integration-service-1' }), POLICY, () => NOW)
      .resolve({ authorization: 'Bearer signed-token' }),
    /could not be verified/
  );
});
