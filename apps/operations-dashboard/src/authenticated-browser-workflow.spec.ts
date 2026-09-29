import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ApiEnvelope, RoadEventResponse } from '@ros/contracts';
import { HttpRoadEventGateway, type AuditTimelineEntryContract } from './api-client.js';
import { OperationsDashboardController, SupersededCriticalActionError } from './dashboard.js';
import { CriticalRefreshCoordinator } from './critical-refresh-coordinator.js';
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

test('validated exhausted reconciliation requires human review and exposes no critical retry path', async () => {
  const incident = {
    id: '47474747-4747-4747-8747-474747474747',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-27T06:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true },
    reconciliation: {
      state: 'HUMAN_REVIEW_REQUIRED', automaticRetryAuthorized: false, closureAuthorized: false
    }
  } as RoadEventResponse;
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    paths.push(`${init?.method ?? 'GET'} ${target.pathname}`);
    if (target.pathname.endsWith('/timeline')) return ok([]);
    if (target.pathname === `/api/v1/road-events/${incident.id}`) return ok(incident);
    return ok({ items: [{ ...incident, reconciliation: null }], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-27T06:01:00.000Z')
  );

  await controller.load();
  await controller.select(incident.id);
  const html = renderDashboard(controller.state, {
    canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(),
    now: new Date('2026-09-27T06:01:00.000Z')
  });

  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  assert.match(html, /تتطلب مراجعة بشرية/);
  assert.match(html, /استنفدت محاولات المصالحة الآلية/);
  assert.match(html, /<select name="nextStatus" disabled>/);
  assert.doesNotMatch(html, /retry-critical-action-button|إعادة إرسال الأمر الأصلي/);
  await assert.rejects(() => controller.transition('ROAD_CLEARANCE', 'مراجعة بشرية'), /مراجعة بشرية/);
  await assert.rejects(() => controller.authorizeClosure('مراجعة بشرية'), /مراجعة بشرية/);
  assert.deepEqual(paths.filter((path) => path.startsWith('POST')), []);
});

test('authenticated exhaustion refresh discards a prior ambiguous critical operation without replay', async () => {
  let incident: RoadEventResponse = {
    id: '48484848-4848-4848-8848-484848484848',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-27T06:00:00.000Z', version: 14, closureAuthorization: null,
    reconciliation: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      mutationRequests += 1;
      throw new TypeError('connection reset after send');
    }
    if (target.pathname.endsWith('/timeline')) return ok([]);
    if (target.pathname === `/api/v1/road-events/${incident.id}`) return ok(incident);
    return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-27T06:01:00.000Z')
  );

  await controller.load();
  await controller.select(incident.id);
  await assert.rejects(
    () => controller.authorizeClosure('الأمر الأصلي الحرج'),
    /تعذر التحقق من نتيجة الإجراء/
  );
  assert.equal(controller.ambiguousCriticalActionView()?.status, 'REFRESH_REQUIRED');
  assert.equal(mutationRequests, 1);

  incident = { ...incident, reconciliation: {
    state: 'HUMAN_REVIEW_REQUIRED', automaticRetryAuthorized: false, closureAuthorized: false
  } };
  await controller.select(incident.id);
  const html = renderDashboard(controller.state, {
    canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(),
    now: new Date('2026-09-27T06:01:00.000Z')
  });

  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  assert.doesNotMatch(html, /إجراء حرج بنتيجة غير مؤكدة|الأمر الأصلي الحرج|retry-critical-action-button|verify-critical-action-button/);
  assert.match(html, /استنفدت محاولات المصالحة الآلية/);
  await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);
  assert.equal(mutationRequests, 1);
});

test('coalesced recovery stays fail-closed on repeated untrusted detail and later trusted retry recovers without replay', async () => {
  const incident: RoadEventResponse = {
    id: '50505050-5050-4050-8050-505050505050',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-27T06:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const secretReason = 'سبب الأمر الحرج السري';
  let malformedDetail = false;
  let recoveryBarrier: ReturnType<typeof barrier> | null = null;
  let recoveryStarted: ReturnType<typeof barrier> | null = null;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      mutationRequests += 1;
      throw new TypeError('connection reset after send');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname === `/api/v1/road-events/${incident.id}`) {
      detailReads += 1;
      if (recoveryBarrier !== null) {
        recoveryStarted?.release();
        await recoveryBarrier.wait;
      }
      if (!malformedDetail) return ok(incident);
      return new Response(JSON.stringify({
        success: true,
        data: { ...incident, internalSecret: 'must-not-leak' },
        error: null,
        traceId: 'trace-untrusted-reconciliation'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-27T06:01:00.000Z')
  );

  await controller.load();
  await controller.select(incident.id);
  await assert.rejects(() => controller.authorizeClosure(secretReason), /تعذر التحقق من نتيجة الإجراء/);
  assert.equal(controller.ambiguousCriticalActionView()?.status, 'REFRESH_REQUIRED');

  malformedDetail = true;
  const failed = await controller.select(incident.id);
  const html = renderDashboard(failed, {
    canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(),
    now: new Date('2026-09-27T06:01:00.000Z')
  });

  assert.equal(failed.phase, 'failure');
  assert.equal(failed.stale, true);
  assert.equal(failed.selected, null);
  assert.deepEqual(failed.timeline, []);
  assert.match(failed.error ?? '', /تعذر التحقق من حالة المصالحة/);
  assert.doesNotMatch(failed.error ?? '', /internalSecret|must-not-leak/);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.doesNotMatch(html, /إجراء حرج بنتيجة غير مؤكدة|تفويض الإغلاق|سبب الأمر الحرج السري/);
  await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(detailReads, 2);
  assert.equal(timelineReads, 2);

  recoveryBarrier = barrier();
  recoveryStarted = barrier();
  const firstRejectedRecovery = controller.retrySelection();
  const duplicateRejectedRecovery = controller.retrySelection();
  assert.equal(firstRejectedRecovery, duplicateRejectedRecovery);
  await recoveryStarted.wait;
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);
  recoveryBarrier.release();
  const [rejectedRecovery, duplicateRejectedResult] = await Promise.all([
    firstRejectedRecovery, duplicateRejectedRecovery
  ]);
  assert.equal(duplicateRejectedResult, rejectedRecovery);
  assert.equal(rejectedRecovery.phase, 'failure');
  assert.equal(rejectedRecovery.stale, true);
  assert.equal(rejectedRecovery.selected, null);
  assert.deepEqual(rejectedRecovery.timeline, []);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(controller.canRetrySelection(), true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);
  assert.equal(mutationRequests, 1);

  malformedDetail = false;
  recoveryBarrier = barrier();
  recoveryStarted = barrier();
  const firstRecovery = controller.retrySelection();
  const duplicateRecovery = controller.retrySelection();
  assert.equal(firstRecovery, duplicateRecovery);
  await recoveryStarted.wait;
  assert.equal(detailReads, 4);
  assert.equal(timelineReads, 4);
  recoveryBarrier.release();
  const [recovered, duplicateResult] = await Promise.all([firstRecovery, duplicateRecovery]);
  assert.equal(duplicateResult, recovered);
  assert.equal(recovered.phase, 'ready');
  assert.equal(recovered.stale, false);
  assert.equal(recovered.selected?.id, incident.id);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(controller.canRetrySelection(), false);
  await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);
  assert.equal(detailReads, 4);
  assert.equal(timelineReads, 4);
  assert.equal(mutationRequests, 1);
});

test('session discard invalidates late coalesced recovery success or rejection without restoring command authority', async () => {
  for (const lateOutcome of ['TRUSTED_SUCCESS', 'UNTRUSTED_RESPONSE'] as const) {
    const incident: RoadEventResponse = {
      id: lateOutcome === 'TRUSTED_SUCCESS'
        ? '51515151-5151-4151-8151-515151515151'
        : '52525252-5252-4252-8252-525252525252',
      status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
      occurredAt: '2026-09-28T00:00:00.000Z', version: 14, closureAuthorization: null,
      severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
    };
    let detailMode: 'TRUSTED' | 'UNTRUSTED' = 'TRUSTED';
    let recoveryBarrier: ReturnType<typeof barrier> | null = null;
    let recoveryStarted: ReturnType<typeof barrier> | null = null;
    let listReads = 0;
    let detailReads = 0;
    let timelineReads = 0;
    let mutationRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      assertTrustedRequest(init);
      const target = new URL(String(input), 'https://dashboard.example.test');
      if (target.pathname.endsWith('/closure-authorization')) {
        mutationRequests += 1;
        throw new TypeError('connection reset after send');
      }
      if (target.pathname.endsWith('/timeline')) {
        timelineReads += 1;
        return ok([]);
      }
      if (target.pathname === `/api/v1/road-events/${incident.id}`) {
        detailReads += 1;
        if (recoveryBarrier !== null) {
          recoveryStarted?.release();
          await recoveryBarrier.wait;
        }
        if (detailMode === 'TRUSTED') return ok(incident);
        return new Response(JSON.stringify({
          success: true,
          data: { ...incident, internalSecret: 'must-not-leak-after-session-discard' },
          error: null,
          traceId: 'trace-late-untrusted-recovery'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      listReads += 1;
      return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
    };
    const controller = new OperationsDashboardController(
      new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
      () => new Date('2026-09-28T00:01:00.000Z')
    );

    await controller.load();
    await controller.select(incident.id);
    await assert.rejects(() => controller.authorizeClosure('أمر يجب إبطاله عند إلغاء الجلسة'),
      /تعذر التحقق من نتيجة الإجراء/);
    assert.equal(controller.ambiguousCriticalActionView()?.status, 'REFRESH_REQUIRED');

    detailMode = 'UNTRUSTED';
    const rejected = await controller.select(incident.id);
    assert.equal(rejected.phase, 'failure');
    assert.equal(rejected.stale, true);
    assert.equal(controller.ambiguousCriticalActionView(), null);

    detailMode = lateOutcome === 'TRUSTED_SUCCESS' ? 'TRUSTED' : 'UNTRUSTED';
    recoveryBarrier = barrier();
    recoveryStarted = barrier();
    const recovery = controller.retrySelection();
    const duplicateRecovery = controller.retrySelection();
    assert.equal(duplicateRecovery, recovery);
    await recoveryStarted.wait;
    assert.equal(detailReads, 3);
    assert.equal(timelineReads, 3);

    controller.discardBrowserSession();
    const restored = await controller.load();
    assert.equal(restored.phase, 'ready');
    assert.equal(restored.selected, null);
    assert.deepEqual(restored.timeline, []);
    assert.equal(restored.stale, false);
    assert.equal(restored.error, null);
    recoveryBarrier.release();
    const [lateResult, duplicateLateResult] = await Promise.all([recovery, duplicateRecovery]);

    assert.equal(duplicateLateResult, lateResult);
    assert.equal(controller.state.phase, 'ready');
    assert.equal(controller.state.selected, null);
    assert.deepEqual(controller.state.timeline, []);
    assert.equal(controller.state.stale, false);
    assert.equal(controller.state.error, null);
    assert.equal(controller.ambiguousCriticalActionView(), null);
    assert.equal(controller.canRetrySelection(), false);
    assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
    assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);
    await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);
    assert.equal(listReads, 2);
    assert.equal(detailReads, 3);
    assert.equal(timelineReads, 3);
    assert.equal(mutationRequests, 1);
  }
});

test('new-session retry cannot coalesce onto an obsolete recovery promise from a discarded session', async () => {
  const incident: RoadEventResponse = {
    id: '53535353-5353-4353-8353-535353535353',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-28T00:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const oldRecoveryBarrier = barrier();
  const oldRecoveryStarted = barrier();
  const newRecoveryBarrier = barrier();
  const newRecoveryStarted = barrier();
  let detailMode: 'TRUSTED' | 'UNTRUSTED' = 'TRUSTED';
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname === `/api/v1/road-events/${incident.id}`) {
      const readNumber = ++detailReads;
      if (readNumber === 3) {
        oldRecoveryStarted.release();
        await oldRecoveryBarrier.wait;
      }
      if (readNumber === 5) {
        newRecoveryStarted.release();
        await newRecoveryBarrier.wait;
      }
      if (detailMode === 'TRUSTED') return ok(incident);
      return new Response(JSON.stringify({
        success: true,
        data: { ...incident, internalSecret: 'must-not-cross-session-boundary' },
        error: null,
        traceId: 'trace-new-session-retry'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T00:01:00.000Z')
  );

  await controller.load();
  await controller.select(incident.id);
  detailMode = 'UNTRUSTED';
  await controller.select(incident.id);
  assert.equal(controller.canRetrySelection(), true);

  detailMode = 'TRUSTED';
  const obsoleteRecovery = controller.retrySelection();
  await oldRecoveryStarted.wait;
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);

  controller.discardBrowserSession();
  await controller.load();
  detailMode = 'UNTRUSTED';
  const newFailure = await controller.select(incident.id);
  assert.equal(newFailure.phase, 'failure');
  assert.equal(newFailure.stale, true);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(detailReads, 4);
  assert.equal(timelineReads, 4);

  detailMode = 'TRUSTED';
  const currentRecovery = controller.retrySelection();
  assert.notEqual(currentRecovery, obsoleteRecovery);
  await newRecoveryStarted.wait;
  assert.equal(detailReads, 5);
  assert.equal(timelineReads, 5);

  oldRecoveryBarrier.release();
  const obsoleteResult = await obsoleteRecovery;
  assert.equal(obsoleteResult.phase, 'failure');
  assert.equal(obsoleteResult.selected, null);
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.retrySelection(), currentRecovery);

  newRecoveryBarrier.release();
  const recovered = await currentRecovery;
  assert.equal(recovered.phase, 'ready');
  assert.equal(recovered.selected?.id, incident.id);
  assert.equal(recovered.stale, false);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(mutationRequests, 0);
});

test('newer incident failure cannot coalesce onto an older incident recovery in the same session', async () => {
  const olderIncident: RoadEventResponse = {
    id: '54545454-5454-4454-8454-545454545454',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-28T00:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const newerIncident: RoadEventResponse = {
    ...olderIncident,
    id: '55555555-5555-4555-8555-555555555555',
    occurredAt: '2026-09-28T00:01:00.000Z'
  };
  const olderRecoveryBarrier = barrier();
  const olderRecoveryStarted = barrier();
  const newerRecoveryBarrier = barrier();
  const newerRecoveryStarted = barrier();
  const detailModes = new Map<string, 'TRUSTED' | 'UNTRUSTED'>([
    [olderIncident.id, 'TRUSTED'],
    [newerIncident.id, 'TRUSTED']
  ]);
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    const incident = [olderIncident, newerIncident].find(
      ({ id }) => target.pathname === `/api/v1/road-events/${id}`
    );
    if (incident !== undefined) {
      detailReads += 1;
      if (incident.id === olderIncident.id && detailReads === 3) {
        olderRecoveryStarted.release();
        await olderRecoveryBarrier.wait;
      }
      if (incident.id === newerIncident.id && detailReads === 5) {
        newerRecoveryStarted.release();
        await newerRecoveryBarrier.wait;
      }
      if (detailModes.get(incident.id) === 'TRUSTED') return ok(incident);
      return new Response(JSON.stringify({
        success: true,
        data: { ...incident, internalSecret: 'must-not-cross-incident-boundary' },
        error: null,
        traceId: 'trace-same-session-retry'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return ok({ items: [olderIncident, newerIncident], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T00:02:00.000Z')
  );

  await controller.load();
  await controller.select(olderIncident.id);
  detailModes.set(olderIncident.id, 'UNTRUSTED');
  await controller.select(olderIncident.id);
  assert.equal(controller.canRetrySelection(), true);

  detailModes.set(olderIncident.id, 'TRUSTED');
  const obsoleteRecovery = controller.retrySelection();
  await olderRecoveryStarted.wait;

  detailModes.set(newerIncident.id, 'UNTRUSTED');
  const newerFailure = await controller.select(newerIncident.id);
  assert.equal(newerFailure.phase, 'failure');
  assert.equal(newerFailure.selected, null);
  assert.equal(newerFailure.stale, true);
  assert.equal(controller.canRetrySelection(), true);

  detailModes.set(newerIncident.id, 'TRUSTED');
  const currentRecovery = controller.retrySelection();
  assert.notEqual(currentRecovery, obsoleteRecovery);
  await newerRecoveryStarted.wait;
  assert.equal(detailReads, 5);
  assert.equal(timelineReads, 5);

  olderRecoveryBarrier.release();
  const obsoleteResult = await obsoleteRecovery;
  assert.equal(obsoleteResult.phase, 'failure');
  assert.equal(obsoleteResult.selected, null);
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.retrySelection(), currentRecovery);

  newerRecoveryBarrier.release();
  const recovered = await currentRecovery;
  assert.equal(recovered.phase, 'ready');
  assert.equal(recovered.selected?.id, newerIncident.id);
  assert.equal(recovered.stale, false);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(mutationRequests, 0);
});

test('authenticated queue reload invalidates pending incident recovery before a later selection', async () => {
  const olderIncident: RoadEventResponse = {
    id: '56565656-5656-4656-8656-565656565656',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-28T00:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const newerIncident: RoadEventResponse = {
    ...olderIncident,
    id: '57575757-5757-4757-8757-575757575757',
    occurredAt: '2026-09-28T00:01:00.000Z'
  };
  const olderRecoveryBarrier = barrier();
  const olderRecoveryStarted = barrier();
  const newerRecoveryBarrier = barrier();
  const newerRecoveryStarted = barrier();
  const detailModes = new Map<string, 'TRUSTED' | 'UNTRUSTED'>([
    [olderIncident.id, 'TRUSTED'],
    [newerIncident.id, 'TRUSTED']
  ]);
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    const incident = [olderIncident, newerIncident].find(
      ({ id }) => target.pathname === `/api/v1/road-events/${id}`
    );
    if (incident !== undefined) {
      detailReads += 1;
      if (incident.id === olderIncident.id && detailReads === 3) {
        olderRecoveryStarted.release();
        await olderRecoveryBarrier.wait;
      }
      if (incident.id === newerIncident.id && detailReads === 5) {
        newerRecoveryStarted.release();
        await newerRecoveryBarrier.wait;
      }
      if (detailModes.get(incident.id) === 'TRUSTED') return ok(incident);
      return new Response(JSON.stringify({
        success: true,
        data: { ...incident, internalSecret: 'must-not-survive-queue-reload' },
        error: null,
        traceId: 'trace-queue-reload-retry'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    listReads += 1;
    return ok({ items: [olderIncident, newerIncident], total: 2, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T00:02:00.000Z')
  );

  await controller.load();
  await controller.select(olderIncident.id);
  detailModes.set(olderIncident.id, 'UNTRUSTED');
  await controller.select(olderIncident.id);
  detailModes.set(olderIncident.id, 'TRUSTED');
  const obsoleteRecovery = controller.retrySelection();
  await olderRecoveryStarted.wait;

  const reloaded = await controller.load();
  assert.equal(reloaded.phase, 'ready');
  assert.equal(reloaded.selected, null);
  assert.deepEqual(reloaded.timeline, []);
  assert.equal(controller.canRetrySelection(), false);
  assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);

  detailModes.set(newerIncident.id, 'UNTRUSTED');
  const newerFailure = await controller.select(newerIncident.id);
  assert.equal(newerFailure.phase, 'failure');
  assert.equal(newerFailure.stale, true);
  detailModes.set(newerIncident.id, 'TRUSTED');
  const currentRecovery = controller.retrySelection();
  assert.notEqual(currentRecovery, obsoleteRecovery);
  await newerRecoveryStarted.wait;

  olderRecoveryBarrier.release();
  const obsoleteResult = await obsoleteRecovery;
  assert.equal(obsoleteResult.phase, 'failure');
  assert.equal(obsoleteResult.selected, null);
  assert.equal(controller.retrySelection(), currentRecovery);

  newerRecoveryBarrier.release();
  const recovered = await currentRecovery;
  assert.equal(recovered.phase, 'ready');
  assert.equal(recovered.selected?.id, newerIncident.id);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(listReads, 2);
  assert.equal(detailReads, 5);
  assert.equal(timelineReads, 5);
  assert.equal(mutationRequests, 0);
});

test('failed authenticated queue reload invalidates pending recovery and exposes only sanitized queue failure', async () => {
  const incident: RoadEventResponse = {
    id: '58585858-5858-4858-8858-585858585858',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-09-28T07:00:00.000Z', version: 14, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const recoveryBarrier = barrier();
  const recoveryStarted = barrier();
  const queueRecoveryBarrier = barrier();
  const queueRecoveryStarted = barrier();
  let detailMode: 'TRUSTED' | 'UNTRUSTED' = 'TRUSTED';
  let listMode: 'TRUSTED' | 'FAILURE' = 'TRUSTED';
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname === `/api/v1/road-events/${incident.id}`) {
      detailReads += 1;
      if (detailReads === 3) {
        recoveryStarted.release();
        await recoveryBarrier.wait;
      }
      if (detailMode === 'TRUSTED') return ok(incident);
      return new Response(JSON.stringify({
        success: true,
        data: { ...incident, internalSecret: 'must-not-survive-failed-queue-reload' },
        error: null,
        traceId: 'trace-failed-queue-reload-detail'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    listReads += 1;
    if (listMode === 'TRUSTED') {
      if (listReads === 3) {
        queueRecoveryStarted.release();
        await queueRecoveryBarrier.wait;
      }
      return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
    }
    return new Response(JSON.stringify({
      success: false,
      data: null,
      error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@internal-db' },
      traceId: 'trace-failed-queue-reload'
    }), { status: 503, headers: { 'content-type': 'application/json' } });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T07:01:00.000Z')
  );

  await controller.load();
  await controller.select(incident.id);
  detailMode = 'UNTRUSTED';
  await controller.select(incident.id);
  detailMode = 'TRUSTED';
  const obsoleteRecovery = controller.retrySelection();
  await recoveryStarted.wait;

  listMode = 'FAILURE';
  const failedReload = await controller.load();
  assert.equal(failedReload.phase, 'failure');
  assert.equal(failedReload.selected, null);
  assert.deepEqual(failedReload.timeline, []);
  assert.equal(failedReload.stale, true);
  assert.equal(failedReload.error, 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.');
  assert.doesNotMatch(failedReload.error ?? '', /postgres|admin|secret|internal-db/i);
  assert.equal(controller.canRetrySelection(), false);
  assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);

  recoveryBarrier.release();
  const obsoleteResult = await obsoleteRecovery;
  assert.equal(obsoleteResult, controller.state);
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(controller.canRetrySelection(), false);
  assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);
  assert.equal(listReads, 2);
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);
  assert.equal(mutationRequests, 0);

  listMode = 'TRUSTED';
  const firstQueueRecovery = controller.load();
  await queueRecoveryStarted.wait;
  const repeatedQueueRecovery = controller.load();
  assert.equal(repeatedQueueRecovery, firstQueueRecovery);
  assert.equal(listReads, 3);
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);
  assert.equal(mutationRequests, 0);
  queueRecoveryBarrier.release();
  const [recoveredQueue, repeatedQueue] = await Promise.all([firstQueueRecovery, repeatedQueueRecovery]);
  assert.equal(repeatedQueue, recoveredQueue);
  assert.equal(recoveredQueue.phase, 'ready');
  assert.deepEqual(recoveredQueue.events.map(({ id }) => id), [incident.id]);
  assert.equal(recoveredQueue.selected, null);
  assert.deepEqual(recoveredQueue.timeline, []);
  assert.equal(recoveredQueue.stale, false);
  assert.equal(recoveredQueue.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.throws(() => controller.retrySelection(), /لا توجد محاولة تحميل فاشلة/);
  assert.equal(listReads, 3);
  assert.equal(detailReads, 3);
  assert.equal(timelineReads, 3);
  assert.equal(mutationRequests, 0);
});

test('newer authenticated selection supersedes a coalesced queue recovery and survives its late completion', async () => {
  const incident: RoadEventResponse = {
    id: '59595959-5959-4959-8959-595959595959',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-28T21:00:00.000Z', version: 15, closureAuthorization: null,
    severity: { level: 'S4', score: 97, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const queueBarrier = barrier();
  const queueStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname === `/api/v1/road-events/${incident.id}`) {
      detailReads += 1;
      return ok(incident);
    }
    listReads += 1;
    if (listReads === 2) {
      queueStarted.release();
      await queueBarrier.wait;
    }
    return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T21:01:00.000Z')
  );

  await controller.load();
  const firstQueueRecovery = controller.load();
  await queueStarted.wait;
  const repeatedQueueRecovery = controller.load();
  assert.equal(repeatedQueueRecovery, firstQueueRecovery);
  assert.equal(listReads, 2);

  const selected = await controller.select(incident.id);
  assert.equal(selected.phase, 'ready');
  assert.equal(selected.selected?.id, incident.id);
  assert.deepEqual(selected.timeline, []);
  assert.equal(selected.stale, false);
  assert.equal(selected.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);

  queueBarrier.release();
  const [obsoleteQueue, repeatedObsoleteQueue] = await Promise.all([firstQueueRecovery, repeatedQueueRecovery]);
  assert.equal(obsoleteQueue, controller.state);
  assert.equal(repeatedObsoleteQueue, controller.state);
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.selected?.id, incident.id);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 2);
  assert.equal(detailReads, 1);
  assert.equal(timelineReads, 1);
  assert.equal(mutationRequests, 0);
});

test('browser-session discard supersedes coalesced queue recovery without leaking into restored ownership', async () => {
  const obsoleteIncident: RoadEventResponse = {
    id: '60606060-6060-4060-8060-606060606060',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-28T22:00:00.000Z', version: 15, closureAuthorization: null,
    severity: { level: 'S4', score: 97, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const restoredIncident: RoadEventResponse = {
    ...obsoleteIncident,
    id: '61616161-6161-4161-8161-616161616161',
    version: 4,
    severity: { level: 'S2', score: 51, confidence: 0.91, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const obsoleteQueueBarrier = barrier();
  const obsoleteQueueStarted = barrier();
  const restoredQueueBarrier = barrier();
  const restoredQueueStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 2) {
      obsoleteQueueStarted.release();
      await obsoleteQueueBarrier.wait;
    }
    if (request === 3) {
      restoredQueueStarted.release();
      await restoredQueueBarrier.wait;
    }
    return ok({
      items: [request === 3 ? restoredIncident : obsoleteIncident],
      total: 1, limit: 100, offset: 0
    });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T22:01:00.000Z')
  );

  await controller.load();
  const obsoleteQueue = controller.load();
  await obsoleteQueueStarted.wait;
  const repeatedObsoleteQueue = controller.load();
  assert.equal(repeatedObsoleteQueue, obsoleteQueue);
  assert.equal(listReads, 2);

  const discarded = controller.discardBrowserSession();
  assert.equal(discarded.phase, 'loading');
  assert.deepEqual(discarded.events, []);
  assert.equal(discarded.selected, null);
  assert.deepEqual(discarded.timeline, []);
  assert.equal(discarded.stale, false);
  assert.equal(discarded.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);

  const restoredQueue = controller.load();
  await restoredQueueStarted.wait;
  assert.notEqual(restoredQueue, obsoleteQueue);
  assert.equal(listReads, 3);

  obsoleteQueueBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([obsoleteQueue, repeatedObsoleteQueue]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state.phase, 'loading');
  assert.deepEqual(controller.state.events, []);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  const repeatedRestoredQueue = controller.load();
  assert.equal(repeatedRestoredQueue, restoredQueue);
  assert.equal(listReads, 3);

  restoredQueueBarrier.release();
  const [restoredResult, repeatedRestoredResult] = await Promise.all([restoredQueue, repeatedRestoredQueue]);
  assert.equal(repeatedRestoredResult, restoredResult);
  assert.equal(restoredResult.phase, 'ready');
  assert.deepEqual(restoredResult.events.map(({ id }) => id), [restoredIncident.id]);
  assert.equal(restoredResult.selected, null);
  assert.deepEqual(restoredResult.timeline, []);
  assert.equal(restoredResult.stale, false);
  assert.equal(restoredResult.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 3);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('late pre-discard queue failure cannot stale or expose error in the restored session', async () => {
  const obsoleteIncident: RoadEventResponse = {
    id: '62626262-6262-4262-8262-626262626262',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-28T23:00:00.000Z', version: 16, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const restoredIncident: RoadEventResponse = {
    ...obsoleteIncident,
    id: '63636363-6363-4363-8363-636363636363',
    version: 5,
    severity: { level: 'S2', score: 49, confidence: 0.92, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const obsoleteQueueBarrier = barrier();
  const obsoleteQueueStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 2) {
      obsoleteQueueStarted.release();
      await obsoleteQueueBarrier.wait;
      return new Response(JSON.stringify({
        success: false,
        data: null,
        error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@obsolete-session-db' },
        traceId: 'trace-obsolete-session-queue'
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return ok({
      items: [request === 3 ? restoredIncident : obsoleteIncident],
      total: 1, limit: 100, offset: 0
    });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-28T23:01:00.000Z')
  );

  await controller.load();
  const obsoleteQueue = controller.load();
  await obsoleteQueueStarted.wait;
  const repeatedObsoleteQueue = controller.load();
  assert.equal(repeatedObsoleteQueue, obsoleteQueue);
  assert.equal(listReads, 2);

  controller.discardBrowserSession();
  const restored = await controller.load();
  assert.equal(restored.phase, 'ready');
  assert.deepEqual(restored.events.map(({ id }) => id), [restoredIncident.id]);
  assert.equal(restored.selected, null);
  assert.deepEqual(restored.timeline, []);
  assert.equal(restored.stale, false);
  assert.equal(restored.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 3);

  obsoleteQueueBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([obsoleteQueue, repeatedObsoleteQueue]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state.phase, 'ready');
  assert.deepEqual(controller.state.events.map(({ id }) => id), [restoredIncident.id]);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  assert.doesNotMatch(JSON.stringify(controller.state), /postgres|admin|secret|obsolete-session-db/i);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 3);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('repeated browser-session discard permits only the latest queue generation to publish', async () => {
  const initialIncident: RoadEventResponse = {
    id: '64646464-6464-4464-8464-646464646464',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-29T00:00:00.000Z', version: 17, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const firstRestorationIncident: RoadEventResponse = {
    ...initialIncident,
    id: '65656565-6565-4565-8565-656565656565', version: 6
  };
  const latestIncident: RoadEventResponse = {
    ...initialIncident,
    id: '66666666-6666-4666-8666-666666666666', version: 2,
    severity: { level: 'S2', score: 47, confidence: 0.93, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const obsoleteBarrier = barrier();
  const obsoleteStarted = barrier();
  const firstRestorationBarrier = barrier();
  const firstRestorationStarted = barrier();
  const latestBarrier = barrier();
  const latestStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 2) {
      obsoleteStarted.release();
      await obsoleteBarrier.wait;
    }
    if (request === 3) {
      firstRestorationStarted.release();
      await firstRestorationBarrier.wait;
    }
    if (request === 4) {
      latestStarted.release();
      await latestBarrier.wait;
    }
    const incident = request === 4
      ? latestIncident
      : request === 3 ? firstRestorationIncident : initialIncident;
    return ok({ items: [incident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-29T00:01:00.000Z')
  );

  await controller.load();
  const obsoleteQueue = controller.load();
  await obsoleteStarted.wait;
  const repeatedObsoleteQueue = controller.load();
  assert.equal(repeatedObsoleteQueue, obsoleteQueue);

  controller.discardBrowserSession();
  const firstRestoration = controller.load();
  await firstRestorationStarted.wait;
  const repeatedFirstRestoration = controller.load();
  assert.equal(repeatedFirstRestoration, firstRestoration);

  controller.discardBrowserSession();
  const latestRestoration = controller.load();
  await latestStarted.wait;
  assert.notEqual(latestRestoration, firstRestoration);
  assert.notEqual(latestRestoration, obsoleteQueue);
  assert.equal(listReads, 4);

  firstRestorationBarrier.release();
  const [firstResult, repeatedFirstResult] = await Promise.all([firstRestoration, repeatedFirstRestoration]);
  assert.equal(firstResult, controller.state);
  assert.equal(repeatedFirstResult, controller.state);
  assert.equal(controller.state.phase, 'loading');
  assert.deepEqual(controller.state.events, []);

  obsoleteBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([obsoleteQueue, repeatedObsoleteQueue]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state.phase, 'loading');
  assert.deepEqual(controller.state.events, []);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  const repeatedLatestRestoration = controller.load();
  assert.equal(repeatedLatestRestoration, latestRestoration);
  assert.equal(listReads, 4);

  latestBarrier.release();
  const [latestResult, repeatedLatestResult] = await Promise.all([latestRestoration, repeatedLatestRestoration]);
  assert.equal(repeatedLatestResult, latestResult);
  assert.equal(latestResult.phase, 'ready');
  assert.deepEqual(latestResult.events.map(({ id }) => id), [latestIncident.id]);
  assert.equal(latestResult.selected, null);
  assert.deepEqual(latestResult.timeline, []);
  assert.equal(latestResult.stale, false);
  assert.equal(latestResult.error, null);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 4);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('latest queue failure after repeated discard recovers through a new isolated generation', async () => {
  const initialIncident: RoadEventResponse = {
    id: '67676767-6767-4767-8767-676767676767',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-29T01:00:00.000Z', version: 18, closureAuthorization: null,
    severity: { level: 'S4', score: 99, confidence: 0.98, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const obsoleteIncident: RoadEventResponse = {
    ...initialIncident,
    id: '68686868-6868-4868-8868-686868686868', version: 7
  };
  const firstRestorationIncident: RoadEventResponse = {
    ...initialIncident,
    id: '69696969-6969-4969-8969-696969696969', version: 3
  };
  const recoveredIncident: RoadEventResponse = {
    ...initialIncident,
    id: '70707070-7070-4070-8070-707070707070', version: 1,
    severity: { level: 'S2', score: 45, confidence: 0.94, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const obsoleteBarrier = barrier();
  const obsoleteStarted = barrier();
  const firstRestorationBarrier = barrier();
  const firstRestorationStarted = barrier();
  const latestBarrier = barrier();
  const latestStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 2) {
      obsoleteStarted.release();
      await obsoleteBarrier.wait;
      return ok({ items: [obsoleteIncident], total: 1, limit: 100, offset: 0 });
    }
    if (request === 3) {
      firstRestorationStarted.release();
      await firstRestorationBarrier.wait;
      return ok({ items: [firstRestorationIncident], total: 1, limit: 100, offset: 0 });
    }
    if (request === 4) {
      latestStarted.release();
      await latestBarrier.wait;
      return new Response(JSON.stringify({
        success: false,
        data: null,
        error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@latest-session-db' },
        traceId: 'trace-latest-session-queue'
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return ok({ items: [request === 5 ? recoveredIncident : initialIncident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-29T01:01:00.000Z')
  );

  await controller.load();
  const obsoleteQueue = controller.load();
  await obsoleteStarted.wait;
  const repeatedObsoleteQueue = controller.load();
  assert.equal(repeatedObsoleteQueue, obsoleteQueue);

  controller.discardBrowserSession();
  const firstRestoration = controller.load();
  await firstRestorationStarted.wait;
  const repeatedFirstRestoration = controller.load();
  assert.equal(repeatedFirstRestoration, firstRestoration);

  controller.discardBrowserSession();
  const latestRestoration = controller.load();
  await latestStarted.wait;
  const repeatedLatestRestoration = controller.load();
  assert.equal(repeatedLatestRestoration, latestRestoration);
  assert.equal(listReads, 4);

  firstRestorationBarrier.release();
  const [firstResult, repeatedFirstResult] = await Promise.all([firstRestoration, repeatedFirstRestoration]);
  assert.equal(firstResult, controller.state);
  assert.equal(repeatedFirstResult, controller.state);
  assert.equal(controller.state.phase, 'loading');
  assert.deepEqual(controller.state.events, []);

  latestBarrier.release();
  const [latestResult, repeatedLatestResult] = await Promise.all([latestRestoration, repeatedLatestRestoration]);
  assert.equal(repeatedLatestResult, latestResult);
  assert.equal(latestResult.phase, 'failure');
  assert.deepEqual(latestResult.events, []);
  assert.equal(latestResult.selected, null);
  assert.deepEqual(latestResult.timeline, []);
  assert.equal(latestResult.stale, true);
  assert.equal(latestResult.error, 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.');
  assert.doesNotMatch(JSON.stringify(latestResult), /postgres|admin|secret|latest-session-db/i);

  const retry = controller.load();
  const repeatedRetry = controller.load();
  assert.equal(repeatedRetry, retry);
  assert.notEqual(retry, latestRestoration);
  assert.notEqual(retry, firstRestoration);
  assert.notEqual(retry, obsoleteQueue);
  const [recovered, repeatedRecovered] = await Promise.all([retry, repeatedRetry]);
  assert.equal(repeatedRecovered, recovered);
  assert.equal(recovered.phase, 'ready');
  assert.deepEqual(recovered.events.map(({ id }) => id), [recoveredIncident.id]);
  assert.equal(recovered.selected, null);
  assert.deepEqual(recovered.timeline, []);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.error, null);
  assert.equal(listReads, 5);

  obsoleteBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([obsoleteQueue, repeatedObsoleteQueue]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state, recovered);
  assert.equal(controller.state.phase, 'ready');
  assert.deepEqual(controller.state.events.map(({ id }) => id), [recoveredIncident.id]);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  assert.doesNotMatch(
    JSON.stringify(controller.state),
    /postgres|admin|secret|latest-session-db|67676767|68686868|69696969/i
  );
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 5);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('session discard invalidates a pending post-failure queue retry', async () => {
  const obsoleteRetryIncident: RoadEventResponse = {
    id: '71717171-7171-4171-8171-717171717171',
    status: 'RECOVERY', latitude: 24.73, longitude: 46.69,
    occurredAt: '2026-09-29T02:00:00.000Z', version: 4, closureAuthorization: null,
    severity: { level: 'S4', score: 97, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const restoredIncident: RoadEventResponse = {
    ...obsoleteRetryIncident,
    id: '72727272-7272-4272-8272-727272727272', version: 1,
    severity: { level: 'S2', score: 43, confidence: 0.93, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const retryBarrier = barrier();
  const retryStarted = barrier();
  const restorationBarrier = barrier();
  const restorationStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 1) {
      return new Response(JSON.stringify({
        success: false,
        data: null,
        error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@failed-session-db' },
        traceId: 'trace-post-failure-retry'
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (request === 2) {
      retryStarted.release();
      await retryBarrier.wait;
      return ok({ items: [obsoleteRetryIncident], total: 1, limit: 100, offset: 0 });
    }
    restorationStarted.release();
    await restorationBarrier.wait;
    return ok({ items: [restoredIncident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-29T02:01:00.000Z')
  );

  const failed = await controller.load();
  assert.equal(failed.phase, 'failure');
  assert.deepEqual(failed.events, []);
  assert.equal(failed.stale, true);
  assert.equal(failed.error, 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.');
  assert.doesNotMatch(JSON.stringify(failed), /postgres|admin|secret|failed-session-db/i);

  const retry = controller.load();
  await retryStarted.wait;
  const repeatedRetry = controller.load();
  assert.equal(repeatedRetry, retry);

  const discarded = controller.discardBrowserSession();
  assert.equal(discarded.phase, 'loading');
  assert.deepEqual(discarded.events, []);
  assert.equal(discarded.selected, null);
  assert.deepEqual(discarded.timeline, []);
  assert.equal(discarded.stale, false);
  assert.equal(discarded.error, null);

  const restoration = controller.load();
  await restorationStarted.wait;
  const repeatedRestoration = controller.load();
  assert.equal(repeatedRestoration, restoration);
  assert.notEqual(restoration, retry);
  assert.equal(listReads, 3);

  retryBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([retry, repeatedRetry]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state.phase, 'loading');
  assert.deepEqual(controller.state.events, []);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.error, null);
  assert.equal(controller.load(), restoration);
  assert.equal(listReads, 3);

  restorationBarrier.release();
  const [restored, repeatedRestored] = await Promise.all([restoration, repeatedRestoration]);
  assert.equal(repeatedRestored, restored);
  assert.equal(restored.phase, 'ready');
  assert.deepEqual(restored.events.map(({ id }) => id), [restoredIncident.id]);
  assert.equal(restored.selected, null);
  assert.deepEqual(restored.timeline, []);
  assert.equal(restored.stale, false);
  assert.equal(restored.error, null);
  assert.doesNotMatch(JSON.stringify(restored), /postgres|admin|secret|failed-session-db|71717171/i);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 3);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('new-session restoration failure survives obsolete retry and recovers independently', async () => {
  const obsoleteRetryIncident: RoadEventResponse = {
    id: '73737373-7373-4373-8373-737373737373',
    status: 'RECOVERY', latitude: 24.74, longitude: 46.7,
    occurredAt: '2026-09-29T03:00:00.000Z', version: 5, closureAuthorization: null,
    severity: { level: 'S4', score: 98, confidence: 0.97, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const recoveredIncident: RoadEventResponse = {
    ...obsoleteRetryIncident,
    id: '74747474-7474-4474-8474-747474747474', version: 1,
    severity: { level: 'S2', score: 41, confidence: 0.94, reasonCodes: ['lane_obstruction'], requiresHumanReview: true }
  };
  const retryBarrier = barrier();
  const retryStarted = barrier();
  const restorationBarrier = barrier();
  const restorationStarted = barrier();
  const recoveryBarrier = barrier();
  const recoveryStarted = barrier();
  let listReads = 0;
  let detailReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization') || target.pathname.endsWith('/transition')) {
      mutationRequests += 1;
      throw new Error('critical mutation must remain unreachable');
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname.startsWith('/api/v1/road-events/')) {
      detailReads += 1;
      throw new Error('incident detail must remain unreachable');
    }
    const request = ++listReads;
    if (request === 1) {
      return new Response(JSON.stringify({
        success: false,
        data: null,
        error: { code: 'DATABASE_SECRET', message: 'postgres://admin:secret@failed-session-db' },
        traceId: 'trace-pre-discard-failure'
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (request === 2) {
      retryStarted.release();
      await retryBarrier.wait;
      return ok({ items: [obsoleteRetryIncident], total: 1, limit: 100, offset: 0 });
    }
    if (request === 3) {
      restorationStarted.release();
      await restorationBarrier.wait;
      return new Response(JSON.stringify({
        success: false,
        data: null,
        error: { code: 'RESTORATION_SECRET', message: 'postgres://restorer:new-secret@new-session-db' },
        traceId: 'trace-new-session-failure'
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    recoveryStarted.release();
    await recoveryBarrier.wait;
    return ok({ items: [recoveredIncident], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-09-29T03:01:00.000Z')
  );

  const failed = await controller.load();
  assert.equal(failed.phase, 'failure');
  assert.deepEqual(failed.events, []);
  assert.equal(failed.stale, true);
  assert.doesNotMatch(JSON.stringify(failed), /postgres|admin|secret|failed-session-db/i);

  const retry = controller.load();
  await retryStarted.wait;
  const repeatedRetry = controller.load();
  assert.equal(repeatedRetry, retry);

  controller.discardBrowserSession();
  const restoration = controller.load();
  await restorationStarted.wait;
  const repeatedRestoration = controller.load();
  assert.equal(repeatedRestoration, restoration);
  assert.notEqual(restoration, retry);
  assert.equal(listReads, 3);

  restorationBarrier.release();
  const [restorationFailure, repeatedRestorationFailure] = await Promise.all([restoration, repeatedRestoration]);
  assert.equal(repeatedRestorationFailure, restorationFailure);
  assert.equal(restorationFailure.phase, 'failure');
  assert.deepEqual(restorationFailure.events, []);
  assert.equal(restorationFailure.selected, null);
  assert.deepEqual(restorationFailure.timeline, []);
  assert.equal(restorationFailure.stale, true);
  assert.equal(restorationFailure.error, 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.');
  assert.doesNotMatch(
    JSON.stringify(restorationFailure),
    /postgres|admin|restorer|secret|failed-session-db|new-session-db|73737373/i
  );
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);

  retryBarrier.release();
  const [obsoleteResult, repeatedObsoleteResult] = await Promise.all([retry, repeatedRetry]);
  assert.equal(obsoleteResult, controller.state);
  assert.equal(repeatedObsoleteResult, controller.state);
  assert.equal(controller.state, restorationFailure);
  assert.equal(controller.state.phase, 'failure');
  assert.deepEqual(controller.state.events, []);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.state.stale, true);
  assert.equal(controller.state.error, 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.');
  assert.doesNotMatch(
    JSON.stringify(controller.state),
    /postgres|admin|restorer|secret|failed-session-db|new-session-db|73737373/i
  );
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);

  const recovery = controller.load();
  await recoveryStarted.wait;
  const repeatedRecovery = controller.load();
  assert.equal(repeatedRecovery, recovery);
  assert.notEqual(recovery, restoration);
  assert.notEqual(recovery, retry);
  assert.equal(listReads, 4);

  recoveryBarrier.release();
  const [recovered, repeatedRecovered] = await Promise.all([recovery, repeatedRecovery]);
  assert.equal(repeatedRecovered, recovered);
  assert.equal(recovered.phase, 'ready');
  assert.deepEqual(recovered.events.map(({ id }) => id), [recoveredIncident.id]);
  assert.equal(recovered.selected, null);
  assert.deepEqual(recovered.timeline, []);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.error, null);
  assert.doesNotMatch(
    JSON.stringify(recovered),
    /postgres|admin|restorer|secret|failed-session-db|new-session-db|73737373/i
  );
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(listReads, 4);
  assert.equal(detailReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(mutationRequests, 0);
});

test('periodic queue refresh waits for a critical command and performs one authenticated reconciliation', async () => {
  let event: RoadEventResponse = {
    id: '49494949-4949-4949-8949-494949494949',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const mutationStarted = barrier();
  const mutationResponse = barrier();
  let listReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      mutationRequests += 1;
      mutationStarted.release();
      await mutationResponse.wait;
      event = { ...event, version: 8, closureAuthorization: {
        actorId, reason: 'تفويض بشري صالح', authorizedAt: '2026-08-20T10:00:00.000Z'
      } };
      return ok(event);
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      return ok([]);
    }
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    listReads += 1;
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );
  const coordinator = new CriticalRefreshCoordinator(
    () => controller.isCriticalActionInFlight(),
    async () => { await controller.load(); }
  );

  await coordinator.request();
  await controller.select(event.id);
  const mutation = controller.authorizeClosure('تفويض بشري صالح');
  await mutationStarted.wait;
  await Promise.all([coordinator.request(), coordinator.request()]);
  assert.equal(listReads, 1);
  assert.equal(controller.state.selected?.id, event.id);

  mutationResponse.release();
  const mutationResult = await mutation;
  assert.equal(mutationResult.selected?.version, 8);
  assert.equal(mutationRequests, 1);
  assert.equal(timelineReads, 2);
  assert.equal(listReads, 1);

  await coordinator.flushAfterCriticalAction();
  await coordinator.flushAfterCriticalAction();
  assert.equal(listReads, 2);
  assert.equal(mutationRequests, 1);
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.selected, null);
});

test('reconciled closure remains terminal through a failed Timeline read and explicit retry without replay', async () => {
  let event: RoadEventResponse = {
    id: '50505050-5050-4050-8050-505050505050',
    status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 12, closureAuthorization: null,
    severity: { level: 'S4', score: 97, confidence: 0.96, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const mutationStarted = barrier();
  const mutationResponse = barrier();
  const closureStarted = barrier();
  const closureResponse = barrier();
  let failQueueReconciliation = false;
  let failTerminalTimelineRead = false;
  let withholdTerminalClosureRecord = false;
  let terminalTimelineFault: 'NONE' | 'DISCONTINUOUS' | 'REORDERED' | 'ACTOR_MISMATCH' | 'REVERSED_TIME'
    | 'AUTHORIZATION_BINDING_MISMATCH' | 'CAUSATION_MISMATCH' | 'LATE_APPEND' = 'NONE';
  let listReads = 0;
  let timelineReads = 0;
  let mutationRequests = 0;
  let transitionRequests = 0;
  const timeline: AuditTimelineEntryContract[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      mutationRequests += 1;
      mutationStarted.release();
      await mutationResponse.wait;
      event = { ...event, version: 13, closureAuthorization: {
        actorId, reason: 'تفويض لا يعاد عند فشل المصالحة', authorizedAt: '2026-08-20T10:00:00.000Z'
      } };
      timeline.push({
        action: 'road_event.closure_authorized', actorType: 'SUPERVISOR', actorId,
        beforeState: { version: 12, closureAuthorization: null },
        afterState: { version: 13, closureAuthorization: {
          actorId, reason: 'تفويض لا يعاد عند فشل المصالحة', authorizedAt: '2026-08-20T10:00:00.000Z'
        } },
        reason: 'تفويض لا يعاد عند فشل المصالحة', traceId: 'trace-authoritative-recovery',
        correlationId: event.id, causationId: null,
        occurredAt: '2026-08-20T10:00:00.000Z'
      });
      return ok(event);
    }
    if (target.pathname.endsWith('/transition')) {
      transitionRequests += 1;
      const body = JSON.parse(String(init?.body)) as {
        readonly expectedVersion: number;
        readonly nextStatus: string;
        readonly reason: string;
      };
      assert.deepEqual(body, {
        expectedVersion: 13,
        nextStatus: 'CLOSED',
        reason: 'إغلاق بشري بعد استعادة التفويض'
      });
      closureStarted.release();
      await closureResponse.wait;
      event = { ...event, status: 'CLOSED', version: 14, closureAuthorization: null };
      timeline.push({
        action: 'road_event.closed', actorType: 'SUPERVISOR', actorId,
        beforeState: { version: 13, closureAuthorization: {
          actorId, reason: 'تفويض لا يعاد عند فشل المصالحة', authorizedAt: '2026-08-20T10:00:00.000Z'
        } },
        afterState: { version: 14, closureAuthorization: null },
        reason: body.reason, traceId: 'trace-recovered-closure',
        correlationId: event.id, causationId: 'trace-authoritative-recovery',
        occurredAt: '2026-08-20T10:01:00.000Z'
      });
      return ok(event);
    }
    if (target.pathname.endsWith('/timeline')) {
      timelineReads += 1;
      if (failTerminalTimelineRead && event.status === 'CLOSED') {
        const envelope: ApiEnvelope<never> = { success: false, data: null,
          error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'internal terminal timeline read failed' },
          traceId: 'trace-terminal-timeline-read' };
        return new Response(JSON.stringify(envelope), {
          status: 503, headers: { 'content-type': 'application/json' }
        });
      }
      if (withholdTerminalClosureRecord && event.status === 'CLOSED') {
        return ok(timeline.filter((entry) => entry.action !== 'road_event.closed'));
      }
      if (terminalTimelineFault === 'DISCONTINUOUS' && event.status === 'CLOSED') {
        return ok(timeline.map((entry) => entry.action === 'road_event.closed'
          ? { ...entry, beforeState: { version: 12 } }
          : entry));
      }
      if (terminalTimelineFault === 'REORDERED' && event.status === 'CLOSED') {
        return ok([...timeline].reverse());
      }
      if (terminalTimelineFault === 'ACTOR_MISMATCH' && event.status === 'CLOSED') {
        return ok(timeline.map((entry) => entry.action === 'road_event.closed'
          ? { ...entry, actorId: 'supervisor-other' }
          : entry));
      }
      if (terminalTimelineFault === 'REVERSED_TIME' && event.status === 'CLOSED') {
        return ok(timeline.map((entry) => entry.action === 'road_event.closed'
          ? { ...entry, occurredAt: '2026-08-20T09:59:59.000Z' }
          : entry));
      }
      if (terminalTimelineFault === 'AUTHORIZATION_BINDING_MISMATCH' && event.status === 'CLOSED') {
        return ok(timeline.map((entry) => entry.action === 'road_event.closed'
          ? { ...entry, beforeState: { ...entry.beforeState, closureAuthorization: {
            actorId, reason: 'تفويض من عملية مستقلة', authorizedAt: '2026-08-20T10:00:00.000Z'
          } } }
          : entry));
      }
      if (terminalTimelineFault === 'CAUSATION_MISMATCH' && event.status === 'CLOSED') {
        return ok(timeline.map((entry) => entry.action === 'road_event.closed'
          ? { ...entry, causationId: 'trace-unrelated-authorization' }
          : entry));
      }
      if (terminalTimelineFault === 'LATE_APPEND' && event.status === 'CLOSED') {
        return ok([...timeline, {
          action: 'road_event.late_evidence_attached', actorType: 'SYSTEM', actorId: 'evidence-worker',
          beforeState: { version: 14 }, afterState: { version: 14 }, reason: 'دليل متأخر محفوظ دون إعادة فتح',
          traceId: 'trace-late-evidence', occurredAt: '2026-08-20T10:02:00.000Z'
        }]);
      }
      return ok(timeline);
    }
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    listReads += 1;
    if (failQueueReconciliation) {
      const envelope: ApiEnvelope<never> = { success: false, data: null,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'internal queue reconciliation failed' },
        traceId: 'trace-post-command-reconciliation' };
      return new Response(JSON.stringify(envelope), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );
  const coordinator = new CriticalRefreshCoordinator(
    () => controller.isCriticalActionInFlight(),
    async () => { await controller.load(); }
  );

  await coordinator.request();
  await controller.select(event.id);
  const mutation = controller.authorizeClosure('تفويض لا يعاد عند فشل المصالحة');
  await mutationStarted.wait;
  await coordinator.request();
  failQueueReconciliation = true;
  mutationResponse.release();
  const mutationResult = await mutation;
  assert.equal(mutationResult.selected?.version, 13);

  await coordinator.flushAfterCriticalAction();
  assert.equal(listReads, 2);
  assert.equal(mutationRequests, 1);
  assert.equal(controller.state.phase, 'failure');
  assert.equal(controller.state.stale, true);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.doesNotMatch(controller.state.error ?? '', /internal queue reconciliation failed/);

  failQueueReconciliation = false;
  await coordinator.request();
  assert.equal(listReads, 3);
  assert.equal(mutationRequests, 1);
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.stale, false);
  assert.equal(controller.state.selected, null);
  assert.deepEqual(controller.state.timeline, []);

  const recovered = await controller.select(event.id);
  assert.equal(listReads, 3);
  assert.equal(mutationRequests, 1);
  assert.equal(timelineReads, 3);
  assert.equal(recovered.selected?.version, 13);
  assert.equal(recovered.selected?.closureAuthorization?.actorId, actorId);
  assert.equal(recovered.timeline.length, 1);
  assert.equal(recovered.timeline[0]?.action, 'road_event.closure_authorized');
  assert.deepEqual(recovered.timeline[0]?.afterState, { version: 13, closureAuthorization: {
    actorId, reason: 'تفويض لا يعاد عند فشل المصالحة', authorizedAt: '2026-08-20T10:00:00.000Z'
  } });
  assert.equal(controller.canTransitionTo('CLOSED'), true);

  const closure = controller.transition('CLOSED', 'إغلاق بشري بعد استعادة التفويض');
  await closureStarted.wait;
  await coordinator.request();
  closureResponse.release();
  const closureResult = await closure;
  assert.equal(transitionRequests, 1);
  assert.equal(closureResult.selected?.status, 'CLOSED');
  assert.equal(closureResult.selected?.version, 14);
  assert.equal(closureResult.selected?.closureAuthorization, null);
  assert.deepEqual(closureResult.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed'
  ]);

  await coordinator.flushAfterCriticalAction();
  assert.equal(listReads, 4);
  assert.equal(controller.state.selected, null);

  const terminal = await controller.select(event.id);
  assert.equal(timelineReads, 5);
  assert.equal(terminal.selected?.status, 'CLOSED');
  assert.equal(terminal.selected?.version, 14);
  assert.equal(terminal.selected?.closureAuthorization, null);
  assert.deepEqual(terminal.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed'
  ]);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  const requestCount = transitionRequests;
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة إعادة فتح'), /الحالة النهائية/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض جديد'), /الحالة النهائية/);
  assert.equal(transitionRequests, requestCount);
  assert.equal(mutationRequests, 1);

  failTerminalTimelineRead = true;
  const failedTerminalRead = await controller.select(event.id);
  assert.equal(timelineReads, 6);
  assert.equal(failedTerminalRead.phase, 'failure');
  assert.equal(failedTerminalRead.stale, true);
  assert.equal(failedTerminalRead.selected, null);
  assert.deepEqual(failedTerminalRead.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.doesNotMatch(failedTerminalRead.error ?? '', /internal terminal timeline read failed/);
  const failedReadTransitionCount = transitionRequests;
  const failedReadAuthorizationCount = mutationRequests;
  await assert.rejects(() => controller.transition('RECOVERY', 'محاولة أثناء فشل القراءة'), /اختر حدثًا/);
  await assert.rejects(() => controller.authorizeClosure('محاولة تفويض أثناء فشل القراءة'), /اختر حدثًا/);
  assert.equal(transitionRequests, failedReadTransitionCount);
  assert.equal(mutationRequests, failedReadAuthorizationCount);

  failTerminalTimelineRead = false;
  const retriedTerminal = await controller.retrySelection();
  assert.equal(timelineReads, 7);
  assert.equal(retriedTerminal.phase, 'ready');
  assert.equal(retriedTerminal.stale, false);
  assert.equal(retriedTerminal.selected?.status, 'CLOSED');
  assert.equal(retriedTerminal.selected?.version, 14);
  assert.equal(retriedTerminal.selected?.closureAuthorization, null);
  assert.deepEqual(retriedTerminal.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed'
  ]);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  withholdTerminalClosureRecord = true;
  const incompleteTerminal = await controller.select(event.id);
  assert.equal(timelineReads, 8);
  assert.equal(incompleteTerminal.phase, 'failure');
  assert.equal(incompleteTerminal.stale, true);
  assert.equal(incompleteTerminal.selected, null);
  assert.deepEqual(incompleteTerminal.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.match(incompleteTerminal.error ?? '', /سجل الإغلاق المطابق/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  withholdTerminalClosureRecord = false;
  const completeTerminal = await controller.retrySelection();
  assert.equal(timelineReads, 9);
  assert.equal(completeTerminal.phase, 'ready');
  assert.equal(completeTerminal.stale, false);
  assert.equal(completeTerminal.selected?.status, 'CLOSED');
  assert.equal(completeTerminal.selected?.version, 14);
  assert.deepEqual(completeTerminal.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed'
  ]);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'DISCONTINUOUS';
  const discontinuousTerminal = await controller.select(event.id);
  assert.equal(timelineReads, 10);
  assert.equal(discontinuousTerminal.phase, 'failure');
  assert.equal(discontinuousTerminal.stale, true);
  assert.equal(discontinuousTerminal.selected, null);
  assert.deepEqual(discontinuousTerminal.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.match(discontinuousTerminal.error ?? '', /تسلسل سجل الإغلاق/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'REORDERED';
  const reorderedTerminal = await controller.retrySelection();
  assert.equal(timelineReads, 11);
  assert.equal(reorderedTerminal.phase, 'failure');
  assert.equal(reorderedTerminal.stale, true);
  assert.equal(reorderedTerminal.selected, null);
  assert.deepEqual(reorderedTerminal.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.match(reorderedTerminal.error ?? '', /ترتيب تفويض الإغلاق/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'NONE';
  const continuousTerminal = await controller.retrySelection();
  assert.equal(timelineReads, 12);
  assert.equal(continuousTerminal.phase, 'ready');
  assert.equal(continuousTerminal.stale, false);
  assert.equal(continuousTerminal.selected?.status, 'CLOSED');
  assert.equal(continuousTerminal.selected?.version, 14);
  assert.deepEqual(continuousTerminal.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed'
  ]);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'ACTOR_MISMATCH';
  const mismatchedActorTerminal = await controller.select(event.id);
  assert.equal(timelineReads, 13);
  assert.equal(mismatchedActorTerminal.phase, 'failure');
  assert.equal(mismatchedActorTerminal.stale, true);
  assert.equal(mismatchedActorTerminal.selected, null);
  assert.deepEqual(mismatchedActorTerminal.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.match(mismatchedActorTerminal.error ?? '', /تطابق هوية المشرف/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'REVERSED_TIME';
  const reversedTimeTerminal = await controller.retrySelection();
  assert.equal(timelineReads, 14);
  assert.equal(reversedTimeTerminal.phase, 'failure');
  assert.equal(reversedTimeTerminal.stale, true);
  assert.equal(reversedTimeTerminal.selected, null);
  assert.deepEqual(reversedTimeTerminal.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.match(reversedTimeTerminal.error ?? '', /التسلسل الزمني/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'AUTHORIZATION_BINDING_MISMATCH';
  const mismatchedAuthorizationBinding = await controller.retrySelection();
  assert.equal(timelineReads, 15);
  assert.equal(mismatchedAuthorizationBinding.phase, 'failure');
  assert.equal(mismatchedAuthorizationBinding.stale, true);
  assert.equal(mismatchedAuthorizationBinding.selected, null);
  assert.deepEqual(mismatchedAuthorizationBinding.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.match(mismatchedAuthorizationBinding.error ?? '', /ارتباط تفويض الإغلاق/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'CAUSATION_MISMATCH';
  const mismatchedCausation = await controller.retrySelection();
  assert.equal(timelineReads, 16);
  assert.equal(mismatchedCausation.phase, 'failure');
  assert.equal(mismatchedCausation.stale, true);
  assert.equal(mismatchedCausation.selected, null);
  assert.deepEqual(mismatchedCausation.timeline, []);
  assert.equal(controller.canRetrySelection(), true);
  assert.match(mismatchedCausation.error ?? '', /سببية تفويض الإغلاق/);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);

  terminalTimelineFault = 'LATE_APPEND';
  const terminalWithLateEvidence = await controller.retrySelection();
  assert.equal(timelineReads, 17);
  assert.equal(terminalWithLateEvidence.phase, 'ready');
  assert.equal(terminalWithLateEvidence.selected?.status, 'CLOSED');
  assert.deepEqual(terminalWithLateEvidence.timeline.map((entry) => entry.action), [
    'road_event.closure_authorized', 'road_event.closed', 'road_event.late_evidence_attached'
  ]);
  assert.equal(controller.canRetrySelection(), false);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);
  assert.equal(transitionRequests, 1);
  assert.equal(mutationRequests, 1);
});

function ok<T>(data: T): Response {
  const trustedData = withTrustedDetailReconciliation(data);
  const envelope: ApiEnvelope<T> = { success: true, data: trustedData, error: null, traceId: 'trace-http-workflow' };
  return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
}

function withTrustedDetailReconciliation<T>(data: T): T {
  if (typeof data !== 'object' || data === null || Array.isArray(data)
    || !('id' in data) || !('status' in data) || !('version' in data) || !('severity' in data)
    || Object.prototype.hasOwnProperty.call(data, 'reconciliation')) return data;
  return { ...data, reconciliation: null };
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

test('ambiguous critical retry requires a fresh read and reuses the exact idempotency key', async () => {
  let event: RoadEventResponse = {
    id: '44444444-4444-4444-8444-444444444444', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const authorizationKeys: string[] = [];
  const transitionKeys: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    const key = new Headers(init?.headers).get('idempotency-key');
    if (target.pathname.endsWith('/closure-authorization')) {
      assert.ok(key !== null);
      authorizationKeys.push(key);
      if (authorizationKeys.length === 1) throw new TypeError('connection reset after send');
      const body = JSON.parse(String(init?.body)) as { readonly reason: string; readonly authorizedAt: string };
      event = { ...event, version: 8, closureAuthorization: { actorId, reason: body.reason, authorizedAt: body.authorizedAt } };
      return ok(event);
    }
    if (target.pathname.endsWith('/transition')) {
      assert.ok(key !== null);
      transitionKeys.push(key);
      if (transitionKeys.length === 1) throw new TypeError('connection reset after send');
      event = { ...event, status: 'CLOSED', version: 9 };
      return ok(event);
    }
    assert.equal(key, null);
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
  await assert.rejects(() => controller.authorizeClosure('تحقق المشرف من سلامة الموقع'), /تعذر التحقق من نتيجة الإجراء/);
  assert.equal(controller.state.stale, true);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  let retryHtml = renderDashboard(controller.state, {
    canTransition: controller.canTransition(), canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(), now: new Date('2026-08-20T10:00:00.000Z')
  });
  assert.match(retryHtml, /إجراء حرج بنتيجة غير مؤكدة/);
  assert.match(retryHtml, new RegExp(event.id));
  assert.match(retryHtml, /تفويض الإغلاق/);
  assert.match(retryHtml, /verify-critical-action-button/);
  assert.doesNotMatch(retryHtml, /retry-critical-action-button/);
  await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /حدّث الحادث/);
  await controller.select(event.id);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), true);
  retryHtml = renderDashboard(controller.state, {
    canTransition: controller.canTransition(), canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(), now: new Date('2026-08-20T10:00:00.000Z')
  });
  assert.match(retryHtml, /retry-critical-action-button/);
  assert.doesNotMatch(retryHtml, /verify-critical-action-button/);
  await controller.retryAmbiguousCriticalAction();
  assert.equal(controller.state.selected?.version, 8);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  assert.equal(controller.ambiguousCriticalActionView(), null);
  assert.equal(authorizationKeys.length, 2);
  assert.equal(authorizationKeys[0], authorizationKeys[1]);

  await assert.rejects(() => controller.transition('CLOSED', 'اكتملت مراجعة الإغلاق'), /تعذر التحقق من نتيجة الإجراء/);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  await controller.select(event.id);
  assert.equal(controller.canRetryAmbiguousCriticalAction(), true);
  await controller.retryAmbiguousCriticalAction();
  assert.equal(controller.state.selected?.status, 'CLOSED');
  assert.equal(controller.state.selected?.version, 9);
  assert.equal(transitionKeys.length, 2);
  assert.equal(transitionKeys[0], transitionKeys[1]);
  assert.notEqual(authorizationKeys[0], transitionKeys[0]);
});

test('authenticated refresh disables an ambiguous retry when the incident revision changed', async () => {
  let event: RoadEventResponse = {
    id: '45454545-4545-4545-8545-454545454545', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  const fetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      event = { ...event, version: 8, closureAuthorization: {
        actorId, reason: 'سبق تسجيل التفويض', authorizedAt: '2026-08-20T10:00:00.000Z'
      } };
      throw new TypeError('connection reset after send');
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
  await assert.rejects(() => controller.authorizeClosure('تحقق المشرف من سلامة الموقع'), /تعذر التحقق من نتيجة الإجراء/);
  await controller.select(event.id);
  assert.equal(controller.ambiguousCriticalActionView()?.status, 'INVALIDATED');
  assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
  const html = renderDashboard(controller.state, {
    canTransition: controller.canTransition(), canAuthorizeClosure: controller.canAuthorizeClosure(),
    ambiguousCriticalAction: controller.ambiguousCriticalActionView(), now: new Date('2026-08-20T10:00:00.000Z')
  });
  assert.match(html, /تغير الحادث أو الإصدار أو الصلاحية/);
  assert.match(html, /إعادة الإرسال غير متاحة/);
  assert.doesNotMatch(html, /retry-critical-action-button|verify-critical-action-button/);
});

test('page exit and trusted-session replacement discard ambiguous operation identity without DOM or storage exposure', async () => {
  const event: RoadEventResponse = {
    id: '46464646-4646-4646-8646-464646464646', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
    occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
    severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
  };
  let capturedOperationId = '';
  const secretReason = 'سبب سري لا يجوز عرضه أو تخزينه';
  const ambiguousFetcher: typeof fetch = async (input, init) => {
    assertTrustedRequest(init);
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/closure-authorization')) {
      capturedOperationId = new Headers(init?.headers).get('idempotency-key') ?? '';
      throw new TypeError('connection reset after send');
    }
    if (target.pathname.endsWith('/timeline')) return ok([]);
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const original = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, ambiguousFetcher), { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );
  await original.load();
  await original.select(event.id);
  await assert.rejects(() => original.authorizeClosure(secretReason), /تعذر التحقق من نتيجة الإجراء/);
  assert.notEqual(capturedOperationId, '');
  const html = renderDashboard(original.state, {
    canTransition: original.canTransition(), canAuthorizeClosure: original.canAuthorizeClosure(),
    ambiguousCriticalAction: original.ambiguousCriticalActionView(), now: new Date('2026-08-20T10:00:00.000Z')
  });
  assert.doesNotMatch(html, new RegExp(capturedOperationId));
  assert.doesNotMatch(html, new RegExp(secretReason));

  original.discardBrowserSession();
  assert.equal(original.ambiguousCriticalActionView(), null);
  assert.equal(original.state.selected, null);
  assert.deepEqual(original.state.timeline, []);
  await assert.rejects(() => original.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);

  const replacementSession = {
    ...session, actorId: '22222222-2222-4222-8222-222222222222',
    getAccessToken: () => Promise.resolve('replacement-browser-token')
  };
  const replacementFetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer replacement-browser-token');
    const target = new URL(String(input), 'https://dashboard.example.test');
    if (target.pathname.endsWith('/timeline')) return ok([]);
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const replacement = new OperationsDashboardController(
    new HttpRoadEventGateway('', replacementSession, replacementFetcher), { roles: ['SUPERVISOR'] }
  );
  await replacement.load();
  await replacement.select(event.id);
  assert.equal(replacement.ambiguousCriticalActionView(), null);
  await assert.rejects(() => replacement.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);

  const [browserSource, controllerSource] = await Promise.all([
    readFile(new URL('./browser.js', import.meta.url), 'utf8'),
    readFile(new URL('./dashboard.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(`${browserSource}\n${controllerSource}`, /localStorage|sessionStorage|indexedDB/);
});

test('late critical success or ambiguous failure cannot repopulate a restored page after session discard', async () => {
  for (const outcome of ['SUCCESS', 'AMBIGUOUS_FAILURE'] as const) {
    let event: RoadEventResponse = {
      id: outcome === 'SUCCESS'
        ? '47474747-4747-4747-8747-474747474747'
        : '48484848-4848-4848-8848-484848484848',
      status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
      occurredAt: '2026-08-20T09:00:00.000Z', version: 7, closureAuthorization: null,
      severity: { level: 'S4', score: 96, confidence: 0.95, reasonCodes: ['life_threat'], requiresHumanReview: true }
    };
    const mutationStarted = barrier();
    const mutationResponse = barrier();
    let timelineReads = 0;
    let mutationRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      assertTrustedRequest(init);
      const target = new URL(String(input), 'https://dashboard.example.test');
      if (target.pathname.endsWith('/closure-authorization')) {
        mutationRequests += 1;
        mutationStarted.release();
        await mutationResponse.wait;
        if (outcome === 'AMBIGUOUS_FAILURE') throw new TypeError('connection reset after send');
        event = { ...event, version: 8, closureAuthorization: {
          actorId, reason: 'تفويض وصل بعد مغادرة الصفحة', authorizedAt: '2026-08-20T10:00:00.000Z'
        } };
        return ok(event);
      }
      if (target.pathname.endsWith('/timeline')) {
        timelineReads += 1;
        return ok([]);
      }
      if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
      return ok({ items: [event], total: 1, limit: 100, offset: 0 });
    };
    const controller = new OperationsDashboardController(
      new HttpRoadEventGateway('', session, fetcher), { roles: ['SUPERVISOR'] },
      () => new Date('2026-08-20T10:00:00.000Z')
    );

    await controller.load();
    await controller.select(event.id);
    const mutation = controller.authorizeClosure('مراجعة بشرية قبل مغادرة الصفحة');
    await mutationStarted.wait;
    controller.discardBrowserSession();
    await controller.load();
    assert.equal(controller.state.phase, 'ready');
    assert.equal(controller.state.selected, null);
    assert.deepEqual(controller.state.timeline, []);
    assert.equal(controller.state.stale, false);
    assert.equal(controller.state.error, null);

    mutationResponse.release();
    if (outcome === 'SUCCESS') await mutation;
    else await assert.rejects(mutation, SupersededCriticalActionError);

    assert.equal(mutationRequests, 1);
    assert.equal(timelineReads, 1);
    assert.equal(controller.state.selected, null);
    assert.deepEqual(controller.state.timeline, []);
    assert.equal(controller.state.stale, false);
    assert.equal(controller.state.error, null);
    assert.equal(controller.ambiguousCriticalActionView(), null);
    assert.equal(controller.canRetryAmbiguousCriticalAction(), false);
    await assert.rejects(() => controller.retryAmbiguousCriticalAction(), /لا يوجد إجراء حرج غامض/);
  }
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
        afterState: { version: 8, closureAuthorization: {
          actorId, reason: body.reason, authorizedAt: body.authorizedAt
        } }, reason: body.reason, traceId: 'trace-closure', correlationId: event.id, causationId: null,
        occurredAt: body.authorizedAt });
      return ok(event);
    }
    if (target.pathname.endsWith('/transition')) {
      const body = JSON.parse(String(init?.body)) as { readonly expectedVersion: number; readonly nextStatus: string; readonly reason: string };
      assert.deepEqual(body, { expectedVersion: 8, nextStatus: 'CLOSED', reason: 'اكتملت مراجعة الإغلاق' });
      event = { ...event, status: 'CLOSED', version: 9 };
      timeline.push({ action: 'road_event.closed', actorType: 'SUPERVISOR', actorId, beforeState: {
        version: 8, closureAuthorization: event.closureAuthorization
      },
        afterState: { version: 9 }, reason: body.reason, traceId: 'trace-closed', correlationId: event.id,
        causationId: 'trace-closure', occurredAt: '2026-08-20T10:00:30.000Z' });
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
