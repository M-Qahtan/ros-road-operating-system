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
const PRIOR_SESSION_ACTOR_ID = '77777777-7777-4777-8777-777777777777';
const REPLACEMENT_SESSION_ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const ROTATED_SESSION_ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TENANT = 'riyadh-pilot';
const PURPOSE = 'HUMAN_SAFETY_RESPONSE';
const TOKEN = 'trusted-api-dashboard-token';
const PRIOR_SESSION_TOKEN = 'prior-api-dashboard-token';
const REPLACEMENT_SESSION_TOKEN = 'replacement-api-dashboard-token';
const NOW = new Date('2026-09-30T09:15:00.000Z');

const PRIOR_SCOPE_EVENT_ID = '99999999-9999-4999-8999-999999999999';
const REPLACEMENT_SCOPE_EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROTATED_SCOPE_EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRIOR_SCOPE_TENANT = 'riyadh-prior-scope';
const PRIOR_SCOPE_PURPOSE = 'PRIOR_SAFETY_RESPONSE';
const REPLACEMENT_SCOPE_TENANT = 'riyadh-replacement-scope';
const REPLACEMENT_SCOPE_PURPOSE = 'REPLACEMENT_SAFETY_RESPONSE';
const ROTATED_SCOPE_TENANT = 'riyadh-rotated-scope';
const ROTATED_SCOPE_PURPOSE = 'ROTATED_SAFETY_RESPONSE';
const PRIOR_SCOPE_TOKEN = 'prior-scope-api-dashboard-token';
const REPLACEMENT_SCOPE_TOKEN = 'replacement-scope-api-dashboard-token';
const ROTATED_SESSION_TOKEN = 'rotated-session-api-dashboard-token';
const ACTIVE_EVENT_HIDDEN_TOKEN = 'active-event-hidden-api-dashboard-token';
const HIDDEN_SCOPE_TENANT = 'riyadh-hidden-scope';
const HIDDEN_SCOPE_PURPOSE = 'HIDDEN_SAFETY_RESPONSE';

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
  const resolvedActors = [];
  const actorsByAuthorization = new Map([[`Bearer ${TOKEN}`, ACTOR_ID]]);
  const actorResolver = {
    async resolve(headers) {
      identityResolutions += 1;
      const actorId = actorsByAuthorization.get(headers.authorization);
      assert.notEqual(actorId, undefined);
      assert.equal(headers['x-tenant-id'], TENANT);
      assert.equal(headers['x-purpose'], PURPOSE);
      assert.equal(headers['x-actor-id'], undefined);
      resolvedActors.push(actorId);
      return { actorId, roles: ['SUPERVISOR'], tenantId: TENANT, purpose: PURPOSE };
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

  await t.test('replacement browser session with a new trusted actor ignores the prior actor response', async () => {
    actorsByAuthorization.set(`Bearer ${PRIOR_SESSION_TOKEN}`, PRIOR_SESSION_ACTOR_ID);
    actorsByAuthorization.set(`Bearer ${REPLACEMENT_SESSION_TOKEN}`, REPLACEMENT_SESSION_ACTOR_ID);
    const readsBeforeReplacement = {
      routes: routes.length,
      identities: identityResolutions,
      timeline: timelineReads,
      mutations: mutationRequests,
      actors: resolvedActors.length
    };
    let priorTokenReads = 0;
    let replacementTokenReads = 0;

    let releasePriorTimeline;
    let markPriorTimelineStarted;
    const priorTimelineRelease = new Promise((resolve) => { releasePriorTimeline = resolve; });
    const priorTimelineStarted = new Promise((resolve) => { markPriorTimelineStarted = resolve; });
    const priorFetcher = async (input, init = {}) => {
      const target = new URL(String(input), 'http://localhost');
      const response = await fetcher(input, init);
      if (target.pathname === `/api/v1/road-events/${EVENT_ID}/timeline`) {
        markPriorTimelineStarted();
        await priorTimelineRelease;
      }
      return response;
    };
    const priorSession = {
      tenantId: TENANT,
      purpose: PURPOSE,
      getAccessToken: async () => {
        priorTokenReads += 1;
        return PRIOR_SESSION_TOKEN;
      }
    };
    const priorController = new OperationsDashboardController(
      new HttpRoadEventGateway('http://localhost', priorSession, priorFetcher),
      { roles: ['SUPERVISOR'] },
      () => NOW
    );

    servedTimeline = timeline;
    await priorController.load();
    servedTimeline = Object.freeze([
      timeline[0],
      Object.freeze({
        ...timeline[1],
        afterState: Object.freeze({ status: 'RECOVERY', version: 5 })
      })
    ]);
    const delayedPriorSelection = priorController.select(EVENT_ID);
    await priorTimelineStarted;
    const discardedPriorState = priorController.discardBrowserSession();

    servedTimeline = timeline;
    const replacementSession = {
      tenantId: TENANT,
      purpose: PURPOSE,
      getAccessToken: async () => {
        replacementTokenReads += 1;
        return REPLACEMENT_SESSION_TOKEN;
      }
    };
    const replacementController = new OperationsDashboardController(
      new HttpRoadEventGateway('http://localhost', replacementSession, fetcher),
      { roles: ['SUPERVISOR'] },
      () => NOW
    );
    await replacementController.load();
    const replacementSelection = await replacementController.select(EVENT_ID);
    assert.equal(replacementSelection.phase, 'ready');
    assert.equal(replacementSelection.selected?.version, 4);
    assert.deepEqual(replacementSelection.timeline, timeline);
    assert.equal(replacementSelection.stale, false);
    assert.equal(replacementSelection.error, null);
    const replacementCapabilities = Object.freeze({
      transition: replacementController.canTransition(),
      closure: replacementController.canAuthorizeClosure(),
      retry: replacementController.canRetrySelection()
    });

    releasePriorTimeline();
    const priorCompletion = await delayedPriorSelection;
    assert.equal(priorCompletion, discardedPriorState);
    assert.equal(priorController.state, discardedPriorState);
    assert.equal(priorController.state.phase, 'loading');
    assert.equal(priorController.state.selected, null);
    assert.deepEqual(priorController.state.timeline, []);
    assert.equal(priorController.state.stale, false);
    assert.equal(priorController.state.error, null);
    assert.equal(priorController.canRetrySelection(), false);
    assert.equal(priorController.canTransition(), false);
    assert.equal(priorController.canAuthorizeClosure(), false);

    assert.equal(replacementController.state, replacementSelection);
    assert.equal(replacementController.state.selected?.version, 4);
    assert.deepEqual(replacementController.state.timeline, timeline);
    assert.equal(replacementController.state.stale, false);
    assert.equal(replacementController.state.error, null);
    assert.deepEqual({
      transition: replacementController.canTransition(),
      closure: replacementController.canAuthorizeClosure(),
      retry: replacementController.canRetrySelection()
    }, replacementCapabilities);
    const replacementRoutes = routes.slice(readsBeforeReplacement.routes);
    assert.equal(replacementRoutes.filter((route) => route.includes('?limit=100&offset=0')).length, 2);
    assert.equal(replacementRoutes.filter((route) => route === `GET /api/v1/road-events/${EVENT_ID}`).length, 2);
    assert.equal(replacementRoutes.filter((route) => route === `GET /api/v1/road-events/${EVENT_ID}/timeline`).length, 2);
    assert.equal(priorTokenReads, 3);
    assert.equal(replacementTokenReads, 3);
    assert.equal(identityResolutions - readsBeforeReplacement.identities, 6);
    assert.equal(timelineReads - readsBeforeReplacement.timeline, 4);
    assert.deepEqual(
      resolvedActors.slice(readsBeforeReplacement.actors),
      [
        PRIOR_SESSION_ACTOR_ID,
        PRIOR_SESSION_ACTOR_ID,
        PRIOR_SESSION_ACTOR_ID,
        REPLACEMENT_SESSION_ACTOR_ID,
        REPLACEMENT_SESSION_ACTOR_ID,
        REPLACEMENT_SESSION_ACTOR_ID
      ]
    );
    assert.equal(mutationRequests, readsBeforeReplacement.mutations);
    assert.equal(mutationRequests, 0);
  });
});

test('replacement Tenant and Purpose stay isolated from a delayed response owned by the prior scope', async () => {
  const repository = new MemoryRoadEventRepository();
  const createRecoveryEvent = async (id, tenantId, purpose, latitude) => {
    await repository.create(new RoadEvent({
      id,
      occurredAt: new Date('2026-09-30T09:00:00.000Z'),
      latitude,
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
      tenantId,
      purpose,
      actorType: 'SYSTEM',
      action: 'fixture.recovered',
      traceId: `fixture-recovery-v4-${id}`,
      eventType: 'FixtureRecovered',
      correlationId: id,
      occurredAt: new Date('2026-09-30T09:10:00.000Z')
    });
  };
  await createRecoveryEvent(PRIOR_SCOPE_EVENT_ID, PRIOR_SCOPE_TENANT, PRIOR_SCOPE_PURPOSE, 24.7136);
  await createRecoveryEvent(REPLACEMENT_SCOPE_EVENT_ID, REPLACEMENT_SCOPE_TENANT, REPLACEMENT_SCOPE_PURPOSE, 24.7137);
  await createRecoveryEvent(ROTATED_SCOPE_EVENT_ID, ROTATED_SCOPE_TENANT, ROTATED_SCOPE_PURPOSE, 24.7138);

  const recoveryTimeline = (eventId, actorId, version = 4) => Object.freeze([
    Object.freeze({
      action: 'road_event.road_clearance_confirmed',
      actorType: 'OPERATOR',
      actorId,
      beforeState: Object.freeze({ status: 'RESPONSE_COORDINATION', version: 2 }),
      afterState: Object.freeze({ status: 'ROAD_CLEARANCE', version: 3 }),
      reason: 'Road clearance confirmed by a human operator',
      traceId: `trace-clearance-v3-${eventId}`,
      correlationId: eventId,
      causationId: null,
      occurredAt: '2026-09-30T09:05:00.000Z'
    }),
    Object.freeze({
      action: 'road_event.recovery_confirmed',
      actorType: 'SUPERVISOR',
      actorId,
      beforeState: Object.freeze({ status: 'ROAD_CLEARANCE', version: 3 }),
      afterState: Object.freeze({ status: 'RECOVERY', version }),
      reason: 'Recovery confirmed after human review',
      traceId: `trace-recovery-v${version}-${eventId}`,
      correlationId: eventId,
      causationId: `trace-clearance-v3-${eventId}`,
      occurredAt: '2026-09-30T09:10:00.000Z'
    })
  ]);
  const priorTimeline = recoveryTimeline(PRIOR_SCOPE_EVENT_ID, PRIOR_SESSION_ACTOR_ID, 5);
  const replacementTimeline = recoveryTimeline(REPLACEMENT_SCOPE_EVENT_ID, REPLACEMENT_SESSION_ACTOR_ID);
  const rotatedTimeline = recoveryTimeline(ROTATED_SCOPE_EVENT_ID, ROTATED_SESSION_ACTOR_ID);
  let timelineReads = 0;
  const auditTimeline = {
    async listForRoadEvent(roadEventId, scope) {
      timelineReads += 1;
      if (roadEventId === PRIOR_SCOPE_EVENT_ID) {
        assert.deepEqual(scope, { tenantId: PRIOR_SCOPE_TENANT, purpose: PRIOR_SCOPE_PURPOSE });
        return priorTimeline;
      }
      if (roadEventId === REPLACEMENT_SCOPE_EVENT_ID) {
        assert.deepEqual(scope, { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE });
        return replacementTimeline;
      }
      assert.equal(roadEventId, ROTATED_SCOPE_EVENT_ID);
      assert.deepEqual(scope, { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE });
      return rotatedTimeline;
    }
  };
  const application = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(repository),
    auditTimeline
  );

  const principals = new Map([
    [`Bearer ${PRIOR_SCOPE_TOKEN}`, {
      actorId: PRIOR_SESSION_ACTOR_ID,
      tenantId: PRIOR_SCOPE_TENANT,
      purpose: PRIOR_SCOPE_PURPOSE
    }],
    [`Bearer ${REPLACEMENT_SCOPE_TOKEN}`, {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    }],
    [`Bearer ${ROTATED_SESSION_TOKEN}`, {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }],
    [`Bearer ${ACTIVE_EVENT_HIDDEN_TOKEN}`, {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: HIDDEN_SCOPE_TENANT,
      purpose: HIDDEN_SCOPE_PURPOSE,
      requestTenantId: REPLACEMENT_SCOPE_TENANT,
      requestPurpose: REPLACEMENT_SCOPE_PURPOSE
    }]
  ]);
  const resolvedPrincipals = [];
  const actorResolver = {
    async resolve(headers) {
      const principal = principals.get(headers.authorization);
      assert.notEqual(principal, undefined);
      assert.equal(headers['x-tenant-id'], principal.requestTenantId ?? principal.tenantId);
      assert.equal(headers['x-purpose'], principal.requestPurpose ?? principal.purpose);
      assert.equal(headers['x-actor-id'], undefined);
      const resolved = {
        actorId: principal.actorId,
        tenantId: principal.tenantId,
        purpose: principal.purpose
      };
      resolvedPrincipals.push(resolved);
      return { ...resolved, roles: ['SUPERVISOR'] };
    }
  };
  const handler = createRoadEventHttpHandler(application, actorResolver);
  const routes = [];
  let mutationRequests = 0;
  let holdTrustedRetryTimeline = false;
  let releaseTrustedRetryTimeline;
  let markTrustedRetryTimelineStarted;
  const trustedRetryTimelineRelease = new Promise((resolve) => { releaseTrustedRetryTimeline = resolve; });
  const trustedRetryTimelineStarted = new Promise((resolve) => { markTrustedRetryTimelineStarted = resolve; });
  let holdDiscardedRetryTimeline = false;
  let releaseDiscardedRetryTimeline;
  let markDiscardedRetryTimelineStarted;
  const discardedRetryTimelineRelease = new Promise((resolve) => { releaseDiscardedRetryTimeline = resolve; });
  const discardedRetryTimelineStarted = new Promise((resolve) => { markDiscardedRetryTimelineStarted = resolve; });
  let holdDiscardedQueue = false;
  let releaseDiscardedQueue;
  let markDiscardedQueueStarted;
  const discardedQueueRelease = new Promise((resolve) => { releaseDiscardedQueue = resolve; });
  const discardedQueueStarted = new Promise((resolve) => { markDiscardedQueueStarted = resolve; });
  let holdDeniedDiscardedQueue = false;
  let releaseDeniedDiscardedQueue;
  let markDeniedDiscardedQueueStarted;
  const deniedDiscardedQueueRelease = new Promise((resolve) => { releaseDeniedDiscardedQueue = resolve; });
  const deniedDiscardedQueueStarted = new Promise((resolve) => { markDeniedDiscardedQueueStarted = resolve; });
  let holdRotatedReloadQueue = false;
  let releaseRotatedReloadQueue;
  let markRotatedReloadQueueStarted;
  const rotatedReloadQueueRelease = new Promise((resolve) => { releaseRotatedReloadQueue = resolve; });
  const rotatedReloadQueueStarted = new Promise((resolve) => { markRotatedReloadQueueStarted = resolve; });
  let holdFailedRotatedReloadQueue = false;
  let releaseFailedRotatedReloadQueue;
  let markFailedRotatedReloadQueueStarted;
  const failedRotatedReloadQueueRelease = new Promise((resolve) => { releaseFailedRotatedReloadQueue = resolve; });
  const failedRotatedReloadQueueStarted = new Promise((resolve) => { markFailedRotatedReloadQueueStarted = resolve; });
  let failLatestRotatedReloadQueue = false;
  let failPostRecoveryRotatedTimeline = false;
  let holdPostRecoveryRotatedTimelineRetry = false;
  let releasePostRecoveryRotatedTimelineRetry;
  let markPostRecoveryRotatedTimelineRetryStarted;
  const postRecoveryRotatedTimelineRetryRelease = new Promise((resolve) => {
    releasePostRecoveryRotatedTimelineRetry = resolve;
  });
  const postRecoveryRotatedTimelineRetryStarted = new Promise((resolve) => {
    markPostRecoveryRotatedTimelineRetryStarted = resolve;
  });
  let holdDiscardedPostRecoveryRotatedTimelineRetry = false;
  let discardedPostRecoveryRotatedTimelineRetryClaimed = false;
  let releaseDiscardedPostRecoveryRotatedTimelineRetry;
  let markDiscardedPostRecoveryRotatedTimelineRetryStarted;
  const discardedPostRecoveryRotatedTimelineRetryRelease = new Promise((resolve) => {
    releaseDiscardedPostRecoveryRotatedTimelineRetry = resolve;
  });
  const discardedPostRecoveryRotatedTimelineRetryStarted = new Promise((resolve) => {
    markDiscardedPostRecoveryRotatedTimelineRetryStarted = resolve;
  });
  let holdDiscardedRestoredRotatedTimeline = false;
  let releaseDiscardedRestoredRotatedTimeline;
  let markDiscardedRestoredRotatedTimelineStarted;
  const discardedRestoredRotatedTimelineRelease = new Promise((resolve) => {
    releaseDiscardedRestoredRotatedTimeline = resolve;
  });
  const discardedRestoredRotatedTimelineStarted = new Promise((resolve) => {
    markDiscardedRestoredRotatedTimelineStarted = resolve;
  });
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
      traceId: `trace-cross-scope-http-${routes.length}`
    });
    if (holdTrustedRetryTimeline
      && target.pathname === `/api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`) {
      markTrustedRetryTimelineStarted();
      await trustedRetryTimelineRelease;
    }
    if (holdDiscardedRetryTimeline
      && target.pathname === `/api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`) {
      markDiscardedRetryTimelineStarted();
      await discardedRetryTimelineRelease;
    }
    if (holdDiscardedQueue
      && target.pathname === '/api/v1/road-events'
      && target.search === '?limit=100&offset=0') {
      markDiscardedQueueStarted();
      await discardedQueueRelease;
    }
    if (holdDeniedDiscardedQueue
      && target.pathname === '/api/v1/road-events'
      && target.search === '?limit=100&offset=0'
      && new Headers(init.headers).get('authorization') === `Bearer ${REPLACEMENT_SCOPE_TOKEN}`) {
      markDeniedDiscardedQueueStarted();
      await deniedDiscardedQueueRelease;
      return new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'Previous scope denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (holdRotatedReloadQueue
      && target.pathname === '/api/v1/road-events'
      && target.search === '?limit=100&offset=0'
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      markRotatedReloadQueueStarted();
      await rotatedReloadQueueRelease;
    }
    if (holdFailedRotatedReloadQueue
      && target.pathname === '/api/v1/road-events'
      && target.search === '?limit=100&offset=0'
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      markFailedRotatedReloadQueueStarted();
      await failedRotatedReloadQueueRelease;
      return new Response(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Superseded queue unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (failLatestRotatedReloadQueue
      && target.pathname === '/api/v1/road-events'
      && target.search === '?limit=100&offset=0'
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      return new Response(JSON.stringify({
        code: 'LATEST_QUEUE_SECRET',
        message: 'postgres://reader:secret@latest-rotated-queue'
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (failPostRecoveryRotatedTimeline
      && target.pathname === `/api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      return new Response(JSON.stringify({
        code: 'POST_RECOVERY_TIMELINE_SECRET',
        message: 'postgres://reader:secret@post-recovery-timeline'
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (holdPostRecoveryRotatedTimelineRetry
      && target.pathname === `/api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      markPostRecoveryRotatedTimelineRetryStarted();
      await postRecoveryRotatedTimelineRetryRelease;
    }
    if (holdDiscardedPostRecoveryRotatedTimelineRetry
      && !discardedPostRecoveryRotatedTimelineRetryClaimed
      && target.pathname === `/api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      discardedPostRecoveryRotatedTimelineRetryClaimed = true;
      markDiscardedPostRecoveryRotatedTimelineRetryStarted();
      await discardedPostRecoveryRotatedTimelineRetryRelease;
    }
    if (holdDiscardedRestoredRotatedTimeline
      && target.pathname === `/api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
      && new Headers(init.headers).get('authorization') === `Bearer ${ROTATED_SESSION_TOKEN}`) {
      markDiscardedRestoredRotatedTimelineStarted();
      await discardedRestoredRotatedTimelineRelease;
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    });
  };

  let releasePriorTimeline;
  let markPriorTimelineStarted;
  const priorTimelineRelease = new Promise((resolve) => { releasePriorTimeline = resolve; });
  const priorTimelineStarted = new Promise((resolve) => { markPriorTimelineStarted = resolve; });
  const priorFetcher = async (input, init = {}) => {
    const target = new URL(String(input), 'http://localhost');
    const response = await fetcher(input, init);
    if (target.pathname === `/api/v1/road-events/${PRIOR_SCOPE_EVENT_ID}/timeline`) {
      markPriorTimelineStarted();
      await priorTimelineRelease;
    }
    return response;
  };
  const priorSession = {
    tenantId: PRIOR_SCOPE_TENANT,
    purpose: PRIOR_SCOPE_PURPOSE,
    getAccessToken: async () => PRIOR_SCOPE_TOKEN
  };
  const priorController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', priorSession, priorFetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const priorQueue = await priorController.load();
  assert.deepEqual(priorQueue.events.map(({ id }) => id), [PRIOR_SCOPE_EVENT_ID]);
  const delayedPriorSelection = priorController.select(PRIOR_SCOPE_EVENT_ID);
  await priorTimelineStarted;
  const discardedPriorState = priorController.discardBrowserSession();

  let replacementAccessToken = REPLACEMENT_SCOPE_TOKEN;
  const replacementSession = {
    tenantId: REPLACEMENT_SCOPE_TENANT,
    purpose: REPLACEMENT_SCOPE_PURPOSE,
    getAccessToken: async () => replacementAccessToken
  };
  const replacementController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', replacementSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const replacementQueue = await replacementController.load();
  assert.equal(replacementQueue.phase, 'ready');
  assert.deepEqual(replacementQueue.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  const replacementSelection = await replacementController.select(REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(replacementSelection.phase, 'ready');
  assert.equal(replacementSelection.selected?.id, REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(replacementSelection.selected?.version, 4);
  assert.deepEqual(replacementSelection.timeline, replacementTimeline);
  assert.equal(replacementSelection.stale, false);
  assert.equal(replacementSelection.error, null);
  const replacementCapabilities = Object.freeze({
    retry: replacementController.canRetrySelection(),
    transition: replacementController.canTransition(),
    closure: replacementController.canAuthorizeClosure()
  });

  releasePriorTimeline();
  assert.equal(await delayedPriorSelection, discardedPriorState);
  assert.equal(priorController.state, discardedPriorState);
  assert.equal(priorController.state.selected, null);
  assert.deepEqual(priorController.state.timeline, []);
  assert.equal(priorController.state.stale, false);
  assert.equal(priorController.state.error, null);

  assert.equal(replacementController.state, replacementSelection);
  assert.deepEqual(replacementController.state.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(replacementController.state.selected?.id, REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(replacementController.state.selected?.version, 4);
  assert.deepEqual(replacementController.state.timeline, replacementTimeline);
  assert.equal(replacementController.state.stale, false);
  assert.equal(replacementController.state.error, null);
  assert.deepEqual({
    retry: replacementController.canRetrySelection(),
    transition: replacementController.canTransition(),
    closure: replacementController.canAuthorizeClosure()
  }, replacementCapabilities);

  const readsBeforeCrossScopeDenial = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const deniedCrossScopeSelection = await replacementController.select(PRIOR_SCOPE_EVENT_ID);
  assert.equal(deniedCrossScopeSelection, replacementSelection);
  assert.equal(replacementController.state, replacementSelection);
  assert.deepEqual(replacementController.state.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(replacementController.state.selected?.id, REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(replacementController.state.selected?.version, 4);
  assert.deepEqual(replacementController.state.timeline, replacementTimeline);
  assert.equal(replacementController.state.stale, false);
  assert.equal(replacementController.state.error, null);
  assert.deepEqual({
    retry: replacementController.canRetrySelection(),
    transition: replacementController.canTransition(),
    closure: replacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforeCrossScopeDenial.routes), [
    `GET /api/v1/road-events/${PRIOR_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${PRIOR_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.equal(resolvedPrincipals.length - readsBeforeCrossScopeDenial.identities, 2);
  assert.equal(timelineReads, readsBeforeCrossScopeDenial.timeline);
  assert.equal(mutationRequests, readsBeforeCrossScopeDenial.mutations);

  replacementAccessToken = ACTIVE_EVENT_HIDDEN_TOKEN;
  const readsBeforeActiveDenial = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const deniedActiveSelection = await replacementController.select(REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(deniedActiveSelection.phase, 'failure');
  assert.deepEqual(deniedActiveSelection.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(deniedActiveSelection.selected, null);
  assert.deepEqual(deniedActiveSelection.timeline, []);
  assert.equal(deniedActiveSelection.stale, true);
  assert.match(deniedActiveSelection.error ?? '', /لم يعد السجل المطلوب متاحًا/);
  assert.equal(replacementController.canRetrySelection(), true);
  assert.equal(replacementController.canTransition(), false);
  assert.equal(replacementController.canAuthorizeClosure(), false);
  assert.deepEqual(routes.slice(readsBeforeActiveDenial.routes), [
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.equal(resolvedPrincipals.length - readsBeforeActiveDenial.identities, 2);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeActiveDenial.identities), [
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: HIDDEN_SCOPE_TENANT,
      purpose: HIDDEN_SCOPE_PURPOSE
    },
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: HIDDEN_SCOPE_TENANT,
      purpose: HIDDEN_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads, readsBeforeActiveDenial.timeline);
  assert.equal(mutationRequests, readsBeforeActiveDenial.mutations);

  replacementAccessToken = REPLACEMENT_SCOPE_TOKEN;
  const readsBeforeTrustedRetry = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdTrustedRetryTimeline = true;
  const firstTrustedRetry = replacementController.retrySelection();
  const secondTrustedRetry = replacementController.retrySelection();
  assert.equal(secondTrustedRetry, firstTrustedRetry);
  await trustedRetryTimelineStarted;
  assert.deepEqual(routes.slice(readsBeforeTrustedRetry.routes), [
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.equal(resolvedPrincipals.length - readsBeforeTrustedRetry.identities, 2);
  assert.equal(timelineReads - readsBeforeTrustedRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforeTrustedRetry.mutations);
  releaseTrustedRetryTimeline();
  const [restoredActiveSelection, coalescedActiveSelection] = await Promise.all([
    firstTrustedRetry,
    secondTrustedRetry
  ]);
  assert.equal(coalescedActiveSelection, restoredActiveSelection);
  assert.equal(replacementController.state, restoredActiveSelection);
  assert.equal(restoredActiveSelection.phase, 'ready');
  assert.deepEqual(restoredActiveSelection.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(restoredActiveSelection.selected?.id, REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(restoredActiveSelection.selected?.version, 4);
  assert.deepEqual(restoredActiveSelection.timeline, replacementTimeline);
  assert.equal(restoredActiveSelection.stale, false);
  assert.equal(restoredActiveSelection.error, null);
  assert.equal(replacementController.canRetrySelection(), false);
  assert.deepEqual({
    transition: replacementController.canTransition(),
    closure: replacementController.canAuthorizeClosure()
  }, {
    transition: replacementCapabilities.transition,
    closure: replacementCapabilities.closure
  });
  assert.deepEqual(routes.slice(readsBeforeTrustedRetry.routes), [
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeTrustedRetry.identities), [
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    },
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeTrustedRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforeTrustedRetry.mutations);
  holdTrustedRetryTimeline = false;

  replacementAccessToken = ACTIVE_EVENT_HIDDEN_TOKEN;
  const deniedAgain = await replacementController.select(REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(deniedAgain.phase, 'failure');
  assert.equal(deniedAgain.selected, null);
  assert.deepEqual(deniedAgain.timeline, []);
  assert.equal(deniedAgain.stale, true);
  assert.equal(replacementController.canRetrySelection(), true);
  replacementAccessToken = REPLACEMENT_SCOPE_TOKEN;
  const readsBeforeDiscardedRetry = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdDiscardedRetryTimeline = true;
  const firstDiscardedRetry = replacementController.retrySelection();
  const secondDiscardedRetry = replacementController.retrySelection();
  assert.equal(secondDiscardedRetry, firstDiscardedRetry);
  await discardedRetryTimelineStarted;
  assert.deepEqual(routes.slice(readsBeforeDiscardedRetry.routes), [
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.equal(resolvedPrincipals.length - readsBeforeDiscardedRetry.identities, 2);
  assert.equal(timelineReads - readsBeforeDiscardedRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforeDiscardedRetry.mutations);
  const discardedReplacementState = replacementController.discardBrowserSession();
  assert.equal(discardedReplacementState.phase, 'loading');
  assert.deepEqual(discardedReplacementState.events, []);
  assert.equal(discardedReplacementState.selected, null);
  assert.deepEqual(discardedReplacementState.timeline, []);
  assert.equal(discardedReplacementState.stale, false);
  assert.equal(discardedReplacementState.error, null);
  assert.equal(replacementController.canRetrySelection(), false);
  assert.equal(replacementController.canTransition(), false);
  assert.equal(replacementController.canAuthorizeClosure(), false);
  releaseDiscardedRetryTimeline();
  const [firstDiscardedCompletion, secondDiscardedCompletion] = await Promise.all([
    firstDiscardedRetry,
    secondDiscardedRetry
  ]);
  assert.equal(firstDiscardedCompletion, discardedReplacementState);
  assert.equal(secondDiscardedCompletion, discardedReplacementState);
  assert.equal(replacementController.state, discardedReplacementState);
  assert.equal(replacementController.canRetrySelection(), false);
  assert.equal(replacementController.canTransition(), false);
  assert.equal(replacementController.canAuthorizeClosure(), false);
  holdDiscardedRetryTimeline = false;

  const readsBeforeFreshSession = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const freshReplacementSession = {
    tenantId: REPLACEMENT_SCOPE_TENANT,
    purpose: REPLACEMENT_SCOPE_PURPOSE,
    getAccessToken: async () => REPLACEMENT_SCOPE_TOKEN
  };
  const freshReplacementController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', freshReplacementSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const freshReplacementQueue = await freshReplacementController.load();
  assert.notEqual(freshReplacementQueue, discardedReplacementState);
  assert.equal(freshReplacementQueue.phase, 'ready');
  assert.deepEqual(freshReplacementQueue.events.map(({ id, version }) => ({ id, version })), [
    { id: REPLACEMENT_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(freshReplacementQueue.selected, null);
  assert.deepEqual(freshReplacementQueue.timeline, []);
  assert.equal(freshReplacementController.canRetrySelection(), false);
  assert.equal(freshReplacementController.canTransition(), false);
  assert.equal(freshReplacementController.canAuthorizeClosure(), false);
  const freshReplacementSelection = await freshReplacementController.select(REPLACEMENT_SCOPE_EVENT_ID);
  assert.notEqual(freshReplacementSelection, discardedReplacementState);
  assert.equal(freshReplacementSelection.phase, 'ready');
  assert.equal(freshReplacementSelection.selected?.id, REPLACEMENT_SCOPE_EVENT_ID);
  assert.equal(freshReplacementSelection.selected?.version, 4);
  assert.deepEqual(freshReplacementSelection.timeline, replacementTimeline);
  assert.equal(freshReplacementSelection.stale, false);
  assert.equal(freshReplacementSelection.error, null);
  assert.equal(freshReplacementController.canRetrySelection(), false);
  assert.deepEqual({
    transition: freshReplacementController.canTransition(),
    closure: freshReplacementController.canAuthorizeClosure()
  }, {
    transition: replacementCapabilities.transition,
    closure: replacementCapabilities.closure
  });
  assert.deepEqual(routes.slice(readsBeforeFreshSession.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${REPLACEMENT_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeFreshSession.identities), [
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    },
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    },
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeFreshSession.timeline, 2);
  assert.equal(mutationRequests, readsBeforeFreshSession.mutations);

  const readsBeforeDelayedQueue = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdDiscardedQueue = true;
  const obsoleteQueueController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', freshReplacementSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const delayedObsoleteQueue = obsoleteQueueController.load();
  await discardedQueueStarted;
  const discardedObsoleteQueueState = obsoleteQueueController.discardBrowserSession();
  assert.equal(discardedObsoleteQueueState.phase, 'loading');
  assert.deepEqual(discardedObsoleteQueueState.events, []);
  assert.equal(discardedObsoleteQueueState.selected, null);
  assert.deepEqual(discardedObsoleteQueueState.timeline, []);
  assert.equal(discardedObsoleteQueueState.stale, false);
  assert.equal(discardedObsoleteQueueState.error, null);
  assert.equal(obsoleteQueueController.canRetrySelection(), false);
  assert.equal(obsoleteQueueController.canTransition(), false);
  assert.equal(obsoleteQueueController.canAuthorizeClosure(), false);
  holdDiscardedQueue = false;

  const rotatedReplacementSession = {
    tenantId: ROTATED_SCOPE_TENANT,
    purpose: ROTATED_SCOPE_PURPOSE,
    getAccessToken: async () => ROTATED_SESSION_TOKEN
  };
  const laterReplacementController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', rotatedReplacementSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const laterReplacementQueue = await laterReplacementController.load();
  assert.equal(laterReplacementQueue.phase, 'ready');
  assert.deepEqual(laterReplacementQueue.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  const laterReplacementSelection = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  assert.equal(laterReplacementSelection.phase, 'ready');
  assert.equal(laterReplacementSelection.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(laterReplacementSelection.selected?.version, 4);
  assert.deepEqual(laterReplacementSelection.timeline, rotatedTimeline);
  assert.equal(laterReplacementSelection.stale, false);
  assert.equal(laterReplacementSelection.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  releaseDiscardedQueue();
  assert.equal(await delayedObsoleteQueue, discardedObsoleteQueueState);
  assert.equal(obsoleteQueueController.state, discardedObsoleteQueueState);
  assert.equal(laterReplacementController.state, laterReplacementSelection);
  assert.equal(laterReplacementController.state.stale, false);
  assert.equal(laterReplacementController.state.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforeDelayedQueue.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeDelayedQueue.identities), [
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeDelayedQueue.timeline, 2);
  assert.equal(mutationRequests, readsBeforeDelayedQueue.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 5);
  assert.equal(timelineReads, 12);

  const readsBeforeDeniedQueue = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdDeniedDiscardedQueue = true;
  const deniedQueueController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', freshReplacementSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const delayedDeniedQueue = deniedQueueController.load();
  await deniedDiscardedQueueStarted;
  const discardedDeniedQueueState = deniedQueueController.discardBrowserSession();
  assert.equal(discardedDeniedQueueState.phase, 'loading');
  assert.deepEqual(discardedDeniedQueueState.events, []);
  assert.equal(discardedDeniedQueueState.selected, null);
  assert.deepEqual(discardedDeniedQueueState.timeline, []);
  assert.equal(discardedDeniedQueueState.stale, false);
  assert.equal(discardedDeniedQueueState.error, null);
  assert.equal(deniedQueueController.canRetrySelection(), false);
  assert.equal(deniedQueueController.canTransition(), false);
  assert.equal(deniedQueueController.canAuthorizeClosure(), false);
  assert.equal(laterReplacementController.state, laterReplacementSelection);
  const rotatedReloadState = await laterReplacementController.load();
  assert.notEqual(rotatedReloadState, laterReplacementSelection);
  assert.equal(rotatedReloadState.phase, 'ready');
  assert.deepEqual(rotatedReloadState.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(rotatedReloadState.selected, null);
  assert.deepEqual(rotatedReloadState.timeline, []);
  assert.equal(rotatedReloadState.stale, false);
  assert.equal(rotatedReloadState.error, null);
  assert.equal(laterReplacementController.state, rotatedReloadState);
  assert.equal(laterReplacementController.canRetrySelection(), false);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);
  holdDeniedDiscardedQueue = false;
  releaseDeniedDiscardedQueue();
  assert.equal(await delayedDeniedQueue, discardedDeniedQueueState);
  assert.equal(deniedQueueController.state, discardedDeniedQueueState);
  assert.equal(laterReplacementController.state, rotatedReloadState);
  assert.equal(laterReplacementController.state.stale, false);
  assert.equal(laterReplacementController.state.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, {
    retry: false,
    transition: false,
    closure: false
  });
  assert.deepEqual(routes.slice(readsBeforeDeniedQueue.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    'GET /api/v1/road-events?limit=100&offset=0'
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeDeniedQueue.identities), [
    {
      actorId: REPLACEMENT_SESSION_ACTOR_ID,
      tenantId: REPLACEMENT_SCOPE_TENANT,
      purpose: REPLACEMENT_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads, readsBeforeDeniedQueue.timeline);
  assert.equal(mutationRequests, readsBeforeDeniedQueue.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 7);
  assert.equal(timelineReads, 12);

  const readsBeforeSupersededRotatedReload = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdRotatedReloadQueue = true;
  const delayedRotatedReload = laterReplacementController.load();
  await rotatedReloadQueueStarted;
  assert.equal(laterReplacementController.state.phase, 'loading');
  assert.deepEqual(laterReplacementController.state.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(laterReplacementController.state.selected, null);
  assert.deepEqual(laterReplacementController.state.timeline, []);
  const selectionDuringRotatedReload = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  assert.equal(selectionDuringRotatedReload.phase, 'ready');
  assert.equal(selectionDuringRotatedReload.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(selectionDuringRotatedReload.selected?.version, 4);
  assert.deepEqual(selectionDuringRotatedReload.timeline, rotatedTimeline);
  assert.equal(selectionDuringRotatedReload.stale, false);
  assert.equal(selectionDuringRotatedReload.error, null);
  holdRotatedReloadQueue = false;
  releaseRotatedReloadQueue();
  assert.equal(await delayedRotatedReload, selectionDuringRotatedReload);
  assert.equal(laterReplacementController.state, selectionDuringRotatedReload);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforeSupersededRotatedReload.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeSupersededRotatedReload.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeSupersededRotatedReload.timeline, 2);
  assert.equal(mutationRequests, readsBeforeSupersededRotatedReload.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 8);
  assert.equal(timelineReads, 14);

  const readsBeforeFailedRotatedReload = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdFailedRotatedReloadQueue = true;
  const delayedFailedRotatedReload = laterReplacementController.load();
  await failedRotatedReloadQueueStarted;
  assert.equal(laterReplacementController.state.phase, 'loading');
  assert.equal(laterReplacementController.state.selected, null);
  assert.deepEqual(laterReplacementController.state.timeline, []);
  assert.equal(laterReplacementController.state.stale, false);
  assert.equal(laterReplacementController.state.error, null);
  const selectionDuringFailedRotatedReload = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  assert.equal(selectionDuringFailedRotatedReload.phase, 'ready');
  assert.equal(selectionDuringFailedRotatedReload.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(selectionDuringFailedRotatedReload.selected?.version, 4);
  assert.deepEqual(selectionDuringFailedRotatedReload.timeline, rotatedTimeline);
  assert.equal(selectionDuringFailedRotatedReload.stale, false);
  assert.equal(selectionDuringFailedRotatedReload.error, null);
  holdFailedRotatedReloadQueue = false;
  releaseFailedRotatedReloadQueue();
  assert.equal(await delayedFailedRotatedReload, selectionDuringFailedRotatedReload);
  assert.equal(laterReplacementController.state, selectionDuringFailedRotatedReload);
  assert.equal(laterReplacementController.state.stale, false);
  assert.equal(laterReplacementController.state.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforeFailedRotatedReload.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeFailedRotatedReload.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeFailedRotatedReload.timeline, 2);
  assert.equal(mutationRequests, readsBeforeFailedRotatedReload.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 9);
  assert.equal(timelineReads, 16);

  const readsBeforeLatestFailedRotatedReload = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests,
    events: laterReplacementController.state.events
  };
  failLatestRotatedReloadQueue = true;
  const latestFailedRotatedReload = await laterReplacementController.load();
  failLatestRotatedReloadQueue = false;
  assert.equal(latestFailedRotatedReload.phase, 'failure');
  assert.equal(latestFailedRotatedReload.events, readsBeforeLatestFailedRotatedReload.events);
  assert.deepEqual(latestFailedRotatedReload.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(latestFailedRotatedReload.selected, null);
  assert.deepEqual(latestFailedRotatedReload.timeline, []);
  assert.equal(latestFailedRotatedReload.stale, true);
  assert.match(latestFailedRotatedReload.error ?? '', /خدمة ROS غير متاحة مؤقتًا/);
  assert.doesNotMatch(latestFailedRotatedReload.error ?? '', /postgres|secret|latest-rotated-queue|LATEST_QUEUE_SECRET/i);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, { retry: false, transition: false, closure: false });
  assert.deepEqual(routes.slice(readsBeforeLatestFailedRotatedReload.routes), [
    'GET /api/v1/road-events?limit=100&offset=0'
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeLatestFailedRotatedReload.identities), [{
    actorId: ROTATED_SESSION_ACTOR_ID,
    tenantId: ROTATED_SCOPE_TENANT,
    purpose: ROTATED_SCOPE_PURPOSE
  }]);
  assert.equal(timelineReads, readsBeforeLatestFailedRotatedReload.timeline);
  assert.equal(mutationRequests, readsBeforeLatestFailedRotatedReload.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 10);
  assert.equal(timelineReads, 16);

  const readsBeforeRecoveredRotatedReload = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const recoveredRotatedReload = await laterReplacementController.load();
  assert.notEqual(recoveredRotatedReload, latestFailedRotatedReload);
  assert.equal(recoveredRotatedReload.phase, 'ready');
  assert.deepEqual(recoveredRotatedReload.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(recoveredRotatedReload.selected, null);
  assert.deepEqual(recoveredRotatedReload.timeline, []);
  assert.equal(recoveredRotatedReload.stale, false);
  assert.equal(recoveredRotatedReload.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, { retry: false, transition: false, closure: false });
  assert.deepEqual(routes.slice(readsBeforeRecoveredRotatedReload.routes), [
    'GET /api/v1/road-events?limit=100&offset=0'
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeRecoveredRotatedReload.identities), [{
    actorId: ROTATED_SESSION_ACTOR_ID,
    tenantId: ROTATED_SCOPE_TENANT,
    purpose: ROTATED_SCOPE_PURPOSE
  }]);
  assert.equal(timelineReads, readsBeforeRecoveredRotatedReload.timeline);
  assert.equal(mutationRequests, readsBeforeRecoveredRotatedReload.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 11);
  assert.equal(timelineReads, 16);

  const readsBeforeRecoveredRotatedSelection = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const recoveredRotatedSelection = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  assert.notEqual(recoveredRotatedSelection, recoveredRotatedReload);
  assert.equal(recoveredRotatedSelection.phase, 'ready');
  assert.equal(recoveredRotatedSelection.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(recoveredRotatedSelection.selected?.version, 4);
  assert.deepEqual(recoveredRotatedSelection.timeline, rotatedTimeline);
  assert.equal(recoveredRotatedSelection.stale, false);
  assert.equal(recoveredRotatedSelection.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforeRecoveredRotatedSelection.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeRecoveredRotatedSelection.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeRecoveredRotatedSelection.timeline, 2);
  assert.equal(mutationRequests, readsBeforeRecoveredRotatedSelection.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 11);
  assert.equal(timelineReads, 18);

  const readsBeforeFailedPostRecoveryTimeline = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  failPostRecoveryRotatedTimeline = true;
  const failedPostRecoveryTimeline = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  failPostRecoveryRotatedTimeline = false;
  assert.notEqual(failedPostRecoveryTimeline, recoveredRotatedSelection);
  assert.equal(failedPostRecoveryTimeline.phase, 'failure');
  assert.equal(failedPostRecoveryTimeline.selected, null);
  assert.deepEqual(failedPostRecoveryTimeline.timeline, []);
  assert.equal(failedPostRecoveryTimeline.stale, true);
  assert.match(failedPostRecoveryTimeline.error ?? '', /خدمة ROS غير متاحة مؤقتًا/);
  assert.doesNotMatch(
    failedPostRecoveryTimeline.error ?? '',
    /postgres|secret|post-recovery-timeline|POST_RECOVERY_TIMELINE_SECRET/i
  );
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, { retry: true, transition: false, closure: false });
  assert.deepEqual(routes.slice(readsBeforeFailedPostRecoveryTimeline.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeFailedPostRecoveryTimeline.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeFailedPostRecoveryTimeline.timeline, 2);
  assert.equal(mutationRequests, readsBeforeFailedPostRecoveryTimeline.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 11);
  assert.equal(timelineReads, 20);

  const readsBeforePostRecoveryTimelineRetry = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdPostRecoveryRotatedTimelineRetry = true;
  const firstPostRecoveryTimelineRetry = laterReplacementController.retrySelection();
  const secondPostRecoveryTimelineRetry = laterReplacementController.retrySelection();
  assert.equal(firstPostRecoveryTimelineRetry, secondPostRecoveryTimelineRetry);
  await postRecoveryRotatedTimelineRetryStarted;
  assert.deepEqual(routes.slice(readsBeforePostRecoveryTimelineRetry.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.equal(timelineReads - readsBeforePostRecoveryTimelineRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforePostRecoveryTimelineRetry.mutations);
  releasePostRecoveryRotatedTimelineRetry();
  const [retriedPostRecoveryTimeline, coalescedPostRecoveryTimeline] = await Promise.all([
    firstPostRecoveryTimelineRetry,
    secondPostRecoveryTimelineRetry
  ]);
  holdPostRecoveryRotatedTimelineRetry = false;
  assert.equal(retriedPostRecoveryTimeline, coalescedPostRecoveryTimeline);
  assert.notEqual(retriedPostRecoveryTimeline, failedPostRecoveryTimeline);
  assert.equal(retriedPostRecoveryTimeline.phase, 'ready');
  assert.equal(retriedPostRecoveryTimeline.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(retriedPostRecoveryTimeline.selected?.version, 4);
  assert.deepEqual(retriedPostRecoveryTimeline.timeline, rotatedTimeline);
  assert.equal(retriedPostRecoveryTimeline.stale, false);
  assert.equal(retriedPostRecoveryTimeline.error, null);
  assert.deepEqual({
    retry: laterReplacementController.canRetrySelection(),
    transition: laterReplacementController.canTransition(),
    closure: laterReplacementController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.deepEqual(routes.slice(readsBeforePostRecoveryTimelineRetry.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforePostRecoveryTimelineRetry.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforePostRecoveryTimelineRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforePostRecoveryTimelineRetry.mutations);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 11);
  assert.equal(timelineReads, 22);

  const readsBeforeDiscardedPostRecoveryTimelineFailure = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  failPostRecoveryRotatedTimeline = true;
  const failedDiscardedPostRecoveryTimeline = await laterReplacementController.select(ROTATED_SCOPE_EVENT_ID);
  failPostRecoveryRotatedTimeline = false;
  assert.equal(failedDiscardedPostRecoveryTimeline.phase, 'failure');
  assert.equal(failedDiscardedPostRecoveryTimeline.selected, null);
  assert.deepEqual(failedDiscardedPostRecoveryTimeline.timeline, []);
  assert.equal(failedDiscardedPostRecoveryTimeline.stale, true);
  assert.equal(laterReplacementController.canRetrySelection(), true);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);
  assert.deepEqual(routes.slice(readsBeforeDiscardedPostRecoveryTimelineFailure.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeDiscardedPostRecoveryTimelineFailure.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeDiscardedPostRecoveryTimelineFailure.timeline, 2);
  assert.equal(mutationRequests, readsBeforeDiscardedPostRecoveryTimelineFailure.mutations);

  const readsBeforeDiscardedPostRecoveryTimelineRetry = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdDiscardedPostRecoveryRotatedTimelineRetry = true;
  const firstDiscardedPostRecoveryTimelineRetry = laterReplacementController.retrySelection();
  const secondDiscardedPostRecoveryTimelineRetry = laterReplacementController.retrySelection();
  assert.equal(firstDiscardedPostRecoveryTimelineRetry, secondDiscardedPostRecoveryTimelineRetry);
  await discardedPostRecoveryRotatedTimelineRetryStarted;
  assert.deepEqual(routes.slice(readsBeforeDiscardedPostRecoveryTimelineRetry.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeDiscardedPostRecoveryTimelineRetry.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeDiscardedPostRecoveryTimelineRetry.timeline, 2);
  assert.equal(mutationRequests, readsBeforeDiscardedPostRecoveryTimelineRetry.mutations);
  const discardedPostRecoveryTimelineState = laterReplacementController.discardBrowserSession();
  assert.equal(discardedPostRecoveryTimelineState.phase, 'loading');
  assert.deepEqual(discardedPostRecoveryTimelineState.events, []);
  assert.equal(discardedPostRecoveryTimelineState.selected, null);
  assert.deepEqual(discardedPostRecoveryTimelineState.timeline, []);
  assert.equal(discardedPostRecoveryTimelineState.stale, false);
  assert.equal(discardedPostRecoveryTimelineState.error, null);
  assert.equal(laterReplacementController.canRetrySelection(), false);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);

  const readsBeforeRestoredRotatedSession = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  const restoredRotatedSession = {
    tenantId: ROTATED_SCOPE_TENANT,
    purpose: ROTATED_SCOPE_PURPOSE,
    getAccessToken: async () => ROTATED_SESSION_TOKEN
  };
  const restoredRotatedController = new OperationsDashboardController(
    new HttpRoadEventGateway('http://localhost', restoredRotatedSession, fetcher),
    { roles: ['SUPERVISOR'] },
    () => NOW
  );
  const restoredRotatedQueue = await restoredRotatedController.load();
  assert.equal(restoredRotatedQueue.phase, 'ready');
  assert.deepEqual(restoredRotatedQueue.events.map(({ id, version }) => ({ id, version })), [
    { id: ROTATED_SCOPE_EVENT_ID, version: 4 }
  ]);
  assert.equal(restoredRotatedQueue.selected, null);
  assert.deepEqual(restoredRotatedQueue.timeline, []);
  assert.equal(restoredRotatedQueue.stale, false);
  assert.equal(restoredRotatedQueue.error, null);
  assert.equal(restoredRotatedController.canRetrySelection(), false);
  assert.equal(restoredRotatedController.canTransition(), false);
  assert.equal(restoredRotatedController.canAuthorizeClosure(), false);
  const restoredRotatedSelection = await restoredRotatedController.select(ROTATED_SCOPE_EVENT_ID);
  assert.equal(restoredRotatedSelection.phase, 'ready');
  assert.equal(restoredRotatedSelection.selected?.id, ROTATED_SCOPE_EVENT_ID);
  assert.equal(restoredRotatedSelection.selected?.version, 4);
  assert.deepEqual(restoredRotatedSelection.timeline, rotatedTimeline);
  assert.equal(restoredRotatedSelection.stale, false);
  assert.equal(restoredRotatedSelection.error, null);
  assert.deepEqual({
    retry: restoredRotatedController.canRetrySelection(),
    transition: restoredRotatedController.canTransition(),
    closure: restoredRotatedController.canAuthorizeClosure()
  }, replacementCapabilities);
  assert.equal(laterReplacementController.state, discardedPostRecoveryTimelineState);
  assert.equal(laterReplacementController.canRetrySelection(), false);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);
  assert.deepEqual(routes.slice(readsBeforeRestoredRotatedSession.routes), [
    'GET /api/v1/road-events?limit=100&offset=0',
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeRestoredRotatedSession.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeRestoredRotatedSession.timeline, 2);
  assert.equal(mutationRequests, readsBeforeRestoredRotatedSession.mutations);
  releaseDiscardedPostRecoveryRotatedTimelineRetry();
  const [firstDiscardedPostRecoveryTimelineCompletion, secondDiscardedPostRecoveryTimelineCompletion] = await Promise.all([
    firstDiscardedPostRecoveryTimelineRetry,
    secondDiscardedPostRecoveryTimelineRetry
  ]);
  holdDiscardedPostRecoveryRotatedTimelineRetry = false;
  assert.equal(firstDiscardedPostRecoveryTimelineCompletion, discardedPostRecoveryTimelineState);
  assert.equal(secondDiscardedPostRecoveryTimelineCompletion, discardedPostRecoveryTimelineState);
  assert.equal(laterReplacementController.state, discardedPostRecoveryTimelineState);
  assert.equal(laterReplacementController.canRetrySelection(), false);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);
  assert.equal(restoredRotatedController.state, restoredRotatedSelection);
  assert.deepEqual({
    retry: restoredRotatedController.canRetrySelection(),
    transition: restoredRotatedController.canTransition(),
    closure: restoredRotatedController.canAuthorizeClosure()
  }, replacementCapabilities);

  const readsBeforeDiscardedRestoredSelection = {
    routes: routes.length,
    identities: resolvedPrincipals.length,
    timeline: timelineReads,
    mutations: mutationRequests
  };
  holdDiscardedRestoredRotatedTimeline = true;
  const pendingDiscardedRestoredSelection = restoredRotatedController.select(ROTATED_SCOPE_EVENT_ID);
  await discardedRestoredRotatedTimelineStarted;
  assert.deepEqual(routes.slice(readsBeforeDiscardedRestoredSelection.routes), [
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}`,
    `GET /api/v1/road-events/${ROTATED_SCOPE_EVENT_ID}/timeline`
  ]);
  assert.deepEqual(resolvedPrincipals.slice(readsBeforeDiscardedRestoredSelection.identities), [
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    },
    {
      actorId: ROTATED_SESSION_ACTOR_ID,
      tenantId: ROTATED_SCOPE_TENANT,
      purpose: ROTATED_SCOPE_PURPOSE
    }
  ]);
  assert.equal(timelineReads - readsBeforeDiscardedRestoredSelection.timeline, 2);
  assert.equal(mutationRequests, readsBeforeDiscardedRestoredSelection.mutations);
  const discardedRestoredState = restoredRotatedController.discardBrowserSession();
  assert.equal(discardedRestoredState.phase, 'loading');
  assert.deepEqual(discardedRestoredState.events, []);
  assert.equal(discardedRestoredState.selected, null);
  assert.deepEqual(discardedRestoredState.timeline, []);
  assert.equal(discardedRestoredState.stale, false);
  assert.equal(discardedRestoredState.error, null);
  assert.equal(restoredRotatedController.canRetrySelection(), false);
  assert.equal(restoredRotatedController.canTransition(), false);
  assert.equal(restoredRotatedController.canAuthorizeClosure(), false);
  assert.equal(laterReplacementController.state, discardedPostRecoveryTimelineState);
  releaseDiscardedRestoredRotatedTimeline();
  const discardedRestoredSelectionCompletion = await pendingDiscardedRestoredSelection;
  holdDiscardedRestoredRotatedTimeline = false;
  assert.equal(discardedRestoredSelectionCompletion, discardedRestoredState);
  assert.equal(restoredRotatedController.state, discardedRestoredState);
  assert.equal(restoredRotatedController.canRetrySelection(), false);
  assert.equal(restoredRotatedController.canTransition(), false);
  assert.equal(restoredRotatedController.canAuthorizeClosure(), false);
  assert.equal(laterReplacementController.state, discardedPostRecoveryTimelineState);
  assert.equal(laterReplacementController.canRetrySelection(), false);
  assert.equal(laterReplacementController.canTransition(), false);
  assert.equal(laterReplacementController.canAuthorizeClosure(), false);
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 12);
  assert.equal(timelineReads, 30);
  assert.deepEqual(resolvedPrincipals.map(({ tenantId, purpose }) => ({ tenantId, purpose })), [
    { tenantId: PRIOR_SCOPE_TENANT, purpose: PRIOR_SCOPE_PURPOSE },
    { tenantId: PRIOR_SCOPE_TENANT, purpose: PRIOR_SCOPE_PURPOSE },
    { tenantId: PRIOR_SCOPE_TENANT, purpose: PRIOR_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: HIDDEN_SCOPE_TENANT, purpose: HIDDEN_SCOPE_PURPOSE },
    { tenantId: HIDDEN_SCOPE_TENANT, purpose: HIDDEN_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: HIDDEN_SCOPE_TENANT, purpose: HIDDEN_SCOPE_PURPOSE },
    { tenantId: HIDDEN_SCOPE_TENANT, purpose: HIDDEN_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE },
    { tenantId: ROTATED_SCOPE_TENANT, purpose: ROTATED_SCOPE_PURPOSE }
  ]);
  assert.equal(mutationRequests, 0);
});
