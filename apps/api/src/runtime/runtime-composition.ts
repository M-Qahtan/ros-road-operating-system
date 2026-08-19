import { RoadEventApplicationService } from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';

function isMemoryRuntimeAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'development' || nodeEnvironment === 'test') return true;

  const runtimeProfile = (environment.ROS_RUNTIME_PROFILE ?? '').trim().toLowerCase();
  return nodeEnvironment !== 'production' && runtimeProfile === 'simulation';
}

/**
 * Builds the current local runtime composition.
 *
 * Memory-backed adapters are allowed implicitly only in development/test.
 * A non-production staging environment may opt into them only through the
 * explicit `ROS_RUNTIME_PROFILE=simulation` profile used by deterministic CI.
 * Production is never allowed to select the in-memory composition.
 *
 * Until PostgreSQL/Redis/object-storage runtime clients are wired here,
 * production startup fails closed instead of silently serving process memory.
 */
export function createRoadEventApplicationForRuntime(
  environment: NodeJS.ProcessEnv
): RoadEventApplicationService {
  if (!isMemoryRuntimeAllowed(environment)) {
    throw new Error(
      'Persistent runtime adapters are required; refusing implicit in-memory fallback'
    );
  }

  const repository = new MemoryRoadEventRepository();
  return new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(),
    repository
  );
}
