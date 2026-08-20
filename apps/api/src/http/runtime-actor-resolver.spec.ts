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
    azp: 'traffic-sandbox',
    tenant_id: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION',
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
  const body = JSON.stringify({ keys: [{ ...exportedJwk, kid: 'runtime-key-1', alg: 'RS256', use: 'sig', key_ops: ['verify'] }] });
  return {
    ok: true,
    status: 200,
    headers: { get(name: string): string | null { return name.toLowerCase() === 'content-type' ? 'application/jwk-set+json' : null; } },
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
    OIDC_ALLOWED_CLIENT_IDS: 'traffic-sandbox',
    OIDC_ALLOWED_TENANT_IDS: 'riyadh-pilot',
    OIDC_ALLOWED_PURPOSES: 'TRAFFIC_COORDINATION',
    OIDC_MAX_TOKEN_AGE_SECONDS: '600',
    OIDC_MAX_CLOCK_SKEW_SECONDS: '30',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300',
    OIDC_JWKS_MIN_REFRESH_SECONDS: '5',
    ...overrides
  };
}

test('production runtime verifies signed bearer and returns authoritative ABAC scope', async () => {
  const resolver = createRuntimeActorResolver(productionEnvironment(), { jwksFetch: fakeFetch });
  assert.deepEqual(await resolver.resolve({
    authorization: `Bearer ${token()}`,
    'x-actor-id': 'attacker',
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

test('production fails closed without OIDC profile or trust inputs', () => {
  assert.throws(() => createRuntimeActorResolver({ NODE_ENV: 'production' }), /ROS_AUTH_PROFILE=oidc/);
  assert.throws(() => createRuntimeActorResolver({ NODE_ENV: 'production', ROS_AUTH_PROFILE: 'oidc' }), /OIDC_ISSUER is required/);
  assert.throws(
    () => createRuntimeActorResolver(productionEnvironment({ OIDC_JWKS_URL: 'http://identity.example.test/jwks' })),
    /must use HTTPS/
  );
});

test('signed but unauthorized tenant, purpose or missing MFA is rejected', async () => {
  const resolver = createRuntimeActorResolver(productionEnvironment(), { jwksFetch: fakeFetch });
  await assert.rejects(resolver.resolve({ authorization: `Bearer ${token({ tenant_id: 'other-tenant' })}` }), /could not be verified/);
  await assert.rejects(resolver.resolve({ authorization: `Bearer ${token({ purpose: 'INSURANCE_COORDINATION' })}` }), /could not be verified/);
  await assert.rejects(resolver.resolve({ authorization: `Bearer ${token({ amr: ['pwd'] })}` }), /could not be verified/);
});

test('non-production staging requires explicit simulation or OIDC profile', async () => {
  assert.throws(() => createRuntimeActorResolver({ NODE_ENV: 'staging' }), /ROS_AUTH_PROFILE=oidc/);
  const resolver = createRuntimeActorResolver({ NODE_ENV: 'staging', ROS_AUTH_PROFILE: 'simulation' });
  assert.equal((await resolver.resolve({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'OPERATOR',
    'x-tenant-id': 'riyadh-pilot',
    'x-purpose': 'road-safety-response'
  })).tenantId, 'riyadh-pilot');
});
