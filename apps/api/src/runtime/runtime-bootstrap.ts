import { RoadEventApplicationService } from '../application/road-event-application.js';
import { fileURLToPath } from 'node:url';
import { IdempotencyPort } from '../application/ports.js';
import { RoadEventRepository } from '@ros/domain';
import { RedisRuntimeClient, createNodeRedisStreamClient } from '../messaging/node-redis-stream-client.js';
import { PgRuntimePool, createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { runPostgresMigrations } from '../persistence/postgres/migration-runner.js';
import { evaluateReadiness, ReadinessResult, RuntimeReadinessProbes } from './operational-readiness.js';
import {
  createPersistentRoadEventRuntimeComposition,
  createRoadEventRuntimeComposition
} from './runtime-composition.js';

export interface RuntimeBootstrapResult {
  readonly application: RoadEventApplicationService;
  readonly roadEvents: RoadEventRepository;
  readonly idempotency: IdempotencyPort;
  readonly postgres: PgRuntimePool | null;
  readonly mode: 'simulation' | 'persistent';
  readonly redis: RedisRuntimeClient | null;
  readonly readiness: (additionalProbes?: Pick<RuntimeReadinessProbes, 'objectStorage'>) => Promise<ReadinessResult>;
  close(): Promise<void>;
}

export interface RuntimeBootstrapDependencies {
  readonly createPostgresPool?: (environment: NodeJS.ProcessEnv) => PgRuntimePool;
  readonly createRedisClient?: (environment: NodeJS.ProcessEnv) => RedisRuntimeClient;
  readonly migrationsDirectory?: string;
  readonly runMigrations?: typeof runPostgresMigrations;
}

export class RuntimeBootstrapError extends Error {
  override readonly name = 'RuntimeBootstrapError';
}

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../../../database/migrations/', import.meta.url)
);

function nodeEnvironment(environment: NodeJS.ProcessEnv): string {
  return (environment.NODE_ENV ?? 'development').trim().toLowerCase();
}

function simulationAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnv = nodeEnvironment(environment);
  if (nodeEnv === 'development' || nodeEnv === 'test') return true;
  const profile = (environment.ROS_RUNTIME_PROFILE ?? '').trim().toLowerCase();
  return nodeEnv !== 'production' && profile === 'simulation';
}

function persistentRequired(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnv = nodeEnvironment(environment);
  const profile = (environment.ROS_RUNTIME_PROFILE ?? '').trim().toLowerCase();
  return nodeEnv === 'production' || profile === 'persistent';
}

async function closeQuietly(resource: { close(): Promise<void> } | undefined): Promise<void> {
  if (resource === undefined) return;
  try {
    await resource.close();
  } catch {
    // Startup failure remains the primary error. Shutdown telemetry can report
    // close failures after the process has a fully initialized logger.
  }
}

/**
 * Creates the process-level RoadEvent runtime.
 *
 * Development/test and an explicit non-production simulation profile retain the
 * deterministic in-memory composition. Production (and any explicit persistent
 * profile) must successfully initialize the authenticated PostgreSQL schema and
 * Redis client before the API is allowed to listen. When Evidence is composed,
 * main supplies its authenticated Object Storage probe to the readiness call.
 */
export async function bootstrapRoadEventRuntime(
  environment: NodeJS.ProcessEnv,
  dependencies: RuntimeBootstrapDependencies = {}
): Promise<RuntimeBootstrapResult> {
  if (simulationAllowed(environment)) {
    const composition = createRoadEventRuntimeComposition(environment);
    return {
      application: composition.application,
      roadEvents: composition.repository,
      idempotency: composition.idempotency,
      postgres: null,
      mode: 'simulation',
      redis: null,
      readiness: (additionalProbes = {}) => evaluateReadiness(additionalProbes),
      close: async () => {}
    };
  }

  if (!persistentRequired(environment)) {
    throw new RuntimeBootstrapError(
      'Non-simulation runtime must set ROS_RUNTIME_PROFILE=persistent'
    );
  }

  const postgresFactory = dependencies.createPostgresPool ?? createNodePostgresPool;
  const redisFactory = dependencies.createRedisClient ?? createNodeRedisStreamClient;
  const migrationRunner = dependencies.runMigrations ?? runPostgresMigrations;
  const migrationsDirectory = dependencies.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY;
  const postgres = postgresFactory(environment);
  let redis: RedisRuntimeClient | undefined;

  try {
    // The migration ledger and source checksums are authoritative. Migrations
    // must complete before schema readiness is evaluated or Redis is started.
    await migrationRunner(postgres, migrationsDirectory);
    await postgres.verifyReadiness();
    redis = redisFactory(environment);
    await redis.connect();
    await redis.verifyConnection();
  } catch {
    await closeQuietly(redis);
    await closeQuietly(postgres);
    throw new RuntimeBootstrapError(
      'Persistent runtime dependencies or schema could not be initialized; refusing API startup'
    );
  }

  let closed = false;
  const composition = createPersistentRoadEventRuntimeComposition(postgres);
  return {
    application: composition.application,
    roadEvents: composition.repository,
    idempotency: composition.idempotency,
    postgres,
    mode: 'persistent',
    redis,
    readiness: (additionalProbes = {}) => evaluateReadiness({
      database: () => postgres.verifyReadiness(),
      redis: () => redis!.verifyConnection(),
      ...additionalProbes
    }),
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const outcomes = await Promise.allSettled([redis!.close(), postgres.close()]);
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      if (failures.length > 0) {
        throw new RuntimeBootstrapError('One or more persistent runtime resources failed to close cleanly');
      }
    }
  };
}
