import { createNodeRedisStreamClient } from './messaging/node-redis-stream-client.js';
import { createNodePostgresPool } from './persistence/postgres/pg-postgres-pool.js';
import { createOutboxWorkerRuntime } from './runtime/outbox-worker-runtime.js';
import { resolveWorkerRuntimeEnvironment } from './runtime/worker-runtime-identity.js';

const workerEnvironment = await resolveWorkerRuntimeEnvironment(process.env, ['outbox']);
const postgres = createNodePostgresPool(process.env);
const redis = createNodeRedisStreamClient(process.env);
const stop = new AbortController();

process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());

try {
  await postgres.verifyConnection();
  await redis.connect();
  const worker = createOutboxWorkerRuntime(postgres, redis, workerEnvironment);
  await worker.run(stop.signal);
} finally {
  await Promise.allSettled([redis.close(), postgres.close()]);
}
