import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { IntegrationPrincipalPolicy, OidcTokenVerifierPort, VerifiedOidcClaims } from '../integrations/integration-principal.js';
import { createOidcIntegrationActorResolver } from './actor-resolver.js';
import { createRoadEventHttpHandler, HttpRequest } from './road-event-http.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = 1_800_000_000;
const TRUSTED_SCOPE = { tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION' } as const;
const CLAIMS: VerifiedOidcClaims = {
  subject: ACTOR_ID,
  issuer: 'https://identity.example.test',
  audience: 'ros-api',
  clientId: 'traffic-sandbox',
  ...TRUSTED_SCOPE,
  authenticationMethods: ['mfa'],
  issuedAtEpochSeconds: NOW - 30,
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

function fixture(claims: VerifiedOidcClaims = CLAIMS) {
  const repository = new MemoryRoadEventRepository();
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(repository),
    repository
  );
  const handler = createRoadEventHttpHandler(
    application,
    createOidcIntegrationActorResolver(verifier(claims), POLICY, () => NOW)
  );
  return { repository, handler };
}

function request(headers: Readonly<Record<string, string | undefined>>, id = EVENT_ID): HttpRequest {
  return {
    method: 'POST',
    path: '/api/v1/road-events',
    query: {},
    headers,
    body: { id, occurredAt: '2026-08-19T20:00:00.000Z', latitude: 24.7136, longitude: 46.6753 },
    traceId: 'trace-oidc-http-001'
  };
}

test('trusted OIDC tenant and purpose become the persisted RoadEvent access scope', async () => {
  const { repository, handler } = fixture();
  const response = await handler(request({
    authorization: 'Bearer signed-token',
    'x-actor-id': 'attacker',
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'attacker-tenant',
    'x-purpose': 'INSURANCE_COORDINATION',
    'idempotency-key': 'oidc-create-0001'
  }));
  assert.equal(response.status, 201);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, TRUSTED_SCOPE)).total, 1);
  assert.equal((await repository.list(
    { limit: 20, offset: 0 },
    { tenantId: 'attacker-tenant', purpose: 'INSURANCE_COORDINATION' }
  )).total, 0);
});

test('HTTP path fails closed when bearer identity is absent despite complete self-attested scope', async () => {
  const { handler } = fixture();
  const response = await handler(request({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'riyadh-pilot',
    'x-purpose': 'TRAFFIC_COORDINATION',
    'idempotency-key': 'oidc-create-0002'
  }));
  assert.equal(response.status, 403);
  assert.equal((response.body as { error: { code: string } }).error.code, 'FORBIDDEN');
});

test('signed token with wrong exact binding cannot create a RoadEvent', async () => {
  const { repository, handler } = fixture({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' });
  const response = await handler(request({
    authorization: 'Bearer signed-token',
    'idempotency-key': 'oidc-create-0003'
  }));
  assert.equal(response.status, 403);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, TRUSTED_SCOPE)).total, 0);
});
