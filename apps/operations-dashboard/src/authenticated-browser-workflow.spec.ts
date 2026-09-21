import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiEnvelope, RoadEventResponse } from '@ros/contracts';
import { HttpRoadEventGateway, type AuditTimelineEntryContract } from './api-client.js';
import { OperationsDashboardController, SupersededCriticalActionError } from './dashboard.js';
import { HumanSafetyCommandCenterController } from './human-safety-command-center.js';
import {
  HttpHumanSafetyCommandCenterGateway,
  SimulatedHumanSafetyCommandCenterGateway,
  seedCommandCenterCases,
  type CommandCenterActionInput,
  type CommandCenterReassignInput
} from './human-safety-gateway.js';
import { renderHumanSafetyCommandCenter } from './human-safety-render.js';
import { renderDashboard } from './render.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const session = {
  actorId,
  roles: ['SUPERVISOR'] as const,
  tenantId: 'riyadh-pilot',
  purpose: 'HUMAN_SAFETY_RESPONSE',
  getAccessToken: () => Promise.resolve('trusted-browser-token')
};

function ok<T>(data: T): Response {
  const envelope: ApiEnvelope<T> = { success: true, data, error: null, traceId: 'trace-http-workflow' };
  return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
}

function assertTrustedRequest(init: RequestInit | undefined): void {
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer trusted-browser-token');
  assert.equal(headers.get('x-tenant-id'), 'riyadh-pilot');
  assert.equal(headers.get('x-purpose'), 'HUMAN_SAFETY_RESPONSE');
  assert.equal(headers.has('x-actor-id'), false);
  assert.equal(headers.has('x-ros-roles'), false);
  assert.equal(headers.has('x-ros-eye-roles'), false);
}

function barrier(): { readonly wait: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

test('newer authenticated operator intent supersedes an in-flight selection retry', async () => {
  const failedEvent: RoadEventResponse = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 3, closureAuthorization: null,
    severity: { level: 'S2', score: 50, confidence: 0.9, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const newerEvent: RoadEventResponse = { ...failedEvent, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', version: 5 };
  let failSelection = true;
  let retryBarrier: ReturnType<typeof barrier> | null = null;
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname === `/api/v1/road-events/${failedEvent.id}`) {
      if (failSelection) {
        const envelope: ApiEnvelope<never> = { success: false, data: null,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'delayed incident read failed' }, traceId: 'trace-intent-failure' };
        return new Response(JSON.stringify(envelope), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      if (retryBarrier !== null) await retryBarrier.wait;
      return ok(failedEvent);
    }
    if (target.pathname === `/api/v1/road-events/${newerEvent.id}`) return ok(newerEvent);
    if (target.pathname.endsWith('/timeline')) return ok([]);
    return ok({ items: [failedEvent, newerEvent], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(failedEvent.id);
  assert.equal(controller.canRetrySelection(), true);

  failSelection = false;
  retryBarrier = barrier();
  const obsoleteRetry = controller.retrySelection();
  await controller.select(newerEvent.id);
  assert.equal(controller.state.selected?.id, newerEvent.id);
  retryBarrier.release();
  const obsoleteRetryResult = await obsoleteRetry;
  assert.equal(obsoleteRetryResult.selected?.id, newerEvent.id);
  assert.equal(controller.state.selected?.id, newerEvent.id);

  failSelection = true;
  retryBarrier = null;
  await controller.select(failedEvent.id);
  assert.equal(controller.canRetrySelection(), true);
  failSelection = false;
  retryBarrier = barrier();
  const obsoleteRetryBeforeReload = controller.retrySelection();
  const reloaded = await controller.load();
  assert.equal(reloaded.phase, 'ready');
  assert.equal(reloaded.selected, null);
  retryBarrier.release();
  const obsoleteReloadResult = await obsoleteRetryBeforeReload;
  assert.equal(obsoleteReloadResult.selected, null);
  assert.equal(controller.state.selected, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.deepEqual(paths, [
    'GET /api/v1/road-events',
    `GET /api/v1/road-events/${failedEvent.id}`,
    `GET /api/v1/road-events/${failedEvent.id}/timeline`,
    `GET /api/v1/road-events/${failedEvent.id}`,
    `GET /api/v1/road-events/${failedEvent.id}/timeline`,
    `GET /api/v1/road-events/${newerEvent.id}`,
    `GET /api/v1/road-events/${newerEvent.id}/timeline`,
    `GET /api/v1/road-events/${failedEvent.id}`,
    `GET /api/v1/road-events/${failedEvent.id}/timeline`,
    `GET /api/v1/road-events/${failedEvent.id}`,
    `GET /api/v1/road-events/${failedEvent.id}/timeline`,
    'GET /api/v1/road-events'
  ]);
});

test('newer authenticated selection supersedes delayed critical completion and follow-up timeline', async () => {
  let criticalEvent: RoadEventResponse = {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 95, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const newerEvent: RoadEventResponse = {
    ...criticalEvent, id: '99999999-9999-4999-8999-999999999999', version: 2, closureAuthorization: null,
    severity: { level: 'S2', score: 48, confidence: 0.9, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  let authorizationBarrier: ReturnType<typeof barrier> | null = null;
  let transitionBarrier: ReturnType<typeof barrier> | null = null;
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname.endsWith('/closure-authorization')) {
      if (authorizationBarrier !== null) await authorizationBarrier.wait;
      const body = JSON.parse(String(init?.body)) as { readonly reason: string; readonly authorizedAt: string };
      criticalEvent = { ...criticalEvent, version: 8,
        closureAuthorization: { actorId, reason: body.reason, authorizedAt: body.authorizedAt } };
      return ok(criticalEvent);
    }
    if (target.pathname.endsWith('/transition')) {
      if (transitionBarrier !== null) await transitionBarrier.wait;
      criticalEvent = { ...criticalEvent, status: 'CLOSED', version: 9 };
      return ok(criticalEvent);
    }
    if (target.pathname === `/api/v1/road-events/${criticalEvent.id}`) return ok(criticalEvent);
    if (target.pathname === `/api/v1/road-events/${newerEvent.id}`) return ok(newerEvent);
    if (target.pathname.endsWith('/timeline')) return ok([]);
    return ok({ items: [criticalEvent, newerEvent], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(criticalEvent.id);
  authorizationBarrier = barrier();
  const authorization = controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  await controller.select(newerEvent.id);
  authorizationBarrier.release();
  const authorizationResult = await authorization;
  assert.equal(authorizationResult.selected?.id, newerEvent.id);
  assert.equal(controller.state.selected?.id, newerEvent.id);
  assert.equal(paths.filter((path) => path === `GET /api/v1/road-events/${criticalEvent.id}/timeline`).length, 1);

  await controller.select(criticalEvent.id);
  assert.equal(controller.canTransitionTo('CLOSED'), true);
  transitionBarrier = barrier();
  const transition = controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق');
  await controller.select(newerEvent.id);
  transitionBarrier.release();
  const transitionResult = await transition;
  assert.equal(transitionResult.selected?.id, newerEvent.id);
  assert.equal(controller.state.selected?.id, newerEvent.id);
  assert.equal(controller.state.stale, false);
  assert.equal(paths.filter((path) => path === `GET /api/v1/road-events/${criticalEvent.id}/timeline`).length, 2);
});

test('delayed critical failure is attributed to its originating incident without staling the newer view', async () => {
  const originatingEvent: RoadEventResponse = {
    id: '77777777-7777-4777-8777-777777777777', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 95, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const newerEvent: RoadEventResponse = {
    ...originatingEvent, id: '66666666-6666-4666-8666-666666666666', version: 2,
    severity: { level: 'S2', score: 48, confidence: 0.9, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const failureBarrier = barrier();
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      await failureBarrier.wait;
      const envelope: ApiEnvelope<never> = { success: false, data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'internal delayed authorization failure' },
        traceId: 'trace-superseded-critical-failure' };
      return new Response(JSON.stringify(envelope), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (target.pathname === `/api/v1/road-events/${originatingEvent.id}`) return ok(originatingEvent);
    if (target.pathname === `/api/v1/road-events/${newerEvent.id}`) return ok(newerEvent);
    if (target.pathname.endsWith('/timeline')) return ok([]);
    return ok({ items: [originatingEvent, newerEvent], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(originatingEvent.id);
  const authorization = controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  await controller.select(newerEvent.id);
  failureBarrier.release();
  await assert.rejects(authorization, (error: unknown) => {
    assert.ok(error instanceof SupersededCriticalActionError);
    assert.equal(error.incidentId, originatingEvent.id);
    assert.equal(error.action, 'AUTHORIZE_CLOSURE');
    assert.match(error.message, new RegExp(originatingEvent.id));
    assert.doesNotMatch(error.message, /internal delayed authorization failure/);
    return true;
  });
  assert.equal(controller.state.selected?.id, newerEvent.id);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  assert.equal(controller.canTransition(), true);
});

test('repeated critical confirmations share one authenticated mutation and reject a competing action locally', async () => {
  let event: RoadEventResponse = {
    id: '55555555-5555-4555-8555-555555555555', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const authorizationBarrier = barrier();
  const transitionBarrier = barrier();
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname.endsWith('/closure-authorization')) {
      await authorizationBarrier.wait;
      const body = JSON.parse(String(init?.body)) as { readonly reason: string; readonly authorizedAt: string };
      event = { ...event, version: 8, closureAuthorization: { actorId, reason: body.reason, authorizedAt: body.authorizedAt } };
      return ok(event);
    }
    if (target.pathname.endsWith('/transition')) {
      await transitionBarrier.wait;
      event = { ...event, status: 'CLOSED', version: 9 };
      return ok(event);
    }
    if (target.pathname.endsWith('/timeline')) return ok([]);
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(event.id);
  const firstAuthorization = controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  const duplicateAuthorization = controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  await assert.rejects(
    () => controller.authorizeClosure('سبب متنافس أثناء التنفيذ'),
    /يوجد إجراء حرج قيد التنفيذ/
  );
  assert.equal(paths.filter((path) => path.endsWith('/closure-authorization')).length, 1);
  authorizationBarrier.release();
  const [authorized, duplicateAuthorized] = await Promise.all([firstAuthorization, duplicateAuthorization]);
  assert.equal(authorized.selected?.version, 8);
  assert.equal(duplicateAuthorized.selected?.version, 8);

  const firstTransition = controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق');
  const duplicateTransition = controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق');
  await assert.rejects(
    () => controller.transition('RECOVERY', 'انتقال متنافس أثناء التنفيذ'),
    /يوجد إجراء حرج قيد التنفيذ/
  );
  assert.equal(paths.filter((path) => path.endsWith('/transition')).length, 1);
  transitionBarrier.release();
  const [closed, duplicateClosed] = await Promise.all([firstTransition, duplicateTransition]);
  assert.equal(closed.selected?.version, 9);
  assert.equal(duplicateClosed.selected?.version, 9);
  assert.equal(paths.filter((path) => path.endsWith('/transition')).length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/closure-authorization')).length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/timeline')).length, 3);
});

test('authenticated RoadEvent browser workflow withholds closure until the exact authorized revision', async () => {
  let event: RoadEventResponse = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'RECOVERY',
    latitude: 24.72,
    longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z',
    version: 7,
    closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const activeEvent: RoadEventResponse = {
    ...event,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'RECOVERY',
    version: 3,
    closureAuthorization: null,
    severity: { level: 'S2', score: 54, confidence: 0.91, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const timeline: AuditTimelineEntryContract[] = [];
  const paths: string[] = [];
  let failActiveSelection = false;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname.endsWith('/closure-authorization')) {
      const body = JSON.parse(String(init?.body)) as { readonly reason: string; readonly authorizedAt: string };
      event = { ...event, version: 8, closureAuthorization: { actorId, reason: body.reason, authorizedAt: body.authorizedAt } };
      timeline.push({ action: 'road_event.closure_authorized', actorType: 'SUPERVISOR', actorId, beforeState: null,
        afterState: { version: 8 }, reason: body.reason, traceId: 'trace-closure', occurredAt: body.authorizedAt });
      return ok(event);
    }
    if (target.pathname.endsWith('/transition')) {
      const body = JSON.parse(String(init?.body)) as { readonly expectedVersion: number; readonly nextStatus: string; readonly reason: string };
      assert.deepEqual(body, { expectedVersion: 8, nextStatus: 'CLOSED', reason: 'اكتملت مراجعة الإغلاق' });
      event = { ...event, status: 'CLOSED', version: 9 };
      timeline.push({ action: 'road_event.closed', actorType: 'SUPERVISOR', actorId, beforeState: { version: 8 },
        afterState: { version: 9 }, reason: body.reason, traceId: 'trace-closed', occurredAt: '2026-08-20T10:00:30.000Z' });
      return ok(event);
    }
    if (target.pathname === `/api/v1/road-events/${activeEvent.id}/timeline`) return ok([]);
    if (target.pathname.endsWith('/timeline')) return ok(timeline);
    if (target.pathname === `/api/v1/road-events/${activeEvent.id}`) {
      if (failActiveSelection) {
        const envelope: ApiEnvelope<never> = {
          success: false,
          data: null,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'internal active incident read failed' },
          traceId: 'trace-active-read-failure'
        };
        return new Response(JSON.stringify(envelope), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return ok(activeEvent);
    }
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event, activeEvent], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher),
    { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(event.id);
  let html = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:00:00.000Z') });

  assert.equal(controller.canTransitionTo('CLOSED'), false);
  assert.match(html, /<option value="CLOSED" disabled>/);
  await assert.rejects(() => controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق'), /دون تفويض إغلاق موثّق/);
  assert.equal(paths.some((path) => path.includes('/transition')), false);

  await controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  html = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:00:00.000Z') });

  assert.equal(controller.state.selected?.version, 8);
  assert.equal(controller.canTransitionTo('CLOSED'), true);
  assert.doesNotMatch(html, /<option value="CLOSED" disabled>/);
  assert.match(html, /تحقق المشرف من سلامة الموقع/);
  assert.match(html, /road_event\.closure_authorized/);
  await controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق');
  assert.equal(controller.state.selected?.status, 'CLOSED');
  assert.equal(controller.state.selected?.version, 9);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(controller.canRetrySelection(), false);
  const terminalPathCount = paths.length;
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة إعادة فتح'), /الحالة النهائية/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض جديد'), /الحالة النهائية/);
  assert.equal(paths.length, terminalPathCount);
  const terminalHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:00:00.000Z') });
  assert.match(terminalHtml, /تم استهلاك التفويض — الحالة مغلقة نهائيًا/);
  assert.match(terminalHtml, /<select name="nextStatus" disabled>/);
  assert.match(terminalHtml, /road_event\.closure_authorized/);
  assert.match(terminalHtml, /road_event\.closed/);

  event = { ...event, closureAuthorization: null };
  await controller.load();
  await controller.select(event.id);
  const durableTerminalPathCount = paths.length;
  assert.equal(controller.state.selected?.status, 'CLOSED');
  assert.equal(controller.state.selected?.version, 9);
  assert.equal(controller.state.selected?.closureAuthorization, null);
  assert.equal(controller.state.timeline.length, 2);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة إعادة فتح بعد التحديث'), /الحالة النهائية/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض بعد التحديث'), /الحالة النهائية/);
  assert.equal(paths.length, durableTerminalPathCount);
  const refreshedTerminalHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:01:00.000Z') });
  assert.match(refreshedTerminalHtml, /تم استهلاك التفويض — الحالة مغلقة نهائيًا/);
  assert.match(refreshedTerminalHtml, /road_event\.closure_authorized/);
  assert.match(refreshedTerminalHtml, /road_event\.closed/);
  assert.match(refreshedTerminalHtml, /<select name="nextStatus" disabled>/);

  await controller.select(activeEvent.id);
  assert.equal(controller.state.selected?.id, activeEvent.id);
  assert.equal(controller.canTransition(), true);
  await controller.select(event.id);
  const returnedTerminalPathCount = paths.length;
  assert.equal(controller.state.selected?.status, 'CLOSED');
  assert.equal(controller.state.selected?.closureAuthorization, null);
  assert.equal(controller.state.timeline.length, 2);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة إعادة فتح بعد العودة'), /الحالة النهائية/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض بعد العودة'), /الحالة النهائية/);
  assert.equal(paths.length, returnedTerminalPathCount);
  const returnedTerminalHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:02:00.000Z') });
  assert.match(returnedTerminalHtml, /road_event\.closure_authorized/);
  assert.match(returnedTerminalHtml, /road_event\.closed/);
  assert.match(returnedTerminalHtml, /<select name="nextStatus" disabled>/);

  failActiveSelection = true;
  await controller.select(activeEvent.id);
  const failedSelectionPathCount = paths.length;
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.state.stale, true);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(controller.canRetrySelection(), true);
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة بعد فشل التحميل'), /اختر حدثًا/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض بعد فشل التحميل'), /اختر حدثًا/);
  assert.equal(paths.length, failedSelectionPathCount);
  const failedSelectionHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), canRetrySelection: controller.canRetrySelection(),
    now: new Date('2026-08-20T10:03:00.000Z') });
  assert.match(failedSelectionHtml, /البيانات قديمة/);
  assert.match(failedSelectionHtml, /اختر حدثًا من القائمة/);
  assert.match(failedSelectionHtml, /id="retry-selection-button"/);
  assert.doesNotMatch(failedSelectionHtml, /road_event\.closure_authorized|road_event\.closed/);
  assert.doesNotMatch(failedSelectionHtml, /internal active incident read failed/);

  await controller.retrySelection();
  const failedRetryPathCount = paths.length;
  assert.equal(failedRetryPathCount, failedSelectionPathCount + 2);
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.state.stale, true);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  const failedRetryHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), canRetrySelection: controller.canRetrySelection(),
    now: new Date('2026-08-20T10:04:00.000Z') });
  assert.match(failedRetryHtml, /id="retry-selection-button"/);
  assert.doesNotMatch(failedRetryHtml, /road_event\.closure_authorized|road_event\.closed|internal active incident read failed/);

  failActiveSelection = false;
  const recoveryStartPathCount = paths.length;
  const recovery = controller.retrySelection();
  const duplicateRecovery = controller.retrySelection();
  assert.equal(duplicateRecovery, recovery);
  const [recovered, duplicateRecovered] = await Promise.all([recovery, duplicateRecovery]);
  const recoveredSelectionPathCount = paths.length;
  assert.equal(recoveredSelectionPathCount, recoveryStartPathCount + 2);
  assert.equal(duplicateRecovered, recovered);
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.stale, false);
  assert.equal(recovered.selected?.id, activeEvent.id);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.canTransition(), true);
  const recoveredSelectionHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), canRetrySelection: controller.canRetrySelection(),
    now: new Date('2026-08-20T10:04:00.000Z') });
  assert.match(recoveredSelectionHtml, new RegExp(activeEvent.id));
  assert.match(recoveredSelectionHtml, /لا يوجد تفويض — الإغلاق غير متاح/);
  assert.doesNotMatch(recoveredSelectionHtml, /retry-selection-button|road_event\.closure_authorized|road_event\.closed/);
  assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);
  assert.equal(paths.length, recoveredSelectionPathCount);
  assert.deepEqual(paths, [
    'GET /api/v1/road-events',
    `GET /api/v1/road-events/${event.id}`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `POST /api/v1/road-events/${event.id}/closure-authorization`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `POST /api/v1/road-events/${event.id}/transition`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    'GET /api/v1/road-events',
    `GET /api/v1/road-events/${event.id}`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `GET /api/v1/road-events/${activeEvent.id}`,
    `GET /api/v1/road-events/${activeEvent.id}/timeline`,
    `GET /api/v1/road-events/${event.id}`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `GET /api/v1/road-events/${activeEvent.id}`,
    `GET /api/v1/road-events/${activeEvent.id}/timeline`,
    `GET /api/v1/road-events/${activeEvent.id}`,
    `GET /api/v1/road-events/${activeEvent.id}/timeline`,
    `GET /api/v1/road-events/${activeEvent.id}`,
    `GET /api/v1/road-events/${activeEvent.id}/timeline`
  ]);
});

test('authenticated closure conflict requires an explicit refresh to a withheld newer revision', async () => {
  let event: RoadEventResponse = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'RECOVERY',
    latitude: 24.72,
    longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z',
    version: 8,
    closureAuthorization: {
      actorId,
      reason: 'تحقق المشرف من سلامة الموقع',
      authorizedAt: '2026-08-20T10:00:00.000Z'
    },
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const timeline: AuditTimelineEntryContract[] = [{
    action: 'road_event.closure_authorized',
    actorType: 'SUPERVISOR',
    actorId,
    beforeState: null,
    afterState: { version: 8 },
    reason: 'تحقق المشرف من سلامة الموقع',
    traceId: 'trace-invalidated-authorization',
    occurredAt: '2026-08-20T10:00:00.000Z'
  }];
  const paths: string[] = [];
  let transitionRequests = 0;
  let authorizationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname.endsWith('/transition')) {
      transitionRequests += 1;
      const body = JSON.parse(String(init?.body)) as { readonly expectedVersion: number; readonly nextStatus: string };
      assert.deepEqual(body, { expectedVersion: 8, nextStatus: 'CLOSED', reason: 'اكتملت مراجعة الإغلاق' });
      event = { ...event, version: 9, closureAuthorization: null };
      const envelope: ApiEnvelope<never> = {
        success: false,
        data: null,
        error: { code: 'SOURCE_SNAPSHOT_CONFLICT', message: 'internal cognitive revision changed' },
        traceId: 'trace-safe-conflict'
      };
      return new Response(JSON.stringify(envelope), { status: 409, headers: { 'content-type': 'application/json' } });
    }
    if (target.pathname.endsWith('/closure-authorization')) {
      authorizationRequests += 1;
      const body = JSON.parse(String(init?.body)) as {
        readonly expectedVersion: number;
        readonly reason: string;
        readonly authorizedAt: string;
      };
      assert.deepEqual(body, {
        expectedVersion: 9,
        reason: 'إعادة تفويض بعد مراجعة الإصدار الجديد',
        authorizedAt: '2026-08-20T10:01:00.000Z'
      });
      event = {
        ...event,
        version: 10,
        closureAuthorization: { actorId, reason: body.reason, authorizedAt: body.authorizedAt }
      };
      timeline.push({
        action: 'road_event.closure_authorized',
        actorType: 'SUPERVISOR',
        actorId,
        beforeState: { version: 9 },
        afterState: { version: 10 },
        reason: body.reason,
        traceId: 'trace-replacement-authorization',
        occurredAt: body.authorizedAt
      });
      return ok(event);
    }
    if (target.pathname.endsWith('/timeline')) return ok(timeline);
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher),
    { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:01:00.000Z')
  );

  await controller.load();
  await controller.select(event.id);
  assert.equal(controller.canTransitionTo('CLOSED'), true);
  await assert.rejects(() => controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق'), /تغيرت البيانات/);

  assert.equal(transitionRequests, 1);
  assert.equal(controller.state.stale, true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canTransitionTo('CLOSED'), false);
  assert.doesNotMatch(controller.state.error ?? '', /internal|cognitive|SOURCE_SNAPSHOT_CONFLICT/i);
  const html = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:01:00.000Z') });
  assert.match(html, /البيانات قديمة/);
  assert.match(html, /<select name="nextStatus" disabled>/);

  await controller.load();
  await controller.select(event.id);
  assert.equal(transitionRequests, 1);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.selected?.version, 9);
  assert.equal(controller.state.selected?.closureAuthorization, null);
  assert.equal(controller.canTransition(), true);
  assert.equal(controller.canTransitionTo('CLOSED'), false);
  const refreshedHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:01:00.000Z') });
  assert.match(refreshedHtml, new RegExp(event.id));
  assert.match(refreshedHtml, /لا يوجد تفويض — الإغلاق غير متاح/);
  assert.match(refreshedHtml, /<option value="CLOSED" disabled>/);
  assert.match(refreshedHtml, /تحقق المشرف من سلامة الموقع/);

  await controller.authorizeClosure('إعادة تفويض بعد مراجعة الإصدار الجديد');
  assert.equal(authorizationRequests, 1);
  assert.equal(transitionRequests, 1);
  assert.equal(controller.state.selected?.version, 10);
  assert.deepEqual(controller.state.selected?.closureAuthorization, {
    actorId,
    reason: 'إعادة تفويض بعد مراجعة الإصدار الجديد',
    authorizedAt: '2026-08-20T10:01:00.000Z'
  });
  assert.equal(controller.state.timeline.length, 2);
  assert.equal(controller.canTransitionTo('CLOSED'), true);
  const reauthorizedHtml = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:01:00.000Z') });
  assert.doesNotMatch(reauthorizedHtml, /<option value="CLOSED" disabled>/);
  assert.match(reauthorizedHtml, /تحقق المشرف من سلامة الموقع/);
  assert.match(reauthorizedHtml, /إعادة تفويض بعد مراجعة الإصدار الجديد/);
  assert.deepEqual(paths, [
    'GET /api/v1/road-events',
    `GET /api/v1/road-events/${event.id}`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `POST /api/v1/road-events/${event.id}/transition`,
    'GET /api/v1/road-events',
    `GET /api/v1/road-events/${event.id}`,
    `GET /api/v1/road-events/${event.id}/timeline`,
    `POST /api/v1/road-events/${event.id}/closure-authorization`,
    `GET /api/v1/road-events/${event.id}/timeline`
  ]);
});

test('authenticated Human Safety browser workflow crosses every HTTP action with server-rebound identity', async () => {
  const now = new Date('2026-08-20T10:00:00.000Z');
  const backend = new SimulatedHumanSafetyCommandCenterGateway(seedCommandCenterCases(now));
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (init?.method !== 'POST') {
      if (target.pathname === '/api/v1/human-safety/cases') {
        const page = await backend.list();
        return ok({ ...page, simulation: false });
      }
      const caseId = decodeURIComponent(target.pathname.split('/').at(-1) ?? '');
      return ok(await backend.get(caseId));
    }
    const match = /^\/api\/v1\/human-safety\/cases\/([^/]+)\/(takeover|escalate|assignment|resolution-authorization)$/.exec(target.pathname);
    assert.ok(match);
    const body = JSON.parse(String(init.body)) as Omit<CommandCenterActionInput, 'actorId' | 'actorRoles'> & { readonly assigneeId?: string };
    assert.equal('actorId' in body, false);
    assert.equal('actorRoles' in body, false);
    const trustedAction: CommandCenterActionInput = { ...body, actorId, actorRoles: ['SUPERVISOR'] };
    const caseId = decodeURIComponent(match[1]!);
    if (match[2] === 'takeover') return ok(await backend.takeover(caseId, trustedAction));
    if (match[2] === 'escalate') return ok(await backend.escalate(caseId, trustedAction));
    if (match[2] === 'assignment') {
      const reassignment: CommandCenterReassignInput = { ...trustedAction, assigneeId: body.assigneeId ?? '' };
      return ok(await backend.reassign(caseId, reassignment));
    }
    return ok(await backend.authorizeResolution(caseId, trustedAction));
  };
  const controller = new HumanSafetyCommandCenterController(
    new HttpHumanSafetyCommandCenterGateway('', session, fetcher),
    { actorId, roles: ['SUPERVISOR'] },
    () => now
  );

  await controller.load();
  await controller.select('case-ros-eye-001');
  await controller.takeover('استحواذ المشرف على التواصل', 'idem-http-takeover', 'trace-http-takeover');
  await controller.escalate('تصعيد بشري بعد عدم الاستجابة', 'idem-http-escalate', 'trace-http-escalate');
  await controller.reassign('operator-2', 'إسناد الحالة إلى المناوب', 'idem-http-assign', 'trace-http-assign');
  await controller.select('case-ros-eye-002');
  await controller.authorizeResolution('اكتملت مراجعة الأدلة الموثوقة', 'idem-http-resolution', 'trace-http-resolution');
  const html = renderHumanSafetyCommandCenter(controller.state, controller, now);

  assert.equal(controller.state.simulation, false);
  assert.match(html, /محلولة/);
  assert.match(html, /human_safety\.resolution_authorized/);
  assert.doesNotMatch(html, /بيئة محاكاة فقط/);
  assert.deepEqual(paths.filter((path) => path.startsWith('POST')), [
    'POST /api/v1/human-safety/cases/case-ros-eye-001/takeover',
    'POST /api/v1/human-safety/cases/case-ros-eye-001/escalate',
    'POST /api/v1/human-safety/cases/case-ros-eye-001/assignment',
    'POST /api/v1/human-safety/cases/case-ros-eye-002/resolution-authorization'
  ]);
});
