import { RoadEventApplicationService } from '../application/road-event-application.js';
import { RedisRuntimeClient, createNodeRedisStreamClient } from '../messaging/node-redis-stream-client.js';
import { PgRuntimePool, createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { evaluateReadiness, ReadinessResult } from './operational-readiness.js';
import {
  createPersistentRoadEventApplication,
  createRoadEventApplicationForRuntime
} from './runtime-composition.js';

export interface RuntimeBootstrapResult {
  readonly application: RoadEventApplicationService;
  readonly mode: 'simulation' | 'persistent';
  readonly redis: RedisRuntimeClient | null;
  readonly readiness: () => Promise<ReadinessResult>;
  close(): Promise<void>;
}

export interface RuntimeBootstrapDependencies {
  readonly createPostgresPool?: (environment: NodeJS.ProcessEnv) => PgRuntimePool;
  readonly createRedisClient?: (environment: NodeJS.ProcessEnv) => RedisRuntimeClient;
}

export class RuntimeBootstrapError extends Error {
  override readonly name = 'RuntimeBootstrapError';
}

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
 * Redis client before the API is allowed to listen. Evidence/Object Storage
 * remains a separately activated dependency and release gate until its HTTP/API
 * surface and production malware scanner are approved.
 */
export async function bootstrapRoadEventRuntime(
  environment: NodeJS.ProcessEnv,
  dependencies: RuntimeBootstrapDependencies = {}
): Promise<RuntimeBootstrapResult> {
  if (simulationAllowed(environment)) {
    return {
      application: createRoadEventApplicationForRuntime(environment),
      mode: 'simulation',
      redis: null,
      readiness: () => evaluateReadiness({}),
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
  const postgres = postgresFactory(environment);
  let redis: RedisRuntimeClient | undefined;

  try {
    redis = redisFactory(environment);
    await postgres.verifyReadiness();
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
  return {
    application: createPersistentRoadEventApplication(postgres),
    mode: 'persistent',
    redis,
    readiness: () => evaluateReadiness({
      database: () => postgres.verifyReadiness(),
      redis: () => redis!.verifyConnection()
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
