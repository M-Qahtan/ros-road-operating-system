import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoadEventPageResponse, RoadEventResponse } from '@ros/contracts';
import type { AuditTimelineEntryContract, RoadEventGateway } from './api-client.js';
import { OperationsDashboardController } from './dashboard.js';
import { renderDashboard } from './render.js';

const event: RoadEventResponse = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'RECOVERY', latitude: 24.72, longitude: 46.68,
  occurredAt: '2026-07-25T03:00:00.000Z', version: 7, closureAuthorization: null,
  severity: { level: 'S4', score: 96, confidence: .95, reasonCodes: ['life_threat'], requiresHumanReview: true }
};

class WorkflowGateway implements RoadEventGateway {
  current = event;
  audit: AuditTimelineEntryContract[] = [];
  list(): Promise<RoadEventPageResponse> { return Promise.resolve({ items: [this.current], total: 1, limit: 100, offset: 0 }); }
  getById(): Promise<RoadEventResponse> { return Promise.resolve(this.current); }
  timeline(): Promise<readonly AuditTimelineEntryContract[]> { return Promise.resolve(this.audit); }
  transition(): Promise<RoadEventResponse> { return Promise.reject(new Error('closure authorization must happen first')); }
  authorizeClosure(_id: string, request: { readonly reason: string; readonly authorizedAt: string }): Promise<RoadEventResponse> {
    this.current = { ...this.current, version: 8, closureAuthorization: { actorId: 'supervisor-1', reason: request.reason, authorizedAt: request.authorizedAt } };
    this.audit.push({ action: 'road_event.closure_authorized', actorType: 'SUPERVISOR', actorId: 'supervisor-1', beforeState: null, afterState: { version: 8 }, reason: request.reason, traceId: 'trace-authorize', occurredAt: request.authorizedAt });
    return Promise.resolve(this.current);
  }
}

test('browser workflow loads queue, opens S4 detail, confirms supervisor authorization and renders immutable audit outcome', async () => {
  const gateway = new WorkflowGateway();
  const controller = new OperationsDashboardController(gateway, { roles: ['SUPERVISOR'] }, () => new Date('2026-07-25T03:30:00.000Z'));

  await controller.load();
  let html = renderDashboard(controller.state, { canTransition: true, canAuthorizeClosure: true, now: new Date('2026-07-25T03:30:00.000Z') });
  assert.match(html, /S4/);

  await controller.select(event.id);
  html = renderDashboard(controller.state, { canTransition: true, canAuthorizeClosure: true, now: new Date('2026-07-25T03:30:00.000Z') });
  assert.match(html, /خطر مرتفع/);
  assert.match(html, /تفويض إغلاق S3\/S4/);

  await controller.authorizeClosure('تمت مراجعة سلامة الموقع من مشرفين');
  html = renderDashboard(controller.state, { canTransition: true, canAuthorizeClosure: true, now: new Date('2026-07-25T03:30:00.000Z') });
  assert.match(html, /تمت مراجعة سلامة الموقع من مشرفين/);
  assert.match(html, /road_event.closure_authorized/);
  assert.match(html, /trace-authorize/);
});
