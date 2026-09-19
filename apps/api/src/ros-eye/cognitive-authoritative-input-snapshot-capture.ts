import type { ContactSqlConnectionPort, ContactSqlPoolPort } from './contact-orchestration-postgres.js';
import {
  CognitiveRoadStateSnapshotAdapter,
  type CognitiveRoadStateInputBinding,
  type CognitiveRoadStateOwnerPort,
  type OwnedCognitiveRoadStateRevision
} from './cognitive-road-state-snapshot-adapter.js';
import { PostgresCognitiveInputSnapshotRepository } from './cognitive-input-snapshot-postgres.js';
import {
  AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL,
  AuthoritativeInputSnapshotCaptureService,
  type AuthoritativeInputSnapshotCaptureDisposition,
  type AuthoritativeInputSnapshotSources,
  type CaptureAuthoritativeInputSnapshotRequest
} from './input-snapshot-capture.js';
import { PostgresInputSnapshotRepository, type InputSnapshotScope } from './input-snapshot-postgres.js';

export interface TransactionalCognitiveRoadStateOwnerPort {
  load(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope
  ): Promise<OwnedCognitiveRoadStateRevision | null>;
}

export interface TransactionalCognitiveInputSourcePort {
  load(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope,
    capturedAt: string
  ): Promise<CognitiveRoadStateInputBinding | null>;
}

/** Keeps the Cognitive Road State owner read on the capture transaction connection. */
export class TransactionalCognitiveRoadStateSnapshotSource implements TransactionalCognitiveInputSourcePort {
  constructor(private readonly owner: TransactionalCognitiveRoadStateOwnerPort) {}

  async load(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope,
    capturedAt: string
  ): Promise<CognitiveRoadStateInputBinding | null> {
    const transactionOwner: CognitiveRoadStateOwnerPort = {
      load: (trustedScope) => this.owner.load(connection, trustedScope)
    };
    return new CognitiveRoadStateSnapshotAdapter(transactionOwner).load(scope, capturedAt);
  }
}

class AtomicCognitiveCaptureAbort extends Error {
  constructor(readonly disposition: AuthoritativeInputSnapshotCaptureDisposition) {
    super(`atomic cognitive capture aborted: ${disposition}`);
  }
}

/**
 * Captures all v1 owner receipts plus the required cognitive v2 extension in
 * one repeatable-read transaction. No source state is copied or mutated.
 */
export class CognitiveAuthoritativeInputSnapshotCaptureService {
  private readonly baseBuilder: AuthoritativeInputSnapshotCaptureService;
  private readonly baseRepository: PostgresInputSnapshotRepository;
  private readonly cognitiveRepository: PostgresCognitiveInputSnapshotRepository;

  constructor(
    private readonly pool: ContactSqlPoolPort,
    sources: AuthoritativeInputSnapshotSources,
    private readonly cognitiveSource: TransactionalCognitiveInputSourcePort
  ) {
    this.baseBuilder = new AuthoritativeInputSnapshotCaptureService(pool, sources);
    this.baseRepository = new PostgresInputSnapshotRepository(pool);
    this.cognitiveRepository = new PostgresCognitiveInputSnapshotRepository(pool);
  }

  async capture(request: CaptureAuthoritativeInputSnapshotRequest): Promise<AuthoritativeInputSnapshotCaptureDisposition> {
    try {
      return await this.pool.transaction(async (connection) => {
        await connection.query(AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL);
        const snapshot = await this.baseBuilder.buildWithin(connection, request);
        if (snapshot === null) return 'SOURCE_UNAVAILABLE';

        const binding = await this.cognitiveSource.load(connection, request, snapshot.capturedAt);
        if (binding === null) return 'SOURCE_UNAVAILABLE';

        const baseDisposition = await this.baseRepository.captureWithin(connection, {
          tenantId: request.tenantId,
          purpose: request.purpose,
          caseId: request.caseId,
          expectedPreviousInputVersion: request.expectedPreviousInputVersion,
          snapshot
        });
        if (baseDisposition === 'CONFLICT' || baseDisposition === 'NOT_FOUND') return baseDisposition;

        const cognitiveDisposition = await this.cognitiveRepository.captureWithin(connection, {
          tenantId: request.tenantId,
          purpose: request.purpose,
          caseId: request.caseId,
          inputVersion: snapshot.inputVersion,
          baseSnapshotDigest: snapshot.snapshotDigest,
          binding
        });

        if (baseDisposition === 'CREATED' && cognitiveDisposition !== 'CREATED') {
          // Returning would commit the new v1 base without its required v2
          // extension. Throwing forces the pool boundary to roll it back.
          throw new AtomicCognitiveCaptureAbort(cognitiveDisposition);
        }
        if (cognitiveDisposition === 'CONFLICT' || cognitiveDisposition === 'NOT_FOUND') return cognitiveDisposition;
        return baseDisposition === 'CREATED' || cognitiveDisposition === 'CREATED' ? 'CREATED' : 'IDEMPOTENT';
      });
    } catch (error) {
      if (error instanceof AtomicCognitiveCaptureAbort) return error.disposition;
      throw error;
    }
  }
}
