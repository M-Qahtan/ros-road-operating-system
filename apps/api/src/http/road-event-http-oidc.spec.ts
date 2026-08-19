import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { OidcTokenVerifierPort, VerifiedOidcClaims } from '../integrations/integration-principal.js';
import { createOidcRosActorResolver, TrustedRosActorPolicy } from './actor-resolver.js';
import { createRoadEventHttpHandler, HttpRequest } from './road-event-http.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = 1_800_000_000;
const CLAIMS: VerifiedOidcClaims = {
  subject: ACTOR_ID,
  issuer: 'https://identity.example.test',
  audience: 'ros-api',
  clientId: 'ros-operations',
  tenantId: 'riyadh-pilot',
  purpose: 'ROAD_SAFETY_OPERATIONS',
  roles: ['OPERATOR'],
  authenticationMethods: ['mfa'],
  issuedAtEpochSeconds: NOW - 30,
  expiresAtEpochSeconds: NOW + 300
};
const POLICY: TrustedRosActorPolicy = {
  issuer: 'https://identity.example.test',
  audience: 'ros-api',
  allowedClientIds: ['ros-operations'],
  allowedTenantIds: ['riyadh-pilot'],
  allowedPurposes: ['ROAD_SAFETY_OPERATIONS'],
  allowedRoles: ['OPERATOR', 'SUPERVISOR', 'AUDITOR'],
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
    new MemorySignalAttachmentAdapter(),
    repository
  );
  return {
    handle: createRoadEventHttpHandler(
      application,
      createOidcRosActorResolver(verifier(claims), POLICY, () => NOW)
    ),
    repository
  };
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

test('HTTP command path awaits trusted OIDC actor and ignores self-attested RBAC/ABAC headers', async () => {
  const { handle, repository } = fixture();
  const response = await handle(request({
    authorization: 'Bearer signed-token',
    'x-actor-id': 'attacker',
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'attacker-tenant',
    'x-purpose': 'INSURANCE_COORDINATION',
    'idempotency-key': 'oidc-create-0001'
  }));

  assert.equal(response.status, 201);
  assert.equal((response.body as { success: boolean }).success, true);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, {
    tenantId: 'riyadh-pilot',
    purpose: 'ROAD_SAFETY_OPERATIONS'
  })).total, 1);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, {
    tenantId: 'attacker-tenant',
    purpose: 'INSURANCE_COORDINATION'
  })).total, 0);
});

test('HTTP command path fails closed when trusted bearer identity is absent', async () => {
  const { handle } = fixture();
  const response = await handle(request({
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'riyadh-pilot',
    'x-purpose': 'ROAD_SAFETY_OPERATIONS',
    'idempotency-key': 'oidc-create-0002'
  }));

  assert.equal(response.status, 403);
  assert.equal((response.body as { error: { code: string } }).error.code, 'FORBIDDEN');
});

test('HTTP command path rejects cryptographically verified claims outside RBAC or purpose policy', async () => {
  const wrongPurpose = fixture({ ...CLAIMS, purpose: 'INSURANCE_COORDINATION' });
  const wrongPurposeResponse = await wrongPurpose.handle(request({
    authorization: 'Bearer signed-token',
    'idempotency-key': 'oidc-create-0003'
  }));
  assert.equal(wrongPurposeResponse.status, 403);

  const wrongRole = fixture({ ...CLAIMS, roles: ['INTEGRATION_SERVICE'] });
  const wrongRoleResponse = await wrongRole.handle(request({
    authorization: 'Bearer signed-token',
    'idempotency-key': 'oidc-create-0004'
  }));
  assert.equal(wrongRoleResponse.status, 403);
});
