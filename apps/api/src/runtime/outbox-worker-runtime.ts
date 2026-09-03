import { OutboxRunResult, OutboxWorker } from '../messaging/outbox-worker.js';
import { PostgresOutboxRepository } from '../messaging/postgres-outbox-repository.js';
import { RedisStreamEventBroker } from '../messaging/redis-stream-broker.js';
import { RedisRuntimeClient } from '../messaging/node-redis-stream-client.js';
import { PgRuntimePool } from '../persistence/postgres/pg-postgres-pool.js';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LOCK_DURATION_MS = 30_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 5_000;
const DEFAULT_MAXIMUM_ATTEMPTS = 8;
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const DEFAULT_MAXIMUM_RETRY_DELAY_MS = 30_000;
const DEFAULT_IDLE_POLL_MS = 250;

export interface OutboxRuntimeOptions {
  readonly workerId: string;
  readonly stream: string;
  readonly batchSize: number;
  readonly lockDurationMs: number;
  readonly publishTimeoutMs: number;
  readonly maximumAttempts: number;
  readonly baseRetryDelayMs: number;
  readonly maximumRetryDelayMs: number;
  readonly idlePollMs: number;
}

export class OutboxRuntimeConfigurationError extends Error {
  override readonly name = 'OutboxRuntimeConfigurationError';
}

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new OutboxRuntimeConfigurationError(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OutboxRuntimeConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function requiredText(environment: NodeJS.ProcessEnv, name: string, maximum: number): string {
  const value = environment[name]?.trim();
  if (!value || value.length > maximum) {
    throw new OutboxRuntimeConfigurationError(`${name} must contain between 1 and ${maximum} characters`);
  }
  return value;
}

export function readOutboxRuntimeOptions(environment: NodeJS.ProcessEnv): OutboxRuntimeOptions {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const workerId = environment.ROS_OUTBOX_WORKER_ID?.trim();
  if ((nodeEnvironment === 'production' || nodeEnvironment === 'staging') && !workerId) {
    throw new OutboxRuntimeConfigurationError('ROS_OUTBOX_WORKER_ID is required outside development/test');
  }

  const options: OutboxRuntimeOptions = {
    workerId: workerId || 'local-outbox-worker',
    stream: (environment.ROS_OUTBOX_STREAM ?? 'ros:integration-events').trim(),
    batchSize: boundedInteger(environment, 'ROS_OUTBOX_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1, 100),
    lockDurationMs: boundedInteger(
      environment,
      'ROS_OUTBOX_LOCK_DURATION_MS',
      DEFAULT_LOCK_DURATION_MS,
      1_000,
      60 * 60 * 1_000
    ),
    publishTimeoutMs: boundedInteger(
      environment,
      'ROS_OUTBOX_PUBLISH_TIMEOUT_MS',
      DEFAULT_PUBLISH_TIMEOUT_MS,
      100,
      60_000
    ),
    maximumAttempts: boundedInteger(
      environment,
      'ROS_OUTBOX_MAXIMUM_ATTEMPTS',
      DEFAULT_MAXIMUM_ATTEMPTS,
      1,
      100
    ),
    baseRetryDelayMs: boundedInteger(
      environment,
      'ROS_OUTBOX_BASE_RETRY_DELAY_MS',
      DEFAULT_BASE_RETRY_DELAY_MS,
      10,
      60_000
    ),
    maximumRetryDelayMs: boundedInteger(
      environment,
      'ROS_OUTBOX_MAXIMUM_RETRY_DELAY_MS',
      DEFAULT_MAXIMUM_RETRY_DELAY_MS,
      10,
      60 * 60 * 1_000
    ),
    idlePollMs: boundedInteger(environment, 'ROS_OUTBOX_IDLE_POLL_MS', DEFAULT_IDLE_POLL_MS, 25, 60_000)
  };

  if (!options.stream || options.stream.length > 256) {
    throw new OutboxRuntimeConfigurationError('ROS_OUTBOX_STREAM must contain between 1 and 256 characters');
  }
  if (options.baseRetryDelayMs > options.maximumRetryDelayMs) {
    throw new OutboxRuntimeConfigurationError(
      'ROS_OUTBOX_BASE_RETRY_DELAY_MS cannot exceed ROS_OUTBOX_MAXIMUM_RETRY_DELAY_MS'
    );
  }
  if (options.publishTimeoutMs + 1_000 > options.lockDurationMs) {
    throw new OutboxRuntimeConfigurationError(
      'ROS_OUTBOX_PUBLISH_TIMEOUT_MS must leave at least 1000ms inside ROS_OUTBOX_LOCK_DURATION_MS'
    );
  }
  return options;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class OutboxWorkerRuntime {
  private readonly worker: OutboxWorker;
  private readonly idlePollMs: number;

  constructor(
    private readonly postgres: PgRuntimePool,
    private readonly redis: RedisRuntimeClient,
    options: OutboxRuntimeOptions
  ) {
    const repository = new PostgresOutboxRepository(postgres);
    const broker = new RedisStreamEventBroker(redis, options.stream, false);
    this.worker = new OutboxWorker(repository, broker, {
      workerId: options.workerId,
      batchSize: options.batchSize,
      lockDurationMs: options.lockDurationMs,
      publishTimeoutMs: options.publishTimeoutMs,
      maximumAttempts: options.maximumAttempts,
      baseRetryDelayMs: options.baseRetryDelayMs,
      maximumRetryDelayMs: options.maximumRetryDelayMs
    });
    this.idlePollMs = options.idlePollMs;
  }

  async runOnce(): Promise<OutboxRunResult> {
    // Recover and verify Redis before PostgreSQL grants any outbox lease. XADD
    // is deliberately fail-fast after claim, so an intentional reconnect loop
    // cannot consume the row's ownership window. Delivery remains at-least-once:
    // eventId and consumer-side durable idempotency fence duplicate effects.
    await this.redis.verifyConnection();
    return this.worker.runOnce();
  }
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.redis.verifyConnection(signal);
      } catch (error) {
        if (signal.aborted) return;
        // A simultaneous PostgreSQL failure must retain the required-worker
        // fail-stop behavior instead of being hidden behind Redis recovery.
        await this.postgres.verifyConnection();
        await delay(this.idlePollMs, signal);
        continue;
      }
      if (signal.aborted) return;
      // Do not catch claim or publish bookkeeping errors here. PostgreSQL loss
      // and ownership conflicts remain fatal to the required worker process.
      let result: OutboxRunResult;
      try {
        result = await this.worker.runOnce(signal);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (result.claimed === 0) await delay(this.idlePollMs, signal);
    }
  }
}

export function createOutboxWorkerRuntime(
  postgres: PgRuntimePool,
  redis: RedisRuntimeClient,
  environment: NodeJS.ProcessEnv
): OutboxWorkerRuntime {
  return new OutboxWorkerRuntime(postgres, redis, readOutboxRuntimeOptions(environment));
}
