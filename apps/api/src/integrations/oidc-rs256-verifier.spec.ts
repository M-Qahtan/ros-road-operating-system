import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  OidcTokenVerificationError,
  OidcVerificationKeyProviderPort,
  Rs256OidcTokenVerifier
} from './oidc-rs256-verifier.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function createToken(
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  headerOverrides: Readonly<Record<string, unknown>> = {}
): string {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'key-1', ...headerOverrides });
  const payload = encode({
    sub: 'integration-service-1',
    iss: 'https://identity.example.test',
    aud: ['ros-api'],
    azp: 'traffic-sandbox',
    tenant_id: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION',
    ros_roles: ['INTEGRATION_SERVICE'],
    amr: ['pwd', 'mfa'],
    iat: 1_800_000_000,
    exp: 1_800_000_600,
    ...payloadOverrides
  });
  const input = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(input, 'ascii'), privateKey).toString('base64url');
  return `${input}.${signature}`;
}

function provider(key = publicKey): OidcVerificationKeyProviderPort {
  return {
    resolveRs256PublicKey: async (kid: string) => kid === 'key-1' ? key : undefined
  };
}

test('verifies RS256 signature before returning authoritative identity, RBAC and ABAC claims', async () => {
  const verifier = new Rs256OidcTokenVerifier(provider());
  assert.deepEqual(await verifier.verifyBearerToken(createToken()), {
    subject: 'integration-service-1',
    issuer: 'https://identity.example.test',
    audience: ['ros-api'],
    clientId: 'traffic-sandbox',
    tenantId: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION',
    roles: ['INTEGRATION_SERVICE'],
    authenticationMethods: ['pwd', 'mfa'],
    issuedAtEpochSeconds: 1_800_000_000,
    expiresAtEpochSeconds: 1_800_000_600
  });
});

test('rejects a payload changed after signing', async () => {
  const verifier = new Rs256OidcTokenVerifier(provider());
  const token = createToken();
  const [header, , signature] = token.split('.');
  const tamperedPayload = encode({
    sub: 'attacker',
    iss: 'https://identity.example.test',
    aud: 'ros-api',
    azp: 'traffic-sandbox',
    tenant_id: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION',
    ros_roles: ['SUPERVISOR'],
    amr: ['mfa'],
    iat: 1_800_000_000,
    exp: 1_800_000_600
  });

  await assert.rejects(
    verifier.verifyBearerToken(`${header}.${tamperedPayload}.${signature}`),
    /signature verification failed/
  );
});

test('rejects algorithm substitution and unknown signing keys', async () => {
  const verifier = new Rs256OidcTokenVerifier(provider());
  await assert.rejects(verifier.verifyBearerToken(createToken({}, { alg: 'none' })), /alg must be exactly RS256/);
  await assert.rejects(verifier.verifyBearerToken(createToken({}, { kid: 'unknown-key' })), /signing key is not trusted/);
});

test('rejects non-RSA and weak RSA verification keys', async () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(
    new Rs256OidcTokenVerifier(provider(ec.publicKey)).verifyBearerToken(createToken()),
    /verification key must be RSA/
  );

  const weakRsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
  await assert.rejects(
    new Rs256OidcTokenVerifier(provider(weakRsa.publicKey)).verifyBearerToken(createToken()),
    /at least 2048 bits/
  );
});

test('rejects malformed tokens, non-canonical encoding and missing authoritative claims', async () => {
  const verifier = new Rs256OidcTokenVerifier(provider());
  await assert.rejects(verifier.verifyBearerToken('not-a-jwt'), OidcTokenVerificationError);
  const valid = createToken();
  const [header, payload, signature] = valid.split('.') as [string, string, string];
  await assert.rejects(verifier.verifyBearerToken(`${header}=.${payload}.${signature}`), /canonical base64url/);
  await assert.rejects(verifier.verifyBearerToken(createToken({ tenant_id: '' })), /tenant_id claim is required/);
  await assert.rejects(verifier.verifyBearerToken(createToken({ ros_roles: [] })), /ros_roles claim must be a non-empty string array/);
  await assert.rejects(verifier.verifyBearerToken(createToken({ ros_roles: ['OPERATOR', 'OPERATOR'] })), /must not contain duplicate values/);
  await assert.rejects(verifier.verifyBearerToken(createToken({ amr: 'mfa' })), /amr claim must be a string array/);
});

test('rejects unsupported critical headers', async () => {
  const verifier = new Rs256OidcTokenVerifier(provider());
  await assert.rejects(verifier.verifyBearerToken(createToken({}, { crit: ['exp'] })), /critical headers are not supported/);
});
