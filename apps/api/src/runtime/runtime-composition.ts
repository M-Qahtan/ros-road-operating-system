import { RoadEventApplicationService } from '../application/road-event-application.js';
import { IdempotencyPort } from '../application/ports.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { PostgresRoadEventRepository } from '../persistence/postgres/postgres-road-event-repository.js';
import {
  PostgresAuditTimelineAdapter,
  PostgresIdempotencyAdapter,
  PostgresSignalAttachmentAdapter
} from '../persistence/postgres/postgres-road-event-support.js';
import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import { RoadEventRepository } from '@ros/domain';

export interface RoadEventRuntimeComposition {
  readonly application: RoadEventApplicationService;
  readonly repository: RoadEventRepository;
  readonly idempotency: IdempotencyPort;
}

function isMemoryRuntimeAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'development' || nodeEnvironment === 'test') return true;

  const runtimeProfile = (environment.ROS_RUNTIME_PROFILE ?? '').trim().toLowerCase();
  return nodeEnvironment !== 'production' && runtimeProfile === 'simulation';
}

/**
 * Composes the RoadEvent command/read path entirely from PostgreSQL-backed
 * persistence ports. The concrete network driver is intentionally injected so
 * production connection/TLS/credential policy remains outside domain code.
 */
export function createPersistentRoadEventApplication(
  postgresPool: PostgresPool
): RoadEventApplicationService {
  return createPersistentRoadEventRuntimeComposition(postgresPool).application;
}

export function createPersistentRoadEventRuntimeComposition(
  postgresPool: PostgresPool
): RoadEventRuntimeComposition {
  const repository = new PostgresRoadEventRepository(postgresPool);
  const idempotency = new PostgresIdempotencyAdapter(postgresPool);
  return {
    repository,
    idempotency,
    application: new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    idempotency,
    new PostgresSignalAttachmentAdapter(postgresPool),
    new PostgresAuditTimelineAdapter(postgresPool)
    )
  };
}

/**
 * Builds the current local/simulation runtime composition.
 *
 * Memory-backed adapters are allowed implicitly only in development/test.
 * A non-production staging environment may opt into them only through the
 * explicit `ROS_RUNTIME_PROFILE=simulation` profile used by deterministic CI.
 * Production is never allowed to select the in-memory composition.
 *
 * A production entrypoint must construct a verified concrete PostgresPool and
 * call `createPersistentRoadEventApplication`; until that driver is wired,
 * `main.ts` fails closed instead of silently serving process-memory state.
 */
export function createRoadEventApplicationForRuntime(
  environment: NodeJS.ProcessEnv
): RoadEventApplicationService {
  return createRoadEventRuntimeComposition(environment).application;
}

export function createRoadEventRuntimeComposition(
  environment: NodeJS.ProcessEnv
): RoadEventRuntimeComposition {
  if (!isMemoryRuntimeAllowed(environment)) {
    throw new Error(
      'Persistent runtime adapters are required; refusing implicit in-memory fallback'
    );
  }

  const repository = new MemoryRoadEventRepository();
  const idempotency = new MemoryIdempotencyAdapter();
  return {
    repository,
    idempotency,
    application: new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    idempotency,
    new MemorySignalAttachmentAdapter(repository),
    repository
    )
  };
}
