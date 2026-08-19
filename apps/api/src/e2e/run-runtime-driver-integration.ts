import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { createNodeRedisStreamClient } from '../messaging/node-redis-stream-client.js';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { createOutboxWorkerRuntime } from '../runtime/outbox-worker-runtime.js';

const OUTBOX_ID = '81111111-1111-4111-8111-111111111111';
const AGGREGATE_ID = '82222222-2222-4222-8222-222222222222';
const CORRELATION_ID = '83333333-3333-4333-8333-333333333333';
const STREAM = process.env.ROS_OUTBOX_STREAM ?? 'ros:integration-events';

interface PublishedRow {
  readonly published_at: Date | string | null;
  readonly locked_by: string | null;
  readonly locked_until: Date | string | null;
  readonly retry_count: number;
  readonly dead_lettered_at: Date | string | null;
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  const redis = createNodeRedisStreamClient(process.env);
  const redisVerifier = createClient({
    url: process.env.REDIS_URL,
    disableOfflineQueue: true
  });
  redisVerifier.on('error', () => {});

  try {
    await postgres.verifyConnection();
    await redis.connect();
    await redisVerifier.connect();
    await redisVerifier.del(STREAM);

    const client = await postgres.connect();
    try {
      await client.query(
        `DELETE FROM outbox_events WHERE id = $1::uuid`,
        [OUTBOX_ID]
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload,
           correlation_id, occurred_at
         ) VALUES ($1::uuid, 'RoadEvent', $2::uuid, 'RoadEventCreated',
                   $3::jsonb, $4::uuid, now())`,
        [OUTBOX_ID, AGGREGATE_ID, { source: 'runtime-driver-integration' }, CORRELATION_ID]
      );
    } finally {
      client.release();
    }

    const worker = createOutboxWorkerRuntime(postgres, redis, process.env);
    const result = await worker.runOnce();
    assert.deepEqual(result, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });

    const verificationClient = await postgres.connect();
    let row: PublishedRow | undefined;
    try {
      const query = await verificationClient.query<PublishedRow>(
        `SELECT published_at, locked_by, locked_until, retry_count, dead_lettered_at
           FROM outbox_events
          WHERE id = $1::uuid`,
        [OUTBOX_ID]
      );
      row = query.rows[0];
    } finally {
      verificationClient.release();
    }
    assert.ok(row?.published_at !== null && row?.published_at !== undefined);
    assert.equal(row?.locked_by, null);
    assert.equal(row?.locked_until, null);
    assert.equal(row?.retry_count, 0);
    assert.equal(row?.dead_lettered_at, null);

    const entries = await redisVerifier.xRange(STREAM, '-', '+');
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry?.message.eventId, OUTBOX_ID);
    assert.equal(entry?.message.simulationMode, 'false');
    assert.equal(entry?.message.deliveryMode, 'runtime');

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      claimed: result.claimed,
      published: result.published,
      redisStreamEntries: entries.length,
      outboxPublished: true,
      runtimeDeliveryMode: entry?.message.deliveryMode
    }) + '\n');
  } finally {
    if (redisVerifier.isOpen) redisVerifier.destroy();
    await Promise.allSettled([redis.close(), postgres.close()]);
  }
}

await run();
