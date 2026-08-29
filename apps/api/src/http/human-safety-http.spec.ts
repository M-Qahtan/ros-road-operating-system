import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import { AuthenticatedActor, IdempotencyPort, IdempotencyRecord } from '../application/ports.js';
import { ActorResolver } from './actor-resolver.js';
import {
  HumanSafetyBacking,
  HumanSafetyStore,
  createHumanSafetyHttpHandler
} from './human-safety-http.js';
import { HttpRequest } from './road-event-http.js';
import { ContactSessionRecord } from '../ros-eye/contact-orchestration.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const TRACE_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-21T00:00:00.000Z');

const OPERATOR: AuthenticatedActor = {
  actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION'
};
const SUPERVISOR: AuthenticatedActor = { ...OPERATOR, roles: ['SUPERVISOR'] };

function contact(version = 3): ContactSessionRecord {
  return {
    tenantId: OPERATOR.tenantId, caseId: CASE_ID, sessionId: 'session-human-safety-001',
    ownerActorId: null,
    state: 'NO_RESPONSE', version, protocolVersion: 'ros-eye.contact.v1',
    promptPolicyVersion: 'ros-eye.contact-prompts.v1',
    accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
    language: 'ar', identityConfidence: 'PARTIAL', activeChannel: 'PUSH', attemptCount: 1,
    responseDeadlineAt: '2026-08-20T23:59:00.000Z', lastInteractionAt: '2026-08-20T23:58:00.000Z',
    assignedOperatorId: null,
    accessibility: {
      screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true,
      simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true
    },
    automationSuppressed: false, nextActionAt: '2026-08-20T23:59:00.000Z', leaseOwner: null,
    leaseExpiresAt: null, updatedAt: '2026-08-20T23:58:00.000Z'
  };
}

class FakeStore implements HumanSafetyStore {
  current = contact();
  mutations = 0;
  evidenceState: HumanSafetyBacking['evidenceState'] = 'TRUSTED';

  async read(): Promise<HumanSafetyBacking> {
    return { contact: this.current, recommendation: null, evidenceState: this.evidenceState, provenance: [], audit: [] };
  }

  async mutate(input: Parameters<HumanSafetyStore['mutate']>[0]): Promise<void> {
    this.mutations += 1;
    assert.equal(input.actorId, ACTOR_ID);
    assert.equal(input.actorRole, input.action === 'assignment' ? 'SUPERVISOR' : input.actorRole);
    if (input.expectedContactVersion !== this.current.version) throw new Error('stale');
    this.current = {
      ...this.current,
      version: this.current.version + 1,
      state: input.action === 'takeover' ? 'OPERATOR_TAKEOVER' : input.action === 'escalate' ? 'ESCALATED' : this.current.state,
      assignedOperatorId: input.action === 'assignment' ? input.assigneeId! : input.actorId,
      automationSuppressed: true,
      responseDeadlineAt: null,
      nextActionAt: null,
      updatedAt: input.occurredAt
    };
  }
}

class TrackingIdempotency implements IdempotencyPort {
  readonly memory = new MemoryIdempotencyAdapter();
  gets = 0;
  executeExclusively<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T> {
    return this.memory.executeExclusively(scope, key, operation);
  }
  get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | undefined> {
    this.gets += 1;
    return this.memory.get(scope, key);
  }
  put<T>(scope: string, key: string, value: IdempotencyRecord<T>): Promise<void> {
    return this.memory.put(scope, key, value);
  }
}

async function fixture(actor: AuthenticatedActor = OPERATOR) {
  const repository = new MemoryRoadEventRepository();
  const appIdempotency = new MemoryIdempotencyAdapter();
  const application = new RoadEventApplicationService(
    repository, new RoleMatrixAuthorizationAdapter(), appIdempotency,
    new MemorySignalAttachmentAdapter(repository), repository
  );
  await application.create({
    id: CASE_ID, occurredAt: '2020-08-20T23:50:00.000Z', latitude: 24.7136, longitude: 46.6753,
    severity: { level: 'S4' as never, score: 95, confidence: 0.95, reasonCodes: ['possible_impact'], requiresHumanReview: true }
  }, { actor: OPERATOR, traceId: TRACE_ID, idempotencyKey: 'create-human-safety-case-001' });
  const store = new FakeStore();
  const idempotency = new TrackingIdempotency();
  const resolver: ActorResolver = { resolve: async () => actor };
  return { store, idempotency, handler: createHumanSafetyHttpHandler(application, store, idempotency, resolver, () => new Date(NOW)) };
}

function request(
  method: string,
  path: string,
  body: unknown = null,
  headers: Readonly<Record<string, string | undefined>> = {}
): HttpRequest {
  return { method, path, body, headers, query: {}, traceId: TRACE_ID };
}

test('list and detail expose live scoped RoadEvents with durable contact state', async () => {
  const { handler } = await fixture();
  const list = await handler(request('GET', '/api/v1/human-safety/cases'));
  assert.equal(list?.status, 200);
  const page = (list!.body as { data: { items: Array<{ safetyCase: { id: string; state: string } }> } }).data;
  assert.deepEqual(page.items.map((item) => [item.safetyCase.id, item.safetyCase.state]), [[CASE_ID, 'NO_RESPONSE']]);
  const detail = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  assert.equal(detail?.status, 200);
});

test('takeover uses only the trusted principal and replays without a second mutation', async () => {
  const { handler, store } = await fixture();
  const body = {
    actorId: 'forged-actor', actorRoles: ['SUPERVISOR'], expectedCaseVersion: 1,
    expectedContactVersion: 3, reason: 'no response takeover', idempotencyKey: 'takeover-human-safety-001'
  };
  const headers = { 'idempotency-key': 'takeover-human-safety-001' };
  const first = await handler(request('POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`, body, headers));
  const replay = await handler(request('POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`, body, headers));
  assert.equal(first?.status, 200);
  assert.equal(replay?.status, 200);
  assert.equal(store.mutations, 1);
  assert.equal(store.current.assignedOperatorId, ACTOR_ID);
});

test('resource scope is authorized before idempotency replay lookup', async () => {
  const wrongScope = { ...OPERATOR, actorId: OTHER_ACTOR_ID, tenantId: 'other-tenant' };
  const { handler, idempotency } = await fixture(wrongScope);
  const response = await handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, reason: 'forged replay', idempotencyKey: 'takeover-human-safety-002' },
    { 'idempotency-key': 'takeover-human-safety-002' }
  ));
  assert.equal(response?.status, 404);
  assert.equal(idempotency.gets, 0);
});

test('assignment and high-risk resolution remain supervisor-only', async () => {
  const operator = await fixture();
  const denied = await operator.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: OTHER_ACTOR_ID, reason: 'reassign', idempotencyKey: 'assign-human-safety-001' },
    { 'idempotency-key': 'assign-human-safety-001' }
  ));
  assert.equal(denied?.status, 403);

  const supervisor = await fixture(SUPERVISOR);
  const assigned = await supervisor.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: OTHER_ACTOR_ID, reason: 'supervised reassign', idempotencyKey: 'assign-human-safety-002' },
    { 'idempotency-key': 'assign-human-safety-002' }
  ));
  assert.equal(assigned?.status, 200);
  assert.equal(supervisor.store.current.assignedOperatorId, OTHER_ACTOR_ID);

  const invalidAssignee = await fixture(SUPERVISOR);
  const invalid = await invalidAssignee.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: 'unprovisioned-operator', reason: 'unsafe reassign', idempotencyKey: 'assign-human-safety-003' },
    { 'idempotency-key': 'assign-human-safety-003' }
  ));
  assert.equal(invalid?.status, 400);
  assert.equal(invalidAssignee.store.mutations, 0);
});
