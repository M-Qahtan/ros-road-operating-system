import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { JwksHttpFetchPort, JwksHttpResponsePort } from '../integrations/jwks-https-fetcher.js';
import { createRuntimeActorResolver } from './runtime-actor-resolver.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const exportedJwk = publicKey.export({ format: 'jwk' });

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(payloadOverrides: Readonly<Record<string, unknown>> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'runtime-key-1' });
  const payload = encode({
    sub: ACTOR_ID,
    iss: 'https://identity.example.test',
    aud: ['ros-api'],
    azp: 'ros-operations',
    tenant_id: 'riyadh-pilot',
    purpose: 'ROAD_SAFETY_OPERATIONS',
    ros_roles: ['OPERATOR'],
    amr: ['mfa'],
    iat: now - 10,
    exp: now + 300,
    ...payloadOverrides
  });
  const input = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(input, 'ascii'), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

function jwksResponse(): JwksHttpResponsePort {
  const body = JSON.stringify({
    keys: [{
      ...exportedJwk,
      kid: 'runtime-key-1',
      alg: 'RS256',
      use: 'sig',
      key_ops: ['verify']
    }]
  });
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'content-type') return 'application/jwk-set+json';
        return null;
      }
    },
    text: async () => body
  };
}

const fakeFetch: JwksHttpFetchPort = async () => jwksResponse();

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ROS_AUTH_PROFILE: 'oidc',
    OIDC_ISSUER: 'https://identity.example.test',
    OIDC_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
    OIDC_AUDIENCE: 'ros-api',
    OIDC_ALLOWED_CLIENT_IDS: 'ros-operations',
    OIDC_ALLOWED_TENANT_IDS: 'riyadh-pilot',
    OIDC_ALLOWED_PURPOSES: 'ROAD_SAFETY_OPERATIONS',
    OIDC_ALLOWED_ROLES: 'OPERATOR,SUPERVISOR,AUDITOR',
    OIDC_MAX_TOKEN_AGE_SECONDS: '600',
    OIDC_MAX_CLOCK_SKEW_SECONDS: '30',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300',
    OIDC_JWKS_MIN_REFRESH_SECONDS: '5',
    ...overrides
  };
}

const simulationScope = {
  'x-tenant-id': 'riyadh-pilot',
  'x-purpose': 'ROAD_SAFETY_OPERATIONS'
} as const;

test('development keeps deterministic scoped simulation auth without OIDC configuration', async () => {
  const resolver = createRuntimeActorResolver({ NODE_ENV: 'development' });
  assert.deepEqual(
    await resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR', ...simulationScope }),
    {
      actorId: 'operator-1',
      roles: ['OPERATOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'ROAD_SAFETY_OPERATIONS'
    }
  );
});

test('production fails closed unless OIDC profile and required trust inputs are configured', () => {
  assert.throws(
    () => createRuntimeActorResolver({ NODE_ENV: 'production' }),
    /ROS_AUTH_PROFILE=oidc/
  );
  assert.throws(
    () => createRuntimeActorResolver({ NODE_ENV: 'production', ROS_AUTH_PROFILE: 'oidc' }),
    /OIDC_ISSUER is required/
  );
  assert.throws(
    () => createRuntimeActorResolver(productionEnvironment({ OIDC_JWKS_URL: 'http://identity.example.test/jwks' })),
    /must use HTTPS/
  );
  assert.throws(
    () => createRuntimeActorResolver(productionEnvironment({ OIDC_ALLOWED_ROLES: 'ROOT' })),
    /unsupported ROS role/
  );
});

test('production runtime verifies signed bearer identity, RBAC and resource scope', async () => {
  const resolver = createRuntimeActorResolver(productionEnvironment(), { jwksFetch: fakeFetch });
  assert.deepEqual(
    await resolver.resolve({
      authorization: `Bearer ${token()}`,
      'x-actor-id': 'attacker',
      'x-ros-roles': 'SUPERVISOR',
      'x-tenant-id': 'other-tenant',
      'x-purpose': 'INSURANCE_COORDINATION'
    }),
    {
      actorId: ACTOR_ID,
      roles: ['OPERATOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'ROAD_SAFETY_OPERATIONS'
    }
  );
});

test('production preserves an exact trailing-slash issuer trust value', async () => {
  const issuer = 'https://identity.example.test/';
  const resolver = createRuntimeActorResolver(
    productionEnvironment({ OIDC_ISSUER: issuer }),
    { jwksFetch: fakeFetch }
  );
  assert.deepEqual(
    await resolver.resolve({ authorization: `Bearer ${token({ iss: issuer })}` }),
    {
      actorId: ACTOR_ID,
      roles: ['OPERATOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'ROAD_SAFETY_OPERATIONS'
    }
  );
});

test('production runtime rejects signed tokens outside tenant, purpose or role policy', async () => {
  const resolver = createRuntimeActorResolver(productionEnvironment(), { jwksFetch: fakeFetch });
  await assert.rejects(
    resolver.resolve({ authorization: `Bearer ${token({ tenant_id: 'other-tenant' })}` }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
  await assert.rejects(
    resolver.resolve({ authorization: `Bearer ${token({ purpose: 'INSURANCE_COORDINATION' })}` }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
  await assert.rejects(
    resolver.resolve({ authorization: `Bearer ${token({ ros_roles: ['SUPERVISOR', 'ROOT'] })}` }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
  await assert.rejects(
    resolver.resolve({ authorization: `Bearer ${token({ ros_roles: ['INTEGRATION_SERVICE'] })}` }),
    /Trusted OIDC\/JWT identity could not be verified/
  );
});

test('non-production staging still requires explicit simulation or OIDC profile', async () => {
  assert.throws(
    () => createRuntimeActorResolver({ NODE_ENV: 'staging' }),
    /ROS_AUTH_PROFILE=oidc/
  );
  const resolver = createRuntimeActorResolver({ NODE_ENV: 'staging', ROS_AUTH_PROFILE: 'simulation' });
  assert.deepEqual(
    await resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR', ...simulationScope }),
    {
      actorId: 'operator-1',
      roles: ['OPERATOR'],
      tenantId: 'riyadh-pilot',
      purpose: 'ROAD_SAFETY_OPERATIONS'
    }
  );
});
