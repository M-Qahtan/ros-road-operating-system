import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEvent, RoadEventWriteContext } from '@ros/domain';
import { ApplicationConflictError, RoadEventApplicationService } from './road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from './local-adapters.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = 'riyadh-ops';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';

class BlockingCreateRepository extends MemoryRoadEventRepository {
  private releaseCreate!: () => void;
  private startedCreate!: () => void;
  readonly createStarted = new Promise<void>((resolve) => { this.startedCreate = resolve; });
  private readonly createReleased = new Promise<void>((resolve) => { this.releaseCreate = resolve; });

  release(): void { this.releaseCreate(); }

  override async create(event: RoadEvent, context: RoadEventWriteContext): Promise<void> {
    this.startedCreate();
    await this.createReleased;
    await super.create(event, context);
  }
}

test('concurrent requests with the same scoped idempotency key cannot execute the command twice', async () => {
  const repository = new BlockingCreateRepository();
  const service = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(),
    repository
  );
  const command = {
    id: EVENT_ID,
    occurredAt: '2026-08-19T10:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  };
  const actor = {
    actorId: ACTOR_ID,
    roles: ['OPERATOR'] as const,
    tenantId: TENANT_ID,
    purpose: PURPOSE
  };
  const context = {
    actor,
    traceId: 'trace-concurrency-001',
    idempotencyKey: 'same-request-0001'
  };

  const first = service.create(command, context);
  await repository.createStarted;

  await assert.rejects(
    service.create(command, context),
    (error: unknown) => error instanceof ApplicationConflictError && /already in progress/.test(error.message)
  );

  repository.release();
  const firstResult = await first;
  const replayResult = await service.create(command, context);

  assert.deepEqual(replayResult, firstResult);
  assert.equal((await repository.list({ limit: 20, offset: 0 }, actor)).total, 1);
});
