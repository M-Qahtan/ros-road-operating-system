import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { createRoadEventHttpHandler, HttpRequest } from './road-event-http.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT = 'riyadh-pilot';
const PURPOSE = 'road-safety-response';

function fixture() {
  const repository = new MemoryRoadEventRepository();
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(repository),
    repository
  );
  return createRoadEventHttpHandler(application);
}

function actorHeaders(role = 'OPERATOR', tenantId = TENANT, purpose = PURPOSE) {
  return {
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': role,
    'x-tenant-id': tenantId,
    'x-purpose': purpose
  };
}

function request(overrides: Partial<HttpRequest>): HttpRequest {
  return {
    method: 'GET',
    path: '/api/v1/road-events',
    query: {},
    headers: { ...actorHeaders(), 'idempotency-key': 'request-key-0001' },
    body: null,
    traceId: 'trace-http-001',
    ...overrides
  };
}

const validCreateBody = {
  id: EVENT_ID,
  occurredAt: '2026-07-25T03:00:00.000Z',
  latitude: 24.7136,
  longitude: 46.6753
};

test('HTTP create and detail endpoints return stable envelopes', async () => {
  const handle = fixture();
  const created = await handle(request({ method: 'POST', body: validCreateBody }));
  assert.equal(created.status, 201);
  assert.equal((created.body as { success: boolean }).success, true);

  const detail = await handle(request({ method: 'GET', path: `/api/v1/road-events/${EVENT_ID}` }));
  assert.equal(detail.status, 200);
  assert.equal(((detail.body as { data: { id: string } }).data).id, EVENT_ID);
});

test('HTTP authorization, validation, conflict and not-found errors are explicit', async () => {
  const handle = fixture();
  const forbidden = await handle(request({
    headers: { ...actorHeaders('AUDITOR'), 'idempotency-key': 'forbidden-key-0001' },
    method: 'POST',
    body: validCreateBody
  }));
  assert.equal(forbidden.status, 403);

  const invalid = await handle(request({ method: 'POST', body: { id: 'bad' } }));
  assert.equal(invalid.status, 400);

  const missing = await handle(request({ method: 'GET', path: '/api/v1/road-events/99999999-9999-4999-8999-999999999999' }));
  assert.equal(missing.status, 404);

  await handle(request({ method: 'POST', body: validCreateBody }));
  const conflict = await handle(request({ method: 'POST', body: { ...validCreateBody, latitude: 25 } }));
  assert.equal(conflict.status, 409);
});

test('cross-tenant and cross-purpose reads fail closed as not-found', async () => {
  const handle = fixture();
  await handle(request({ method: 'POST', body: validCreateBody }));

  const wrongTenant = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}`,
    headers: actorHeaders('OPERATOR', 'another-tenant', PURPOSE)
  }));
  assert.equal(wrongTenant.status, 404);

  const wrongPurpose = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}`,
    headers: actorHeaders('OPERATOR', TENANT, 'analytics-only')
  }));
  assert.equal(wrongPurpose.status, 404);
});

test('timeline requires auditor or supervisor permission and matching scope', async () => {
  const handle = fixture();
  await handle(request({ method: 'POST', body: validCreateBody }));

  const denied = await handle(request({ method: 'GET', path: `/api/v1/road-events/${EVENT_ID}/timeline` }));
  assert.equal(denied.status, 403);

  const allowed = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}/timeline`,
    headers: actorHeaders('AUDITOR')
  }));
  assert.equal(allowed.status, 200);

  const wrongPurpose = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}/timeline`,
    headers: actorHeaders('AUDITOR', TENANT, 'analytics-only')
  }));
  assert.equal(wrongPurpose.status, 404);
});
