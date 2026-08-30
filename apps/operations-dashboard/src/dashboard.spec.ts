import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoadEventPageResponse, RoadEventResponse } from '@ros/contracts';
import { ApiRequestError, type AuditTimelineEntryContract, type RoadEventGateway } from './api-client.js';
import { OperationsDashboardController } from './dashboard.js';
import { renderDashboard } from './render.js';

const roadEvent: RoadEventResponse = {
  id: '11111111-1111-4111-8111-111111111111', status: 'RECOVERY', latitude: 24.7136, longitude: 46.6753,
  occurredAt: '2026-07-25T03:00:00.000Z', version: 4, closureAuthorization: null,
  severity: { level: 'S3', score: 75, confidence: .91, reasonCodes: ['high_impact'], requiresHumanReview: true }
};
const audit: AuditTimelineEntryContract = {
  action: 'road_event.severity_reassessed', actorType: 'OPERATOR', actorId: 'operator-1', beforeState: null,
  afterState: { signalId: 'signal-1' }, reason: 'تم تأكيد خطر بشري مرتفع', traceId: 'trace-1', occurredAt: '2026-07-25T03:02:00.000Z'
};

class FakeGateway implements RoadEventGateway {
  readonly calls: string[] = [];
  list(): Promise<RoadEventPageResponse> { this.calls.push('list'); return Promise.resolve({ items: [roadEvent], total: 1, limit: 100, offset: 0 }); }
  getById(id: string): Promise<RoadEventResponse> { this.calls.push(`get:${id}`); return Promise.resolve(roadEvent); }
  timeline(id: string): Promise<readonly AuditTimelineEntryContract[]> { this.calls.push(`timeline:${id}`); return Promise.resolve([audit]); }
  transition(id: string, request: { readonly expectedVersion: number; readonly nextStatus: string; readonly reason: string }): Promise<RoadEventResponse> {
    this.calls.push(`transition:${id}:${request.reason}`); return Promise.resolve({ ...roadEvent, status: request.nextStatus as RoadEventResponse['status'], version: 5 });
  }
  authorizeClosure(id: string, request: { readonly expectedVersion: number; readonly reason: string; readonly authorizedAt: string }): Promise<RoadEventResponse> {
    this.calls.push(`authorize:${id}:${request.reason}`);
    return Promise.resolve({ ...roadEvent, version: 5, closureAuthorization: { actorId: 'supervisor-1', reason: request.reason, authorizedAt: request.authorizedAt } });
  }
}

class ConflictGateway extends FakeGateway {
  override authorizeClosure(): Promise<RoadEventResponse> {
    return Promise.reject(new ApiRequestError({
      status: 409,
      code: 'CONFLICT',
      message: 'تغيرت البيانات منذ آخر تحديث. حدّث الشاشة قبل اتخاذ قرار جديد.',
      traceId: 'trace-conflict-001',
      outcomeAmbiguous: true
    }));
  }
}

test('renders Arabic-first queue, safety, signals, audit and accessible critical controls', async () => {
  const gateway = new FakeGateway();
  const controller = new OperationsDashboardController(gateway, { roles: ['SUPERVISOR'] }, () => new Date('2026-07-25T03:10:00.000Z'));
  await controller.load();
  await controller.select(roadEvent.id);
  const html = renderDashboard(controller.state, { canTransition: true, canAuthorizeClosure: true, now: new Date('2026-07-25T03:10:00.000Z') });
  assert.match(html, /قائمة الأحداث/);
  assert.match(html, /سلامة الإنسان/);
  assert.match(html, /signal-1/);
  assert.match(html, /سجل التدقيق/);
  assert.match(html, /aria-labelledby="detail-title"/);
  assert.match(html, /تفويض إغلاق S3\/S4/);
});

test('permission and stale states are explicit and fail closed', async () => {
  const controller = new OperationsDashboardController(new FakeGateway(), { roles: ['AUDITOR'], staleAfterMs: 1000 }, () => new Date('2026-07-25T03:10:00.000Z'));
  await controller.load();
  await controller.select(roadEvent.id);
  assert.equal(controller.canTransition(), false);
  assert.equal(controller.canAuthorizeClosure(), false);

  const staleController = new OperationsDashboardController(new FakeGateway(), { roles: ['SUPERVISOR'], staleAfterMs: 1000 }, () => new Date('2026-07-25T03:10:00.000Z'));
  await staleController.load();
  await staleController.select(roadEvent.id);
  const staleState = { ...staleController.state, stale: true };
  const html = renderDashboard(staleState, { canTransition: false, canAuthorizeClosure: false, now: new Date('2026-07-25T03:10:02.000Z') });
  assert.match(html, /البيانات قديمة/);
  assert.match(html, /disabled/);
});

test('remote conflict makes the selected RoadEvent stale and disables critical controls', async () => {
  const controller = new OperationsDashboardController(
    new ConflictGateway(),
    { roles: ['SUPERVISOR'] },
    () => new Date('2026-07-25T03:10:00.000Z')
  );
  await controller.load();
  await controller.select(roadEvent.id);
  await assert.rejects(() => controller.authorizeClosure('مراجعة بشرية مكتملة'), /تغيرت البيانات/);
  assert.equal(controller.state.stale, true);
  assert.equal(controller.canAuthorizeClosure(), false);
  const html = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-07-25T03:10:00.000Z') });
  assert.match(html, /البيانات قديمة/);
  assert.match(html, /disabled/);
});
