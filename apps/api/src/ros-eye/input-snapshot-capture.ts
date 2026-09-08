import { createHash } from 'node:crypto';
import type { AuthoritativeRevisionBinding, SafetyFusionInputSnapshot } from '@ros/contracts';
import type { ContactSqlConnectionPort, ContactSqlPoolPort } from './contact-orchestration-postgres.js';
import {
  PostgresInputSnapshotRepository,
  type InputSnapshotCaptureDisposition,
  type InputSnapshotScope
} from './input-snapshot-postgres.js';

export interface AuthoritativeRevisionReceipt extends AuthoritativeRevisionBinding {
  readonly authority: 'SOURCE_LEDGER';
}

export type AuthoritativeContactReceipt =
  | { readonly status: 'ABSENT' }
  | { readonly status: 'PRESENT'; readonly binding: AuthoritativeRevisionReceipt };

export interface AuthoritativeRevisionSourcePort {
  load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeRevisionReceipt | null>;
}

export interface AuthoritativeContactSourcePort {
  load(connection: ContactSqlConnectionPort, scope: InputSnapshotScope): Promise<AuthoritativeContactReceipt | null>;
}

export interface AuthoritativeInputSnapshotSources {
  readonly case: AuthoritativeRevisionSourcePort;
  readonly severity: AuthoritativeRevisionSourcePort;
  readonly contact: AuthoritativeContactSourcePort;
  readonly evidence: AuthoritativeRevisionSourcePort;
  readonly indicators: AuthoritativeRevisionSourcePort;
}

export interface CaptureAuthoritativeInputSnapshotRequest extends InputSnapshotScope {
  readonly inputVersion: number;
  readonly expectedPreviousInputVersion: number;
  readonly capturedAt: string;
}

export type AuthoritativeInputSnapshotCaptureDisposition = InputSnapshotCaptureDisposition | 'SOURCE_UNAVAILABLE';

export const AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL =
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ WRITE' as const;

/**
 * Reads module-owned revision receipts and appends their snapshot on one SQL
 * transaction. The service cannot collect data or mutate source modules.
 */
export class AuthoritativeInputSnapshotCaptureService {
  private readonly repository: PostgresInputSnapshotRepository;

  constructor(
    private readonly pool: ContactSqlPoolPort,
    private readonly sources: AuthoritativeInputSnapshotSources
  ) {
    this.repository = new PostgresInputSnapshotRepository(pool);
  }

  async capture(request: CaptureAuthoritativeInputSnapshotRequest): Promise<AuthoritativeInputSnapshotCaptureDisposition> {
    validateCaptureRequest(request);
    return this.pool.transaction(async (connection) => {
      await connection.query(AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL);
      // Sequential reads are deliberate: one PostgreSQL connection must not run
      // overlapping queries, and all receipts share its transaction snapshot.
      const caseReceipt = await this.sources.case.load(connection, request);
      if (!validReceipt(caseReceipt)) return 'SOURCE_UNAVAILABLE';
      const severityReceipt = await this.sources.severity.load(connection, request);
      if (!validReceipt(severityReceipt)) return 'SOURCE_UNAVAILABLE';
      const contactReceipt = await this.sources.contact.load(connection, request);
      if (!validContactReceipt(contactReceipt)) return 'SOURCE_UNAVAILABLE';
      const evidenceReceipt = await this.sources.evidence.load(connection, request);
      if (!validReceipt(evidenceReceipt)) return 'SOURCE_UNAVAILABLE';
      const indicatorReceipt = await this.sources.indicators.load(connection, request);
      if (!validReceipt(indicatorReceipt)) return 'SOURCE_UNAVAILABLE';

      const snapshot = createSnapshot(request, {
        case: stripAuthority(caseReceipt),
        severity: stripAuthority(severityReceipt),
        contact: contactReceipt.status === 'ABSENT' ? null : stripAuthority(contactReceipt.binding),
        evidence: stripAuthority(evidenceReceipt),
        indicators: stripAuthority(indicatorReceipt)
      });

      return this.repository.captureWithin(connection, {
        tenantId: request.tenantId,
        purpose: request.purpose,
        caseId: request.caseId,
        expectedPreviousInputVersion: request.expectedPreviousInputVersion,
        snapshot
      });
    });
  }
}

function createSnapshot(
  request: CaptureAuthoritativeInputSnapshotRequest,
  revisions: Omit<SafetyFusionInputSnapshot, 'policyVersion' | 'tenantId' | 'caseId' | 'inputVersion' | 'capturedAt' | 'snapshotDigest'>
): SafetyFusionInputSnapshot {
  const material = {
    policyVersion: 'ros-eye.input-snapshot.v1' as const,
    tenantId: request.tenantId,
    caseId: request.caseId,
    inputVersion: request.inputVersion,
    capturedAt: new Date(request.capturedAt).toISOString(),
    ...revisions
  };
  return Object.freeze({
    ...material,
    snapshotDigest: createHash('sha256').update(canonicalize(material), 'utf8').digest('hex')
  });
}

function stripAuthority(receipt: AuthoritativeRevisionReceipt): AuthoritativeRevisionBinding {
  return Object.freeze({ revision: receipt.revision, digest: receipt.digest });
}

function validReceipt(receipt: AuthoritativeRevisionReceipt | null): receipt is AuthoritativeRevisionReceipt {
  return receipt !== null && receipt.authority === 'SOURCE_LEDGER' && Number.isSafeInteger(receipt.revision) &&
    receipt.revision > 0 && /^[a-f0-9]{64}$/.test(receipt.digest);
}

function validContactReceipt(receipt: AuthoritativeContactReceipt | null): receipt is AuthoritativeContactReceipt {
  return receipt !== null && (receipt.status === 'ABSENT' ||
    (receipt.status === 'PRESENT' && validReceipt(receipt.binding)));
}

function validateCaptureRequest(request: CaptureAuthoritativeInputSnapshotRequest): void {
  for (const [field, value] of [['tenantId', request.tenantId], ['purpose', request.purpose]] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.caseId)) {
    throw new TypeError('caseId must be a UUID');
  }
  if (!Number.isSafeInteger(request.inputVersion) || request.inputVersion < 1) throw new TypeError('inputVersion is invalid');
  if (!Number.isSafeInteger(request.expectedPreviousInputVersion) || request.expectedPreviousInputVersion < 0) {
    throw new TypeError('expectedPreviousInputVersion is invalid');
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(request.capturedAt) || !Number.isFinite(Date.parse(request.capturedAt))) {
    throw new TypeError('capturedAt is invalid');
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
}
