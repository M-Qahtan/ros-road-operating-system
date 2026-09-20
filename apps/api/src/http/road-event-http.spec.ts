import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEvent, RoadEventStatus, SeverityLevel } from '@ros/domain';
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

class JournalWithholdingRoadEventRepository extends MemoryRoadEventRepository {
  override async list(
    query: Parameters<MemoryRoadEventRepository['list']>[0],
    scope: Parameters<MemoryRoadEventRepository['list']>[1]
  ) {
    const page = await super.list(query, scope);
    return {
      ...page,
      items: page.items.map((event) => new RoadEvent({
        id: event.id,
        occurredAt: event.occurredAt,
        latitude: event.latitude,
        longitude: event.longitude,
        status: event.status,
        reporterActorId: event.reporterActorId,
        severity: event.severity,
        version: event.version
      }))
    };
  }
}

function fixture(repository = new MemoryRoadEventRepository()) {
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

test('authenticated list keeps a journal-withheld incident visible without executable closure authorization', async () => {
  const repository = new JournalWithholdingRoadEventRepository();
  const event = new RoadEvent({
    ...validCreateBody,
    occurredAt: new Date(validCreateBody.occurredAt),
    status: RoadEventStatus.Recovery,
    version: 7,
    severity: {
      level: SeverityLevel.Critical, score: 95, confidence: 0.9,
      reasonCodes: ['high_impact'], requiresHumanReview: true
    }
  });
  event.authorizeClosure({
    actorId: ACTOR_ID,
    reason: 'scene verified safe',
    authorizedAt: new Date('2026-07-25T03:10:00.000Z')
  });
  await repository.create(event, {
    tenantId: TENANT,
    purpose: PURPOSE,
    actorType: 'SUPERVISOR',
    actorId: ACTOR_ID,
    action: 'fixture.authorization_persisted',
    traceId: 'trace-http-fixture-001',
    eventType: 'FixtureAuthorizationPersisted',
    correlationId: EVENT_ID
  });
  assert.notEqual((await repository.findById(EVENT_ID, {
    tenantId: TENANT,
    purpose: PURPOSE
  }))?.closureAuthorization, undefined);
  const handle = fixture(repository);

  const response = await handle(request({
    method: 'GET',
    path: '/api/v1/road-events',
    headers: actorHeaders('OPERATOR')
  }));

  assert.equal(response.status, 200);
  const page = (response.body as {
    data: { items: Array<{ id: string; closureAuthorization: unknown }> };
  }).data;
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, EVENT_ID);
  assert.equal(page.items[0]?.closureAuthorization, null);
});

test('HTTP conflict recovery requires a new exact-revision closure authorization', async () => {
  const repository = new MemoryRoadEventRepository();
  const event = new RoadEvent({
    ...validCreateBody,
    occurredAt: new Date(validCreateBody.occurredAt),
    status: RoadEventStatus.Recovery,
    version: 7,
    severity: {
      level: SeverityLevel.Critical, score: 95, confidence: 0.9,
      reasonCodes: ['high_impact'], requiresHumanReview: true
    }
  });
  await repository.create(event, {
    tenantId: TENANT,
    purpose: PURPOSE,
    actorType: 'SYSTEM',
    action: 'fixture.recovery_created',
    traceId: 'trace-http-recovery-fixture',
    eventType: 'FixtureRecoveryCreated',
    correlationId: EVENT_ID
  });
  const handle = fixture(repository);
  const supervisorHeaders = (idempotencyKey: string) => ({
    ...actorHeaders('SUPERVISOR'),
    'idempotency-key': idempotencyKey
  });

  const initialAuthorization = await handle(request({
    method: 'POST',
    path: `/api/v1/road-events/${EVENT_ID}/closure-authorization`,
    headers: supervisorHeaders('authorize-version-7'),
    body: {
      expectedVersion: 7,
      reason: 'initial scene review',
      authorizedAt: '2026-07-25T03:10:00.000Z'
    }
  }));
  assert.equal(initialAuthorization.status, 200);
  const initialData = (initialAuthorization.body as {
    data: { version: number; closureAuthorization: { reason: string } | null };
  }).data;
  assert.equal(initialData.version, 8);
  assert.equal(initialData.closureAuthorization?.reason, 'initial scene review');

  const drift = await handle(request({
    method: 'POST',
    path: `/api/v1/road-events/${EVENT_ID}/severity`,
    headers: supervisorHeaders('severity-version-8'),
    body: {
      expectedVersion: 8,
      assessment: {
        level: SeverityLevel.Critical, score: 97, confidence: 0.92,
        reasonCodes: ['new_verified_evidence'], requiresHumanReview: true
      },
      reason: 'new evidence invalidates prior authorization'
    }
  }));
  assert.equal(drift.status, 200);
  const driftData = (drift.body as {
    data: { version: number; closureAuthorization: unknown };
  }).data;
  assert.equal(driftData.version, 9);
  assert.equal(driftData.closureAuthorization, null);

  const staleClosure = await handle(request({
    method: 'POST',
    path: `/api/v1/road-events/${EVENT_ID}/transition`,
    headers: supervisorHeaders('close-stale-version-8'),
    body: { expectedVersion: 8, nextStatus: RoadEventStatus.Closed, reason: 'stale close must fail' }
  }));
  assert.equal(staleClosure.status, 409);
  const staleBody = staleClosure.body as {
    success: boolean; data: unknown; error: { code: string } | null;
  };
  assert.equal(staleBody.success, false);
  assert.equal(staleBody.data, null);
  assert.equal(staleBody.error?.code, 'CONFLICT');

  const refreshed = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}`,
    headers: actorHeaders('SUPERVISOR')
  }));
  assert.equal(refreshed.status, 200);
  const refreshedData = (refreshed.body as {
    data: { version: number; status: RoadEventStatus; closureAuthorization: unknown };
  }).data;
  assert.equal(refreshedData.version, 9);
  assert.equal(refreshedData.status, RoadEventStatus.Recovery);
  assert.equal(refreshedData.closureAuthorization, null);

  const replacement = await handle(request({
    method: 'POST',
    path: `/api/v1/road-events/${EVENT_ID}/closure-authorization`,
    headers: supervisorHeaders('authorize-version-9'),
    body: {
      expectedVersion: 9,
      reason: 'replacement review for current revision',
      authorizedAt: '2026-07-25T03:12:00.000Z'
    }
  }));
  assert.equal(replacement.status, 200);
  const replacementData = (replacement.body as {
    data: { version: number; closureAuthorization: { reason: string } | null };
  }).data;
  assert.equal(replacementData.version, 10);
  assert.equal(replacementData.closureAuthorization?.reason, 'replacement review for current revision');

  const timelineResponse = await handle(request({
    method: 'GET',
    path: `/api/v1/road-events/${EVENT_ID}/timeline`,
    headers: actorHeaders('SUPERVISOR')
  }));
  assert.equal(timelineResponse.status, 200);
  const authorizationHistory = (timelineResponse.body as {
    data: Array<{ action: string; afterState: { version?: number } | null }>;
  }).data.filter((entry) => entry.action === 'road_event.closure_authorized');
  assert.deepEqual(authorizationHistory.map((entry) => entry.afterState?.version), [8, 10]);
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
