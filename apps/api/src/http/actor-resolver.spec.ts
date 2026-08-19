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
  roles: ['INTEGRATION_SERVICE'],
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
const simulationScope = {
  'x-tenant-id': 'riyadh-pilot',
  'x-purpose': 'TRAFFIC_COORDINATION'
} as const;

test('development may resolve deterministic simulation headers with explicit scope', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'development' });
  assert.deepEqual(
    await resolver.resolve({
      'x-actor-id': 'operator-1',
      'x-ros-roles': 'OPERATOR,SUPERVISOR',
      ...simulationScope
    }),
    {
      actorId: 'operator-1',
      roles: ['OPERATOR', 'SUPERVISOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'TRAFFIC_COORDINATION'
    }
  );
});

test('staging requires explicit simulation auth profile for header identity and scope', async () => {
  const denied = createActorResolverForEnvironment({ NODE_ENV: 'staging' });
  await assert.rejects(
    denied.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR', ...simulationScope }),
    /Trusted OIDC\/JWT actor resolver is required/
  );

  const simulation = createActorResolverForEnvironment({
    NODE_ENV: 'staging',
    ROS_AUTH_PROFILE: 'simulation'
  });
  assert.deepEqual(
    await simulation.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR', ...simulationScope }),
    {
      actorId: 'operator-1',
      roles: ['OPERATOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'TRAFFIC_COORDINATION'
    }
  );
});

test('production rejects self-attested actor and scope headers even when simulation is requested', async () => {
  const resolver = createActorResolverForEnvironment({
    NODE_ENV: 'production',
    ROS_AUTH_PROFILE: 'simulation'
  });
  await assert.rejects(
    resolver.resolve({
      'x-actor-id': 'attacker',
      'x-ros-roles': 'SUPERVISOR',
      'x-tenant-id': 'attacker-tenant',
      'x-purpose': 'TRAFFIC_COORDINATION'
    }),
    /self-attested actor headers are disabled/
  );
});

test('simulation header resolver rejects missing role or access scope', async () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'test' });
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': 'operator-1', ...simulationScope }),
    /Missing actor identity headers/
  );
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'ROOT', ...simulationScope }),
    /No recognized ROS role/
  );
  await assert.rejects(
    resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR', 'x-purpose': 'TRAFFIC_COORDINATION' }),
    /simulation tenant/
  );
});

test('trusted integration resolver maps verified subject, tenant and purpose and ignores self-attested headers', async () => {
  const oidc = createOidcIntegrationActorResolver(verifier(), POLICY, trustedClock);
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'production' }, oidc);

  assert.deepEqual(
    await resolver.resolve({
      authorization: 'Bearer signed-token',
      'x-actor-id': 'attacker-controlled',
      'x-ros-roles': 'SUPERVISOR',
      'x-tenant-id': 'attacker-tenant',
      'x-purpose': 'INSURANCE_COORDINATION'
    }),
    {
      actorId: INTEGRATION_ACTOR_ID,
      roles: ['INTEGRATION_SERVICE'],
      tenantId: 'riyadh-pilot',
      purpose: 'TRAFFIC_COORDINATION'
    }
  );
});

test('trusted integration resolver rejects missing bearer token, invalid claims and non-UUID subjects', async () => {
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

test('trusted integration resolver fails closed when the injected verifier clock is invalid', async () => {
  const resolver = createOidcIntegrationActorResolver(verifier(), POLICY, () => 0);
  await assert.rejects(
    resolver.resolve({ authorization: 'Bearer signed-token' }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
});
