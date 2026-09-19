import type { ContactSqlPoolPort } from './contact-orchestration-postgres.js';
import { PostgresContactRevisionSource } from './contact-revision-source-postgres.js';
import { PostgresEvidenceRevisionSource } from '../evidence/evidence-revision-source-postgres.js';
import { PostgresHumanSafetyIndicatorSource } from './human-safety-indicator-source-postgres.js';
import {
  CognitiveAuthoritativeInputSnapshotCaptureService,
  TransactionalCognitiveRoadStateSnapshotSource,
  type TransactionalCognitiveRoadStateOwnerPort
} from './cognitive-authoritative-input-snapshot-capture.js';
import { AuthoritativeInputSnapshotCaptureService } from './input-snapshot-capture.js';
import { PostgresRoadEventRevisionSource } from './road-event-revision-source-postgres.js';

/**
 * Production composition root for read-only, module-owned input receipts.
 * It grants no source mutation, collection, recommendation persistence, or
 * operational authority.
 */
export function createPostgresAuthoritativeInputSnapshotCaptureService(
  pool: ContactSqlPoolPort
): AuthoritativeInputSnapshotCaptureService {
  return new AuthoritativeInputSnapshotCaptureService(pool, postgresSources());
}

export function createPostgresCognitiveAuthoritativeInputSnapshotCaptureService(
  pool: ContactSqlPoolPort,
  cognitiveOwner: TransactionalCognitiveRoadStateOwnerPort
): CognitiveAuthoritativeInputSnapshotCaptureService {
  return new CognitiveAuthoritativeInputSnapshotCaptureService(
    pool,
    postgresSources(),
    new TransactionalCognitiveRoadStateSnapshotSource(cognitiveOwner)
  );
}

function postgresSources() {
  return Object.freeze({
    case: new PostgresRoadEventRevisionSource('CASE'),
    severity: new PostgresRoadEventRevisionSource('SEVERITY'),
    contact: new PostgresContactRevisionSource(),
    evidence: new PostgresEvidenceRevisionSource(),
    indicators: new PostgresHumanSafetyIndicatorSource()
  });
}
