import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { RoadEvent } from '@ros/domain';
import { ApplicationConflictError } from '../application/road-event-application.js';
import { IdempotencyInFlightError } from '../application/ports.js';
import { createNodeRedisStreamClient } from '../messaging/node-redis-stream-client.js';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { PostgresRoadEventRepository } from '../persistence/postgres/postgres-road-event-repository.js';
import { PostgresIdempotencyAdapter } from '../persistence/postgres/postgres-road-event-support.js';
import { createOutboxWorkerRuntime } from '../runtime/outbox-worker-runtime.js';
import { createPersistentRoadEventApplication } from '../runtime/runtime-composition.js';
import { evaluateRuntimeSlo } from '../runtime/runtime-slo.js';

const LOAD_COUNT = 500;
const LOAD_BATCH_SIZE = 25;
const TENANT_ID = 'runtime-resilience-tenant';
const PURPOSE = 'road-safety-response';
const STREAM = process.env.ROS_OUTBOX_STREAM ?? 'ros:resilience-events';
const CRASH_SCOPE = 'runtime-resilience:crash-before-commit';
const CRASH_KEY = 'resilience-crash-0001';
const AMBIGUOUS_SCOPE = 'runtime-resilience:committed-without-replay';
const AMBIGUOUS_KEY = 'resilience-ambiguous-0001';
const AMBIGUOUS_EVENT_ID = '97777777-7777-4777-8777-777777777777';
const AMBIGUOUS_TRACE_ID = '98888888-8888-4888-8888-888888888888';
const AMBIGUOUS_CORRELATION_ID = '99999999-9999-4999-8999-999999999999';
const REPLAY_KEY = 'resilience-replay-0001';
const REPLAY_EVENT_ID = '94444444-4444-4444-8444-444444444444';
const REPLAY_ACTOR_ID = '95555555-5555-4555-8555-555555555555';
const REPLAY_TRACE_ID = '96666666-6666-4666-8666-666666666666';

interface CountRow { readonly count: number | string; }
interface ScopeRow { readonly scope: string; }
interface ReservationRow { readonly fence_token: string; }

function requiredRedisUrl(): string {
  const value = process.env.REDIS_URL?.trim();
  if (!value) throw new Error('REDIS_URL is required for runtime resilience integration');
  return value;
}

async function scalarCount(
  postgres: ReturnType<typeof createNodePostgresPool>,
  text: string,
  values: readonly unknown[] = []
): Promise<number> {
  const client = await postgres.connect();
  try {
    const result = await client.query<CountRow>(text, values);
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    client.release();
  }
}

async function insertOutboxLoad(
  postgres: ReturnType<typeof createNodePostgresPool>,
  count: number
): Promise<readonly string[]> {
  const ids: string[] = [];
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID();
      ids.push(id);
      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload,
           correlation_id, tenant_id, purpose, occurred_at
         ) VALUES ($1::uuid, 'RoadEvent', $2::uuid, 'RuntimeResilienceProbe',
                   $3::jsonb, $4::uuid, $5, $6, now())`,
        [id, randomUUID(), { sequence: index }, randomUUID(), TENANT_ID, PURPOSE]
      );
    }
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function drainWorker(
  postgres: ReturnType<typeof createNodePostgresPool>,
  redis: ReturnType<typeof createNodeRedisStreamClient>,
  workerId: string
): Promise<{ readonly published: number; readonly cycles: number }> {
  const worker = createOutboxWorkerRuntime(postgres, redis, {
    ...process.env,
    ROS_OUTBOX_WORKER_ID: workerId,
    ROS_OUTBOX_BATCH_SIZE: String(LOAD_BATCH_SIZE),
    ROS_OUTBOX_STREAM: STREAM
  });
  let published = 0;
  let cycles = 0;
  for (;;) {
    const result = await worker.runOnce();
    cycles += 1;
    published += result.published;
    assert.equal(result.retried, 0);
    assert.equal(result.deadLettered, 0);
    if (result.claimed === 0) return { published, cycles };
    assert.equal(result.claimed, result.published);
  }
}

async function provePoolPressure(postgres: ReturnType<typeof createNodePostgresPool>): Promise<void> {
  const probes = Array.from({ length: 20 }, async () => {
    const client = await postgres.connect();
    try {
      const result = await client.query<{ readonly ok: number }>('SELECT 1 AS ok');
      assert.equal(Number(result.rows[0]?.ok), 1);
    } finally {
      client.release();
    }
  });
  await Promise.all(probes);
}

async function proveWorkerRestartRecovery(
  postgres: ReturnType<typeof createNodePostgresPool>,
  redis: ReturnType<typeof createNodeRedisStreamClient>
): Promise<void> {
  const expiredId = randomUUID();
  const activeId = randomUUID();
  const client = await postgres.connect();
  try {
    await client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload,
         correlation_id, tenant_id, purpose, occurred_at, locked_by, locked_until
       ) VALUES
       ($1::uuid, 'RoadEvent', $2::uuid, 'RuntimeRestartProbe', '{}'::jsonb,
        $3::uuid, $4, $5, now(), 'dead-worker', now() - interval '1 second'),
       ($6::uuid, 'RoadEvent', $7::uuid, 'RuntimeActiveLeaseProbe', '{}'::jsonb,
        $8::uuid, $4, $5, now(), 'live-worker', now() + interval '10 minutes')`,
      [expiredId, randomUUID(), randomUUID(), TENANT_ID, PURPOSE, activeId, randomUUID(), randomUUID()]
    );
  } finally {
    client.release();
  }

  const recoveryWorker = createOutboxWorkerRuntime(postgres, redis, {
    ...process.env,
    ROS_OUTBOX_WORKER_ID: 'resilience-restart-worker',
    ROS_OUTBOX_BATCH_SIZE: '10',
    ROS_OUTBOX_STREAM: STREAM
  });
  const recovered = await recoveryWorker.runOnce();
  assert.deepEqual(recovered, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE id = $1::uuid AND published_at IS NOT NULL`, [expiredId]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE id = $1::uuid AND published_at IS NULL`, [activeId]),
    1
  );

  const fenced = await recoveryWorker.runOnce();
  assert.deepEqual(fenced, { claimed: 0, published: 0, retried: 0, deadLettered: 0 });

  const expiryClient = await postgres.connect();
  try {
    await expiryClient.query(
      `UPDATE outbox_events SET locked_until = now() - interval '1 second' WHERE id = $1::uuid`,
      [activeId]
    );
  } finally {
    expiryClient.release();
  }
  const afterExpiry = await recoveryWorker.runOnce();
  assert.deepEqual(afterExpiry, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });
}

async function proveIdempotencyCrashFence(
  postgres: ReturnType<typeof createNodePostgresPool>
): Promise<void> {
  const cleanup = await postgres.connect();
  try {
    await cleanup.query(
      `DELETE FROM idempotency_reservations WHERE scope = $1 AND idempotency_key = $2`,
      [CRASH_SCOPE, CRASH_KEY]
    );
    await cleanup.query(
      `DELETE FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2`,
      [CRASH_SCOPE, CRASH_KEY]
    );
  } finally {
    cleanup.release();
  }

  const adapter = new PostgresIdempotencyAdapter(postgres);
  await assert.rejects(
    adapter.executeExclusively(CRASH_SCOPE, CRASH_KEY, async () => {
      throw new Error('simulated crash before domain commit');
    }),
    /simulated crash before domain commit/
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM idempotency_reservations WHERE scope = $1 AND idempotency_key = $2`, [CRASH_SCOPE, CRASH_KEY]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2`, [CRASH_SCOPE, CRASH_KEY]),
    0
  );

  const restartedAdapter = new PostgresIdempotencyAdapter(postgres);
  await assert.rejects(
    restartedAdapter.executeExclusively(CRASH_SCOPE, CRASH_KEY, async () => 'must-not-run'),
    IdempotencyInFlightError
  );

  const alerts = evaluateRuntimeSlo({
    outboxBacklog: 0,
    oldestOutboxAgeSeconds: 0,
    deadLetterCount: 0,
    strandedIdempotencyReservations: 1,
    postgresPoolUtilization: 0.5,
    postgresReady: true,
    redisReady: true
  });
  assert.ok(alerts.some((alert) => alert.code === 'idempotency_reconciliation_required' && alert.severity === 'page'));

  const evidenceClient = await postgres.connect();
  try {
    const reservation = await evidenceClient.query<ReservationRow>(
      `SELECT fence_token FROM idempotency_reservations WHERE scope = $1 AND idempotency_key = $2`,
      [CRASH_SCOPE, CRASH_KEY]
    );
    const fence = reservation.rows[0]?.fence_token;
    assert.ok(fence);
    const released = await evidenceClient.query(
      `DELETE FROM idempotency_reservations
        WHERE scope = $1 AND idempotency_key = $2 AND fence_token = $3::uuid
        RETURNING fence_token`,
      [CRASH_SCOPE, CRASH_KEY, fence]
    );
    assert.equal(released.rowCount, 1);
  } finally {
    evidenceClient.release();
  }
}

async function proveCommittedWithoutReplayStaysFailClosed(
  postgres: ReturnType<typeof createNodePostgresPool>
): Promise<void> {
  const idempotency = new PostgresIdempotencyAdapter(postgres);
  const repository = new PostgresRoadEventRepository(postgres);
  const event = new RoadEvent({
    id: AMBIGUOUS_EVENT_ID,
    occurredAt: new Date('2026-08-20T00:10:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753
  });

  await assert.rejects(
    idempotency.executeExclusively(AMBIGUOUS_SCOPE, AMBIGUOUS_KEY, async () => {
      await repository.create(event, {
        tenantId: TENANT_ID,
        purpose: PURPOSE,
        actorType: 'SYSTEM',
        action: 'runtime_resilience.ambiguous_commit',
        traceId: AMBIGUOUS_TRACE_ID,
        eventType: 'RuntimeResilienceAmbiguousCommit',
        correlationId: AMBIGUOUS_CORRELATION_ID
      });
      throw new Error('simulated process loss after domain commit before replay persistence');
    }),
    /simulated process loss after domain commit before replay persistence/
  );

  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM road_events WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3`, [AMBIGUOUS_EVENT_ID, TENANT_ID, PURPOSE]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM audit_logs WHERE resource_type = 'RoadEvent' AND resource_id = $1::uuid`, [AMBIGUOUS_EVENT_ID]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE aggregate_type = 'RoadEvent' AND aggregate_id = $1::uuid AND tenant_id = $2 AND purpose = $3`, [AMBIGUOUS_EVENT_ID, TENANT_ID, PURPOSE]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2`, [AMBIGUOUS_SCOPE, AMBIGUOUS_KEY]),
    0
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM idempotency_reservations WHERE scope = $1 AND idempotency_key = $2`, [AMBIGUOUS_SCOPE, AMBIGUOUS_KEY]),
    1
  );

  let reexecutionAttempts = 0;
  const restartedAdapter = new PostgresIdempotencyAdapter(postgres);
  await assert.rejects(
    restartedAdapter.executeExclusively(AMBIGUOUS_SCOPE, AMBIGUOUS_KEY, async () => {
      reexecutionAttempts += 1;
      return 'must-not-run';
    }),
    IdempotencyInFlightError
  );
  assert.equal(reexecutionAttempts, 0);
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM road_events WHERE id = $1::uuid`, [AMBIGUOUS_EVENT_ID]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE aggregate_type = 'RoadEvent' AND aggregate_id = $1::uuid`, [AMBIGUOUS_EVENT_ID]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM idempotency_reservations WHERE scope = $1 AND idempotency_key = $2`, [AMBIGUOUS_SCOPE, AMBIGUOUS_KEY]),
    1
  );
}

async function proveReplayAndExactReconciliation(
  postgres: ReturnType<typeof createNodePostgresPool>
): Promise<void> {
  const actor = {
    actorId: REPLAY_ACTOR_ID,
    roles: ['OPERATOR'] as const,
    tenantId: TENANT_ID,
    purpose: PURPOSE
  };
  const command = {
    id: REPLAY_EVENT_ID,
    occurredAt: '2026-08-20T00:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  };
  const context = { actor, traceId: REPLAY_TRACE_ID, idempotencyKey: REPLAY_KEY };

  const firstProcess = createPersistentRoadEventApplication(postgres);
  const first = await firstProcess.create(command, context);
  assert.equal(first.id, REPLAY_EVENT_ID);

  const restartedProcess = createPersistentRoadEventApplication(postgres);
  const replay = await restartedProcess.create(command, context);
  assert.deepEqual(replay, first);
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM road_events WHERE id = $1::uuid AND tenant_id = $2 AND purpose = $3`, [REPLAY_EVENT_ID, TENANT_ID, PURPOSE]),
    1
  );
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE aggregate_type = 'RoadEvent' AND aggregate_id = $1::uuid`, [REPLAY_EVENT_ID]),
    1
  );

  const scopeClient = await postgres.connect();
  let persistedScope = '';
  const leftoverFence = randomUUID();
  try {
    const scopes = await scopeClient.query<ScopeRow>(
      `SELECT scope FROM idempotency_records WHERE idempotency_key = $1`,
      [REPLAY_KEY]
    );
    persistedScope = scopes.rows[0]?.scope ?? '';
    assert.ok(persistedScope);
    await scopeClient.query(
      `INSERT INTO idempotency_reservations (scope, idempotency_key, fence_token)
       VALUES ($1, $2, $3::uuid)`,
      [persistedScope, REPLAY_KEY, leftoverFence]
    );
  } finally {
    scopeClient.release();
  }

  const blockedProcess = createPersistentRoadEventApplication(postgres);
  await assert.rejects(blockedProcess.create(command, context), ApplicationConflictError);
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM road_events WHERE id = $1::uuid`, [REPLAY_EVENT_ID]),
    1
  );

  const reconcileClient = await postgres.connect();
  try {
    const released = await reconcileClient.query(
      `DELETE FROM idempotency_reservations
        WHERE scope = $1 AND idempotency_key = $2 AND fence_token = $3::uuid
        RETURNING fence_token`,
      [persistedScope, REPLAY_KEY, leftoverFence]
    );
    assert.equal(released.rowCount, 1);
  } finally {
    reconcileClient.release();
  }

  const reconciledProcess = createPersistentRoadEventApplication(postgres);
  const reconciledReplay = await reconciledProcess.create(command, context);
  assert.deepEqual(reconciledReplay, first);
  assert.equal(
    await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE aggregate_type = 'RoadEvent' AND aggregate_id = $1::uuid`, [REPLAY_EVENT_ID]),
    1
  );
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool({ ...process.env, DATABASE_POOL_MAX: '2' });
  const redis = createNodeRedisStreamClient(process.env);
  const redisVerifier = createClient({ url: requiredRedisUrl(), disableOfflineQueue: true });
  redisVerifier.on('error', () => {});

  try {
    await postgres.verifyConnection();
    await redis.connect();
    await redisVerifier.connect();
    await redisVerifier.del(STREAM);

    await provePoolPressure(postgres);

    const loadIds = await insertOutboxLoad(postgres, LOAD_COUNT);
    const load = await drainWorker(postgres, redis, 'resilience-load-worker');
    assert.equal(load.published, LOAD_COUNT);
    assert.ok(load.cycles >= Math.ceil(LOAD_COUNT / LOAD_BATCH_SIZE));
    assert.equal(
      await scalarCount(postgres, `SELECT count(*) AS count FROM outbox_events WHERE id = ANY($1::uuid[]) AND published_at IS NOT NULL`, [loadIds]),
      LOAD_COUNT
    );

    const loadEntries = await redisVerifier.xRange(STREAM, '-', '+');
    assert.equal(loadEntries.length, LOAD_COUNT);
    assert.equal(new Set(loadEntries.map((entry) => entry.message.eventId)).size, LOAD_COUNT);
    assert.ok(loadEntries.every((entry) => entry.message.tenantId === TENANT_ID && entry.message.purpose === PURPOSE));

    await proveWorkerRestartRecovery(postgres, redis);
    await proveIdempotencyCrashFence(postgres);
    await proveCommittedWithoutReplayStaysFailClosed(postgres);
    await proveReplayAndExactReconciliation(postgres);

    const finalEntries = await redisVerifier.xRange(STREAM, '-', '+');
    assert.equal(finalEntries.length, LOAD_COUNT + 2);

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      poolMax: 2,
      concurrentPoolProbes: 20,
      outboxLoadMessages: LOAD_COUNT,
      outboxLoadBatchSize: LOAD_BATCH_SIZE,
      outboxUniqueDeliveryVerified: true,
      workerRestartRecoveryVerified: true,
      activeLeaseFencingVerified: true,
      crashReservationFailClosedVerified: true,
      committedWithoutReplayFailClosedVerified: true,
      reconciliationAlertVerified: true,
      completedReplaySurvivesRestart: true,
      exactFenceReconciliationVerified: true
    }) + '\n');
  } finally {
    if (redisVerifier.isOpen) redisVerifier.destroy();
    await Promise.allSettled([redis.close(), postgres.close()]);
  }
}

await run();
