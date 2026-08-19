import { RoadEventApplicationService } from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';

function isMemoryRuntimeAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  return nodeEnvironment === 'development' || nodeEnvironment === 'test';
}

/**
 * Builds the current local runtime composition.
 *
 * Memory-backed adapters are intentionally restricted to development and test.
 * Until the persistent PostgreSQL/Redis/object-storage composition is wired,
 * non-development startup must fail closed instead of silently serving data
 * from process memory.
 */
export function createRoadEventApplicationForRuntime(
  environment: NodeJS.ProcessEnv
): RoadEventApplicationService {
  if (!isMemoryRuntimeAllowed(environment)) {
    throw new Error(
      'Persistent runtime adapters are required outside development/test; refusing in-memory fallback'
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
