import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEvent, RoadEventClosureRequiresHumanAuthorizationError, RoadEventStatus, SeverityLevel } from '@ros/domain';
import { deriveRoadEventIdempotencyScope, RoadEventApplicationService } from './road-event-application.js';
import {
  AuthorizationDeniedError,
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from './local-adapters.js';
import { AuthenticatedActor } from './ports.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = 'trace-api-001';
const SCOPE = { tenantId: 'riyadh-pilot', purpose: 'road-safety-response' } as const;

function createFixture() {
  const repository = new MemoryRoadEventRepository();
  const signals = new MemorySignalAttachmentAdapter(repository);
  const service = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    signals,
    repository
  );
  return { repository, signals, service };
}

const operator: AuthenticatedActor = { actorId: ACTOR_ID, roles: ['OPERATOR'], ...SCOPE };
const supervisor: AuthenticatedActor = { actorId: ACTOR_ID, roles: ['SUPERVISOR'], ...SCOPE };

function context(key: string, actor: AuthenticatedActor = operator) {
  return { actor, traceId: TRACE_ID, idempotencyKey: key };
}

test('idempotent create retries return the same result without duplicate repository writes', async () => {
  const { repository, service } = createFixture();
  const command = {
    id: EVENT_ID,
    occurredAt: '2026-07-25T03:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  };
  const first = await service.create(command, context('create-event-0001'));
  const second = await service.create(command, context('create-event-0001'));
  assert.deepEqual(second, first);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, SCOPE)).total, 1);
  assert.equal((await repository.listForRoadEvent(EVENT_ID, SCOPE)).length, 1);
});

test('idempotency scope derivation is unambiguous and bounded for valid access scopes', () => {
  const first = deriveRoadEventIdempotencyScope('road_event:create', { actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'a:b', purpose: 'c' });
  const second = deriveRoadEventIdempotencyScope('road_event:create', { actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'a', purpose: 'b:c' });
  assert.notEqual(first, second);
  assert.match(first, /^road-event:[0-9a-f]{64}$/);
  assert.ok(first.length <= 128);

  const maximum = deriveRoadEventIdempotencyScope('road_event:authorize_closure', {
    actorId: ACTOR_ID,
    roles: ['OPERATOR'],
    tenantId: `t${'a'.repeat(127)}`,
    purpose: `p${'b'.repeat(127)}`
  });
  assert.match(maximum, /^road-event:[0-9a-f]{64}$/);
  assert.ok(maximum.length <= 128);
});

test('idempotency scope binds the trusted actor and canonical role set without role-order sensitivity', () => {
  const actorA: AuthenticatedActor = { ...operator, roles: ['FIELD_USER', 'OPERATOR'] };
  const actorB: AuthenticatedActor = { ...operator, actorId: '77777777-7777-4777-8777-777777777777', roles: ['FIELD_USER', 'OPERATOR'] };
  assert.equal(
    deriveRoadEventIdempotencyScope('road_event:create', actorA),
    deriveRoadEventIdempotencyScope('road_event:create', { ...actorA, roles: ['OPERATOR', 'FIELD_USER'] })
  );
  assert.notEqual(
    deriveRoadEventIdempotencyScope('road_event:create', actorA),
    deriveRoadEventIdempotencyScope('road_event:create', actorB)
  );
});

test('same-tenant FIELD_USER actors can reuse create and attach keys only for their own reports', async () => {
  const { repository, service, signals } = createFixture();
  const fieldA: AuthenticatedActor = { ...operator, roles: ['AUDITOR', 'FIELD_USER'] };
  const fieldB: AuthenticatedActor = { ...operator, actorId: '77777777-7777-4777-8777-777777777777', roles: ['FIELD_USER'] };
  const eventB = '88888888-8888-4888-8888-888888888888';
  await service.create({ id: EVENT_ID, occurredAt: '2026-07-25T03:00:00.000Z', latitude: 24.7136, longitude: 46.6753 }, context('field-shared-create-0001', fieldA));
  await service.create({ id: eventB, occurredAt: '2026-07-25T03:01:00.000Z', latitude: 24.7137, longitude: 46.6754 }, context('field-shared-create-0001', fieldB));
  assert.equal((await repository.findById(EVENT_ID, { ...SCOPE, reporterActorId: fieldA.actorId }))?.reporterActorId, fieldA.actorId);
  assert.equal((await repository.findById(eventB, { ...SCOPE, reporterActorId: fieldB.actorId }))?.reporterActorId, fieldB.actorId);

  await service.attachSignal({ roadEventId: EVENT_ID, signalId: '99999999-9999-4999-8999-999999999999', matchScore: 0.8, mergeReasons: ['owner_a'] }, context('field-shared-attach-0001', fieldA));
  await service.attachSignal({ roadEventId: eventB, signalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', matchScore: 0.8, mergeReasons: ['owner_b'] }, context('field-shared-attach-0001', fieldB));
  assert.equal(signals.attachments.length, 2);
  assert.equal(signals.attachments[0]?.actor.roles.includes('FIELD_USER'), true);
  assert.equal(signals.attachments[1]?.actor.roles.includes('FIELD_USER'), true);
});

test('ownership and canonical audit authority do not depend on trusted role claim order', async () => {
  const { repository, service } = createFixture();
  const fieldAuditor: AuthenticatedActor = { ...operator, roles: ['AUDITOR', 'FIELD_USER'] };
  const operatorField: AuthenticatedActor = {
    ...operator,
    actorId: '77777777-7777-4777-8777-777777777777',
    roles: ['FIELD_USER', 'OPERATOR']
  };
  const operatorEventId = '88888888-8888-4888-8888-888888888888';

  await service.create({
    id: EVENT_ID, occurredAt: '2026-07-25T03:00:00.000Z', latitude: 24.7136, longitude: 46.6753
  }, context('ordered-field-create-0001', fieldAuditor));
  await service.create({
    id: operatorEventId, occurredAt: '2026-07-25T03:01:00.000Z', latitude: 24.7137, longitude: 46.6754
  }, context('ordered-operator-create-0001', operatorField));

  assert.equal((await repository.findById(EVENT_ID, { ...SCOPE, reporterActorId: fieldAuditor.actorId }))?.reporterActorId, fieldAuditor.actorId);
  assert.equal((await repository.findById(operatorEventId, SCOPE))?.reporterActorId, null);
  assert.equal((await repository.listForRoadEvent(EVENT_ID, { ...SCOPE, reporterActorId: fieldAuditor.actorId }))[0]?.actorType, 'FIELD_USER');
  assert.equal((await repository.listForRoadEvent(operatorEventId, SCOPE))[0]?.actorType, 'OPERATOR');
});

test('delimiter-equivalent tenant and purpose pairs do not share idempotency records', async () => {
  const { repository, service } = createFixture();
  const actorA: AuthenticatedActor = { actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'a:b', purpose: 'c' };
  const actorB: AuthenticatedActor = { actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'a', purpose: 'b:c' };

  await service.create({
    id: EVENT_ID,
    occurredAt: '2026-07-25T03:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  }, context('shared-key-0001', actorA));
  await service.create({
    id: '66666666-6666-4666-8666-666666666666',
    occurredAt: '2026-07-25T03:01:00.000Z',
    latitude: 24.7137,
    longitude: 46.6754
  }, context('shared-key-0001', actorB));

  assert.equal((await repository.list({ limit: 20, offset: 0 }, actorA)).total, 1);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, actorB)).total, 1);
});

test('operator cannot grant supervisor-only closure authorization', async () => {
  const { repository, service } = createFixture();
  await repository.create(new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T03:00:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery
  }), {
    ...SCOPE,
    actorType: 'SYSTEM',
    action: 'fixture.created',
    traceId: '33333333-3333-4333-8333-333333333333',
    eventType: 'FixtureCreated',
    correlationId: '44444444-4444-4444-8444-444444444444'
  });
  await assert.rejects(() => service.authorizeClosure({
    roadEventId: EVENT_ID,
    expectedVersion: 1,
    reason: 'unsafe operator attempt',
    authorizedAt: '2026-07-25T03:10:00.000Z'
  }, context('authorize-0001')), AuthorizationDeniedError);
});

test('S3 closure remains blocked until supervisor authorization is persisted', async () => {
  const { repository, service } = createFixture();
  const event = new RoadEvent({
    id: EVENT_ID,
    occurredAt: new Date('2026-07-25T03:00:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Recovery,
    severity: {
      level: SeverityLevel.High,
      score: 75,
      confidence: 0.9,
      reasonCodes: ['high_impact'],
      requiresHumanReview: true
    }
  });
  await repository.create(event, {
    ...SCOPE,
    actorType: 'SYSTEM', action: 'fixture.created', traceId: '33333333-3333-4333-8333-333333333333',
    eventType: 'FixtureCreated', correlationId: '44444444-4444-4444-8444-444444444444'
  });

  await assert.rejects(() => service.transition({
    roadEventId: EVENT_ID, expectedVersion: 1, nextStatus: RoadEventStatus.Closed, reason: 'attempt close'
  }, context('close-event-0001')), RoadEventClosureRequiresHumanAuthorizationError);

  const authorized = await service.authorizeClosure({
    roadEventId: EVENT_ID,
    expectedVersion: 1,
    reason: 'scene verified safe',
    authorizedAt: '2026-07-25T03:10:00.000Z'
  }, context('authorize-0002', supervisor));
  assert.equal(authorized.version, 2);

  const closed = await service.transition({
    roadEventId: EVENT_ID, expectedVersion: 2, nextStatus: RoadEventStatus.Closed, reason: 'all gates passed'
  }, context('close-event-0002'));
  assert.equal(closed.status, RoadEventStatus.Closed);
});

test('signal attachment is idempotent and checks event existence', async () => {
  const { signals, service } = createFixture();
  await service.create({ id: EVENT_ID, occurredAt: '2026-07-25T03:00:00.000Z', latitude: 24.7136, longitude: 46.6753 }, context('create-event-0002'));
  const command = {
    roadEventId: EVENT_ID,
    signalId: '55555555-5555-4555-8555-555555555555',
    matchScore: 0.95,
    mergeReasons: ['same_segment', 'same_time_window']
  };
  await service.attachSignal(command, context('attach-signal-0001'));
  await service.attachSignal(command, context('attach-signal-0001'));
  assert.equal(signals.attachments.length, 1);
});
