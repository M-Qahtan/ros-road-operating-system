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
const TENANT = 'riyadh-pilot';
const PURPOSE = 'HUMAN_SAFETY_RESPONSE';
const TOKEN = 'trusted-api-dashboard-token';
const PRIOR_SESSION_TOKEN = 'prior-api-dashboard-token';
const REPLACEMENT_SESSION_TOKEN = 'replacement-api-dashboard-token';
const NOW = new Date('2026-09-30T09:15:00.000Z');

const PRIOR_SCOPE_EVENT_ID = '99999999-9999-4999-8999-999999999999';
const REPLACEMENT_SCOPE_EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIOR_SCOPE_TENANT = 'riyadh-prior-scope';
const PRIOR_SCOPE_PURPOSE = 'PRIOR_SAFETY_RESPONSE';
const REPLACEMENT_SCOPE_TENANT = 'riyadh-replacement-scope';
const REPLACEMENT_SCOPE_PURPOSE = 'REPLACEMENT_SAFETY_RESPONSE';
const PRIOR_SCOPE_TOKEN = 'prior-scope-api-dashboard-token';
const REPLACEMENT_SCOPE_TOKEN = 'replacement-scope-api-dashboard-token';
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
  let timelineReads = 0;
  const auditTimeline = {
    async listForRoadEvent(roadEventId, scope) {
      timelineReads += 1;
      if (roadEventId === PRIOR_SCOPE_EVENT_ID) {
        assert.deepEqual(scope, { tenantId: PRIOR_SCOPE_TENANT, purpose: PRIOR_SCOPE_PURPOSE });
        return priorTimeline;
      }
      assert.equal(roadEventId, REPLACEMENT_SCOPE_EVENT_ID);
      assert.deepEqual(scope, { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE });
      return replacementTimeline;
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
  assert.equal(routes.filter((route) => route.includes('?limit=100&offset=0')).length, 2);
  assert.equal(timelineReads, 8);
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
    { tenantId: REPLACEMENT_SCOPE_TENANT, purpose: REPLACEMENT_SCOPE_PURPOSE }
  ]);
  assert.equal(mutationRequests, 0);
});
