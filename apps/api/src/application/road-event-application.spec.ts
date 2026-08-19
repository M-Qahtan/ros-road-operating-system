import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEvent, RoadEventClosureRequiresHumanAuthorizationError, RoadEventStatus, SeverityLevel } from '@ros/domain';
import { RoadEventApplicationService } from './road-event-application.js';
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
