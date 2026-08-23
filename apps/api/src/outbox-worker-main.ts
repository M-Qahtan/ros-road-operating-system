import { createNodeRedisStreamClient } from './messaging/node-redis-stream-client.js';
import { createNodePostgresPool } from './persistence/postgres/pg-postgres-pool.js';
import { createOutboxWorkerRuntime } from './runtime/outbox-worker-runtime.js';

const postgres = createNodePostgresPool(process.env);
const redis = createNodeRedisStreamClient(process.env);
const stop = new AbortController();

process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());

try {
  await postgres.verifyConnection();
  await redis.connect();
  const worker = createOutboxWorkerRuntime(postgres, redis, process.env);
  await worker.run(stop.signal);
} finally {
  await Promise.allSettled([redis.close(), postgres.close()]);
}
