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
const CLAIMS: VerifiedOidcClaims = {
  subject: ACTOR_ID,
  issuer: 'https://identity.example.test',
  audience: 'ros-api',
  clientId: 'traffic-sandbox',
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION',
  authenticationMethods: ['mfa'],
  issuedAtEpochSeconds: NOW - 30,
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

function verifier(): OidcTokenVerifierPort {
  return { verifyBearerToken: async () => CLAIMS };
}

function fixture() {
  const repository = new MemoryRoadEventRepository();
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(),
    repository
  );
  return createRoadEventHttpHandler(
    application,
    createOidcIntegrationActorResolver(verifier(), POLICY)
  );
}

function request(headers: Readonly<Record<string, string | undefined>>): HttpRequest {
  return {
    method: 'POST',
    path: '/api/v1/road-events',
    query: {},
    headers,
    body: {
      id: EVENT_ID,
      occurredAt: '2026-08-19T20:00:00.000Z',
      latitude: 24.7136,
      longitude: 46.6753
    },
    traceId: 'trace-oidc-http-001'
  };
}

test('HTTP command path awaits trusted OIDC actor and ignores self-attested role headers', async () => {
  const handle = fixture();
  const response = await handle(request({
    authorization: 'Bearer signed-token',
    'x-actor-id': 'attacker',
    'x-ros-roles': 'SUPERVISOR',
    'idempotency-key': 'oidc-create-0001'
  }));

  assert.equal(response.status, 201);
  assert.equal((response.body as { success: boolean }).success, true);
});

test('HTTP command path fails closed when trusted bearer identity is absent', async () => {
  const handle = fixture();
  const response = await handle(request({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'SUPERVISOR',
    'idempotency-key': 'oidc-create-0002'
  }));

  assert.equal(response.status, 403);
  assert.equal((response.body as { error: { code: string } }).error.code, 'FORBIDDEN');
});
