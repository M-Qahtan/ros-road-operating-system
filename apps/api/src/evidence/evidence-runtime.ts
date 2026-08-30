import { RoadEventRepository } from '@ros/domain';
import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import { EvidenceService } from './evidence-service.js';
import { EvidenceObjectStorage, MalwareScanner } from './evidence-types.js';
import {
  createEvidenceObjectStorageForRuntime,
  ObjectStorageCredentialProviderPort
} from './object-storage-runtime.js';
import { PostgresEvidenceRepository } from './postgres-evidence-repository.js';
import { SafeLocalMalwareScanner } from './safe-local-malware-scanner.js';
import { ScopedRoadEventEvidenceAuthorization } from './scoped-road-event-evidence-authorization.js';
import { FailClosedStagingMalwareScanner } from './fail-closed-staging-malware-scanner.js';
import { syntheticStagingEnabled } from '../runtime/synthetic-staging-profile.js';

export interface EvidenceRuntimeDependencies {
  readonly postgres: PostgresPool;
  readonly roadEvents: RoadEventRepository;
  readonly malwareScanner?: MalwareScanner;
  readonly objectStorage?: EvidenceObjectStorage;
  readonly credentialProvider?: ObjectStorageCredentialProviderPort;
  readonly fetchImpl?: typeof fetch;
}

export class EvidenceRuntimeCompositionError extends Error {
  override readonly name = 'EvidenceRuntimeCompositionError';
}

/**
 * Builds the EvidenceService dependency graph without exposing an HTTP surface.
 *
 * Production intentionally has no fallback malware scanner. A real scanner must
 * be injected before evidence can be composed into a production runtime. The
 * deterministic local scanner exists only for development/test/simulation.
 */
export function createEvidenceServiceForRuntime(
  environment: NodeJS.ProcessEnv,
  dependencies: EvidenceRuntimeDependencies
): EvidenceService {
  const production = (environment.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const syntheticStaging = syntheticStagingEnabled(environment);
  const quarantineAll = production && syntheticStaging &&
    environment.ROS_MALWARE_SCANNER_PROFILE?.trim() === 'quarantine-all';
  const scanner = dependencies.malwareScanner ?? (
    production
      ? quarantineAll ? new FailClosedStagingMalwareScanner() : undefined
      : new SafeLocalMalwareScanner()
  );
  if (scanner === undefined) {
    throw new EvidenceRuntimeCompositionError(
      'Production EvidenceService requires an injected malware scanner; SafeLocalMalwareScanner is simulation-only'
    );
  }

  const storage = dependencies.objectStorage ?? createEvidenceObjectStorageForRuntime(environment, {
    ...(dependencies.credentialProvider === undefined
      ? {}
      : { credentialProvider: dependencies.credentialProvider }),
    ...(dependencies.fetchImpl === undefined ? {} : { fetchImpl: dependencies.fetchImpl })
  });

  return new EvidenceService(
    new PostgresEvidenceRepository(dependencies.postgres),
    storage,
    scanner,
    new ScopedRoadEventEvidenceAuthorization(dependencies.roadEvents)
  );
}
