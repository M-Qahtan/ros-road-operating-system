import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationPrincipalPolicy, OidcTokenVerifierPort, VerifiedOidcClaims } from '../integrations/integration-principal.js';
import {
  createActorResolverForEnvironment,
  createOidcIntegrationActorResolver
} from './actor-resolver.js';

const INTEGRATION_ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_800_000_000;
const CLAIMS: VerifiedOidcClaims = {
  subject: INTEGRATION_ACTOR_ID,
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
  allowedClientIds: ['traffic-sandbox'],
  allowedTenantIds: ['riyadh-pilot'],
  allowedPurposes: ['TRAFFIC_COORDINATION'],
  requireMfa: true,
  maxTokenAgeSeconds: 600,
  maxClockSkewSeconds: 30
};

function verifier(claims: VerifiedOidcClaims = CLAIMS): OidcTokenVerifierPort {
  return { verifyBearerToken: async () => claims };
}

const trustedClock = () => NOW;

test('development may resolve deterministic simulation headers', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'development' });
  assert.deepEqual(
    await resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR,SUPERVISOR' }),
    { actorId: 'operator-1', roles: ['OPERATOR', 'SUPERVISOR'] }
  );
});

test('staging requires explicit simulation auth profile for header identity', async () => {
  const denied = createActorResolverForEnvironment({ NODE_ENV: 'staging' });
  await assert.rejects(
    denied.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR' }),
    /Trusted OIDC\/JWT actor resolver is required/
  );

  const simulation = createActorResolverForEnvironment({
    NODE_ENV: 'staging',
    ROS_AUTH_PROFILE: 'simulation'
  });
  assert.equal(
    (await simulation.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR' })).actorId,
    'operator-1'
  );
});

test('production rejects self-attested actor headers even when simulation is requested', async () => {
  const resolver = createActorResolverForEnvironment({
    NODE_ENV: 'production',
    ROS_AUTH_PROFILE: 'simulation'
  });
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': 'attacker', 'x-ros-roles': 'SUPERVISOR' }),
    /self-attested actor headers are disabled/
  );
});

test('simulation header resolver rejects missing or unknown roles', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'test' });
  await assert.rejects(resolver.resolve({ 'x-actor-id': 'operator-1' }), /Missing actor identity headers/);
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'ROOT' }),
    /No recognized ROS role/
  );
});

test('trusted OIDC resolver maps only a verified UUID subject to INTEGRATION_SERVICE', async () => {
  const oidc = createOidcIntegrationActorResolver(verifier(), POLICY, trustedClock);
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'production' }, oidc);

  assert.deepEqual(
    await resolver.resolve({
      authorization: 'Bearer signed-token',
      'x-actor-id': 'attacker-controlled',
      'x-ros-roles': 'SUPERVISOR'
    }),
    { actorId: INTEGRATION_ACTOR_ID, roles: ['INTEGRATION_SERVICE'] }
  );
});

test('trusted OIDC resolver rejects missing bearer token, invalid claims and non-UUID subjects', async () => {
  const resolver = createOidcIntegrationActorResolver(verifier(), POLICY, trustedClock);
  await assert.rejects(resolver.resolve({}), /Bearer authorization is required/);

  const wrongTenant = createOidcIntegrationActorResolver(
    verifier({ ...CLAIMS, tenantId: 'other-tenant' }),
    POLICY,
    trustedClock
  );
  await assert.rejects(
    wrongTenant.resolve({ authorization: 'Bearer signed-token' }),
    /Trusted OIDC\/JWT identity could not be verified/
  );

  const nonUuid = createOidcIntegrationActorResolver(
    verifier({ ...CLAIMS, subject: 'integration-service-1' }),
    POLICY,
    trustedClock
  );
  await assert.rejects(
    nonUuid.resolve({ authorization: 'Bearer signed-token' }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
});

test('trusted OIDC resolver fails closed when the injected verifier clock is invalid', async () => {
  const resolver = createOidcIntegrationActorResolver(verifier(), POLICY, () => 0);
  await assert.rejects(
    resolver.resolve({ authorization: 'Bearer signed-token' }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
});
