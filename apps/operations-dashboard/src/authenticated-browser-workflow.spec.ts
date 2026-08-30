import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiEnvelope, RoadEventResponse } from '@ros/contracts';
import { HttpRoadEventGateway, type AuditTimelineEntryContract } from './api-client.js';
import { OperationsDashboardController } from './dashboard.js';
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

test('authenticated RoadEvent browser workflow crosses HTTP queue detail timeline and closure authorization', async () => {
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
  const timeline: AuditTimelineEntryContract[] = [];
  const paths: string[] = [];
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
    if (target.pathname.endsWith('/timeline')) return ok(timeline);
    if (target.pathname === `/api/v1/road-events/${event.id}`) return ok(event);
    return ok({ items: [event], total: 1, limit: 100, offset: 0 });
  };
  const controller = new OperationsDashboardController(
    new HttpRoadEventGateway('', session, fetcher),
    { roles: ['SUPERVISOR'] },
    () => new Date('2026-08-20T10:00:00.000Z')
  );

  await controller.load();
  await controller.select(event.id);
  await controller.authorizeClosure('تحقق المشرف من سلامة الموقع');
  const html = renderDashboard(controller.state, { canTransition: controller.canTransition(),
    canAuthorizeClosure: controller.canAuthorizeClosure(), now: new Date('2026-08-20T10:00:00.000Z') });

  assert.match(html, /تحقق المشرف من سلامة الموقع/);
  assert.match(html, /road_event\.closure_authorized/);
  assert.deepEqual(paths, [
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
