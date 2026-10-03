import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../apps/api/dist/application/local-adapters.js';
import { RoadEventApplicationService } from '../apps/api/dist/application/road-event-application.js';
import { createRoadEventHttpHandler } from '../apps/api/dist/http/road-event-http.js';
import { HttpRoadEventGateway } from '../apps/operations-dashboard/dist/api-client.js';
import { OperationsDashboardController } from '../apps/operations-dashboard/dist/dashboard.js';
import { RoadEvent, RoadEventStatus, SeverityLevel } from '../packages/domain/dist/index.js';

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
const TENANT = 'riyadh-pilot';
const PURPOSE = 'HUMAN_SAFETY_RESPONSE';
const TOKEN = 'trusted-api-dashboard-token';
const NOW = new Date('2026-09-30T09:15:00.000Z');

test('authenticated API recovery detail stays bound to its append-only Timeline in the dashboard', async (t) => {
  const repository = new MemoryRoadEventRepository();
  await repository.create(new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-09-30T09:00:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery,
    version: 4,
    severity: {
      level: SeverityLevel.Moderate,
      score: 48,
      confidence: 0.93,
      reasonCodes: ['recovery_verified'],
      requiresHumanReview: true
    }
  }), {
    tenantId: TENANT,
    purpose: PURPOSE,
    actorType: 'SYSTEM',
    action: 'fixture.recovered',
    traceId: 'fixture-recovery-v4',
    eventType: 'FixtureRecovered',
    correlationId: EVENT_ID,
    occurredAt: new Date('2026-09-30T09:10:00.000Z')
  });

  const timeline = Object.freeze([
    Object.freeze({
      action: 'road_event.road_clearance_confirmed',
      actorType: 'OPERATOR',
      actorId: ACTOR_ID,
      beforeState: Object.freeze({ status: 'RESPONSE_COORDINATION', version: 2 }),
      afterState: Object.freeze({ status: 'ROAD_CLEARANCE', version: 3 }),
      reason: 'Road clearance confirmed by a human operator',
      traceId: 'trace-clearance-v3',
      correlationId: EVENT_ID,
      causationId: null,
      occurredAt: '2026-09-30T09:05:00.000Z'
    }),
    Object.freeze({
      action: 'road_event.recovery_confirmed',
      actorType: 'SUPERVISOR',
      actorId: ACTOR_ID,
      beforeState: Object.freeze({ status: 'ROAD_CLEARANCE', version: 3 }),
      afterState: Object.freeze({ status: 'RECOVERY', version: 4 }),
      reason: 'Recovery confirmed after human review',
      traceId: 'trace-recovery-v4',
      correlationId: EVENT_ID,
      causationId: 'trace-clearance-v3',
      occurredAt: '2026-09-30T09:10:00.000Z'
    })
  ]);
  let servedTimeline = timeline;
  let timelineReads = 0;
  const auditTimeline = {
    async listForRoadEvent(roadEventId, scope) {
      timelineReads += 1;
      assert.equal(roadEventId, EVENT_ID);
      assert.deepEqual(scope, { tenantId: TENANT, purpose: PURPOSE });
      return servedTimeline;
    }
  };
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(repository),
    auditTimeline
  );

  let identityResolutions = 0;
  const actorResolver = {
    async resolve(headers) {
      identityResolutions += 1;
      assert.equal(headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(headers['x-tenant-id'], TENANT);
      assert.equal(headers['x-purpose'], PURPOSE);
      return { actorId: ACTOR_ID, roles: ['SUPERVISOR'], tenantId: TENANT, purpose: PURPOSE };
    }
  };
  const handler = createRoadEventHttpHandler(application, actorResolver);
  const routes = [];
  let mutationRequests = 0;
  const fetcher = async (input, init = {}) => {
    const target = new URL(String(input), 'http://localhost');
    const method = init.method ?? 'GET';
    if (method !== 'GET') mutationRequests += 1;
    routes.push(`${method} ${target.pathname}${target.search}`);
    const response = await handler({
      method,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams.entries()),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
      traceId: `trace-http-${routes.length}`
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    });
  };

  let tokenReads = 0;
  const session = {
    tenantId: TENANT,
    purpose: PURPOSE,
    async getAccessToken() {
      tokenReads += 1;
      return TOKEN;
    }
  };
  const gateway = new HttpRoadEventGateway('http://localhost', session, fetcher);
  const controller = new OperationsDashboardController(gateway, { roles: ['SUPERVISOR'] }, () => NOW);

  const queue = await controller.load();
  assert.equal(queue.phase, 'ready');
  assert.deepEqual(queue.events.map(({ id, version, status }) => ({ id, version, status })), [
    { id: EVENT_ID, version: 4, status: 'RECOVERY' }
  ]);

  const selected = await controller.select(EVENT_ID);
  assert.equal(selected.phase, 'ready');
  assert.equal(selected.selected?.id, EVENT_ID);
  assert.equal(selected.selected?.version, 4);
  assert.equal(selected.selected?.status, 'RECOVERY');
  assert.equal(selected.selected?.reconciliation, null);
  assert.equal(selected.stale, false);
  assert.equal(selected.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.deepEqual(selected.timeline, timeline);
  assert.deepEqual(selected.timeline.at(-1)?.afterState, { status: 'RECOVERY', version: 4 });
  assert.equal(selected.timeline.at(-1)?.correlationId, EVENT_ID);

  assert.deepEqual(routes, [
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${EVENT_ID}`,
    `GET /api/v1/road-events/${EVENT_ID}/timeline`
  ]);
  assert.equal(tokenReads, 3);
  assert.equal(identityResolutions, 3);
  assert.equal(timelineReads, 2);
  assert.equal(mutationRequests, 0);

  await t.test('mismatched recovery Timeline correlation fails closed', async () => {
    servedTimeline = Object.freeze([
      timeline[0],
      Object.freeze({ ...timeline[1], correlationId: '66666666-6666-4666-8666-666666666666' })
    ]);

    const blocked = await controller.select(EVENT_ID);
    assert.equal(blocked.phase, 'failure');
    assert.equal(blocked.selected, null);
    assert.deepEqual(blocked.timeline, []);
    assert.equal(blocked.stale, true);
    assert.match(blocked.error ?? '', /سجل الاستعادة.*للحادث/);
    assert.equal(controller.canRetrySelection(), true);
    assert.equal(controller.canTransition(), false);
    assert.equal(controller.canAuthorizeClosure(), false);
    assert.equal(mutationRequests, 0);
  });

  await t.test('corrected recovery Timeline succeeds on explicit retry without replay or mutation', async () => {
    servedTimeline = timeline;
    const readsBeforeRetry = {
      routes: routes.length,
      tokens: tokenReads,
      identities: identityResolutions,
      timeline: timelineReads,
      mutations: mutationRequests
    };

    const recovered = await controller.retrySelection();
    assert.equal(recovered.phase, 'ready');
    assert.equal(recovered.selected?.id, EVENT_ID);
    assert.equal(recovered.selected?.version, 4);
    assert.equal(recovered.selected?.status, 'RECOVERY');
    assert.equal(recovered.selected?.reconciliation, null);
    assert.deepEqual(recovered.timeline, timeline);
    assert.equal(recovered.stale, false);
    assert.equal(recovered.error, null);
    assert.equal(controller.canRetrySelection(), false);
    assert.deepEqual(routes.slice(readsBeforeRetry.routes), [
      `GET /api/v1/road-events/${EVENT_ID}`,
      `GET /api/v1/road-events/${EVENT_ID}/timeline`
    ]);
    assert.equal(tokenReads - readsBeforeRetry.tokens, 2);
    assert.equal(identityResolutions - readsBeforeRetry.identities, 2);
    assert.equal(timelineReads - readsBeforeRetry.timeline, 2);
    assert.equal(mutationRequests, readsBeforeRetry.mutations);
    assert.equal(mutationRequests, 0);
  });

  await t.test('mismatched recovery Timeline revision fails closed until an exact-version retry', async () => {
    servedTimeline = Object.freeze([
      timeline[0],
      Object.freeze({
        ...timeline[1],
        afterState: Object.freeze({ status: 'RECOVERY', version: 5 })
      })
    ]);

    const blocked = await controller.select(EVENT_ID);
    assert.equal(blocked.phase, 'failure');
    assert.equal(blocked.selected, null);
    assert.deepEqual(blocked.timeline, []);
    assert.equal(blocked.stale, true);
    assert.match(blocked.error ?? '', /سجل الاستعادة.*للحادث/);
    assert.equal(controller.canRetrySelection(), true);
    assert.equal(controller.canTransition(), false);
    assert.equal(controller.canAuthorizeClosure(), false);
    assert.equal(mutationRequests, 0);

    servedTimeline = timeline;
    const readsBeforeRetry = {
      routes: routes.length,
      tokens: tokenReads,
      identities: identityResolutions,
      timeline: timelineReads,
      mutations: mutationRequests
    };

    const recovered = await controller.retrySelection();
    assert.equal(recovered.phase, 'ready');
    assert.equal(recovered.selected?.id, EVENT_ID);
    assert.equal(recovered.selected?.version, 4);
    assert.equal(recovered.selected?.status, 'RECOVERY');
    assert.deepEqual(recovered.timeline, timeline);
    assert.equal(recovered.stale, false);
    assert.equal(recovered.error, null);
    assert.equal(controller.canRetrySelection(), false);
    assert.deepEqual(routes.slice(readsBeforeRetry.routes), [
      `GET /api/v1/road-events/${EVENT_ID}`,
      `GET /api/v1/road-events/${EVENT_ID}/timeline`
    ]);
    assert.equal(tokenReads - readsBeforeRetry.tokens, 2);
    assert.equal(identityResolutions - readsBeforeRetry.identities, 2);
    assert.equal(timelineReads - readsBeforeRetry.timeline, 2);
    assert.equal(mutationRequests, readsBeforeRetry.mutations);
    assert.equal(mutationRequests, 0);
  });
});
