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
const SECOND_EVENT_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = 'riyadh-ops';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';

function fixture() {
  const repository = new MemoryRoadEventRepository();
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(),
    repository
  );
  return createRoadEventHttpHandler(application);
}

function headers(overrides: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return {
    'x-actor-id': ACTOR_ID,
    'x-ros-roles': 'OPERATOR',
    'x-tenant-id': TENANT_ID,
    'x-purpose': PURPOSE,
    'idempotency-key': 'request-key-0001',
    ...overrides
  };
}

function request(overrides: Partial<HttpRequest>): HttpRequest {
  return {
    method: 'GET',
    path: '/api/v1/road-events',
    query: {},
    headers: headers(),
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
    headers: headers({ 'x-ros-roles': 'AUDITOR', 'idempotency-key': 'forbidden-key-0001' }),
    method: 'POST',
    body: validCreateBody
  }));
  assert.equal(forbidden.status, 403);

  const missingScope = await handle(request({
    headers: { 'x-actor-id': ACTOR_ID, 'x-ros-roles': 'OPERATOR', 'idempotency-key': 'missing-scope-key-0001' },
    method: 'POST',
    body: validCreateBody
  }));
  assert.equal(missingScope.status, 403);

  const invalid = await handle(request({ method: 'POST', body: { id: 'bad' } }));
  assert.equal(invalid.status, 400);

  const missing = await handle(request({ method: 'GET', path: '/api/v1/road-events/99999999-9999-4999-8999-999999999999' }));
  assert.equal(missing.status, 404);

  await handle(request({ method: 'POST', body: validCreateBody }));
  const conflict = await handle(request({ method: 'POST', body: { ...validCreateBody, latitude: 25 } }));
  assert.equal(conflict.status, 409);
});

test('timeline requires auditor or supervisor permission within the same access scope', async () => {
  const handle = fixture();
  await handle(request({ method: 'POST', body: validCreateBody }));

  const denied = await handle(request({ method: 'GET', path: `/api/v1/road-events/${EVENT_ID}/timeline` }));
  assert.equal(denied.status, 403);

  const allowed = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}/timeline`,
    headers: headers({ 'x-ros-roles': 'AUDITOR' })
  }));
  assert.equal(allowed.status, 200);
});

test('RoadEvent access fails closed across tenant and purpose boundaries', async () => {
  const handle = fixture();
  const created = await handle(request({ method: 'POST', body: validCreateBody }));
  assert.equal(created.status, 201);

  const otherTenant = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}`,
    headers: headers({ 'x-tenant-id': 'other-tenant' })
  }));
  assert.equal(otherTenant.status, 404);

  const otherPurpose = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}`,
    headers: headers({ 'x-purpose': 'AUDIT_REVIEW' })
  }));
  assert.equal(otherPurpose.status, 404);

  const crossTenantList = await handle(request({
    method: 'GET',
    headers: headers({ 'x-tenant-id': 'other-tenant' })
  }));
  assert.equal(crossTenantList.status, 200);
  assert.equal((crossTenantList.body as { data: { total: number } }).data.total, 0);
});

test('idempotency keys are isolated by tenant and purpose', async () => {
  const handle = fixture();
  const sharedKey = 'shared-idempotency-key-0001';

  const first = await handle(request({
    method: 'POST',
    body: validCreateBody,
    headers: headers({ 'idempotency-key': sharedKey })
  }));
  assert.equal(first.status, 201);

  const second = await handle(request({
    method: 'POST',
    body: { ...validCreateBody, id: SECOND_EVENT_ID },
    headers: headers({ 'idempotency-key': sharedKey, 'x-tenant-id': 'other-tenant' })
  }));
  assert.equal(second.status, 201);
  assert.equal(((second.body as { data: { id: string } }).data).id, SECOND_EVENT_ID);
});
