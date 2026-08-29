import { createHash } from 'node:crypto';
import { AuthenticatedActor, IdempotencyInFlightError, IdempotencyPort } from '../application/ports.js';
import { ApplicationConflictError, IdempotencyConflictError } from '../application/road-event-application.js';
import { AuthorizationDeniedError } from '../application/local-adapters.js';
import {
  CreateEvidenceIntentInput,
  EvidenceUploadIntent
} from '../evidence/evidence-service.js';
import {
  EvidenceAccessDeniedError,
  EvidenceAccessPrincipal,
  EvidenceExpiredError,
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  EvidenceRecord,
  EvidenceUnavailableError,
  EvidenceValidationError,
  SignedObjectRequest
} from '../evidence/evidence-types.js';
import { ActorResolver } from './actor-resolver.js';
import { HttpRequest, HttpResponse } from './road-event-http.js';

export interface EvidenceHttpService {
  assertRoadEventAccess(roadEventId: string, principal: EvidenceAccessPrincipal, action: 'UPLOAD' | 'DOWNLOAD'): Promise<void>;
  getAuthorizedMetadata(evidenceId: string, principal: EvidenceAccessPrincipal, action: 'UPLOAD' | 'DOWNLOAD'): Promise<EvidenceRecord>;
  createUploadIntent(input: CreateEvidenceIntentInput): Promise<EvidenceUploadIntent>;
  completeUpload(evidenceId: string, principal: EvidenceAccessPrincipal, traceId: string): Promise<EvidenceRecord>;
  createDownloadRequest(evidenceId: string, principal: EvidenceAccessPrincipal, traceId: string): Promise<SignedObjectRequest>;
}

class EvidenceHttpError extends Error {
  override readonly name = 'EvidenceHttpError';
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function envelope(success: boolean, data: unknown, error: { readonly code: string; readonly message: string } | null, traceId: string) {
  return { success, data, error, traceId };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvidenceHttpError(400, 'INVALID_REQUEST', 'body must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maximum = 500): string {
  if (typeof value !== 'string') throw new EvidenceHttpError(400, 'INVALID_REQUEST', `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new EvidenceHttpError(400, 'INVALID_REQUEST', `${field} is invalid`);
  return normalized;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new EvidenceHttpError(400, 'INVALID_REQUEST', `${field} must be a positive integer`);
  return Number(value);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new EvidenceHttpError(400, 'INVALID_REQUEST', `${field} must be a boolean`);
  return value;
}

function requiredFutureDate(value: unknown, field: string, now: Date): Date {
  const raw = requiredString(value, field, 64);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime()) || parsed <= now) throw new EvidenceHttpError(400, 'INVALID_REQUEST', `${field} must be a future ISO timestamp`);
  return parsed;
}

function requireRole(actor: AuthenticatedActor, allowed: readonly AuthenticatedActor['roles'][number][]): void {
  if (!actor.roles.some((role) => allowed.includes(role))) throw new EvidenceHttpError(403, 'FORBIDDEN', 'Evidence authority is required');
}

function principal(actor: AuthenticatedActor): EvidenceAccessPrincipal {
  return { actorId: actor.actorId, tenantId: actor.tenantId, purpose: actor.purpose };
}

function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function idempotencyKey(request: HttpRequest): string {
  const key = requiredString(request.headers['idempotency-key'], 'Idempotency-Key', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new EvidenceHttpError(400, 'INVALID_REQUEST', 'Idempotency-Key is invalid');
  return key;
}

async function idempotent<T>(
  port: IdempotencyPort,
  actor: AuthenticatedActor,
  operationName: string,
  resourceId: string,
  key: string,
  input: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const scope = `evidence:${operationName}:${fingerprint([actor.tenantId, actor.purpose, actor.actorId, resourceId]).slice(0, 40)}`;
  const requestFingerprint = fingerprint(input);
  try {
    return await port.executeExclusively(scope, key, async () => {
      const replay = await port.get<T>(scope, key);
      if (replay !== undefined) {
        if (replay.fingerprint !== requestFingerprint) throw new IdempotencyConflictError('Idempotency key was reused with a different request');
        return replay.value;
      }
      const value = await operation();
      await port.put(scope, key, { fingerprint: requestFingerprint, value });
      return value;
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) throw new ApplicationConflictError(error.message);
    throw error;
  }
}

function mapError(error: unknown, traceId: string): HttpResponse {
  if (error instanceof EvidenceHttpError) return { status: error.status, body: envelope(false, null, { code: error.code, message: error.message }, traceId) };
  if (error instanceof AuthorizationDeniedError || error instanceof EvidenceAccessDeniedError) return { status: 403, body: envelope(false, null, { code: 'FORBIDDEN', message: 'Evidence access is not authorized' }, traceId) };
  if (error instanceof EvidenceNotFoundError) return { status: 404, body: envelope(false, null, { code: 'EVIDENCE_NOT_FOUND', message: error.message }, traceId) };
  if (error instanceof EvidenceExpiredError) return { status: 410, body: envelope(false, null, { code: 'UPLOAD_EXPIRED', message: error.message }, traceId) };
  if (error instanceof EvidenceIntegrityError) return { status: 422, body: envelope(false, null, { code: 'EVIDENCE_INTEGRITY_FAILED', message: error.message }, traceId) };
  if (error instanceof EvidenceUnavailableError) return { status: 409, body: envelope(false, null, { code: 'EVIDENCE_UNAVAILABLE', message: error.message }, traceId) };
  if (error instanceof EvidenceValidationError) return { status: 400, body: envelope(false, null, { code: 'VALIDATION_ERROR', message: error.message }, traceId) };
  if (error instanceof IdempotencyConflictError || error instanceof ApplicationConflictError) return { status: 409, body: envelope(false, null, { code: 'CONFLICT', message: error.message }, traceId) };
  return { status: 500, body: envelope(false, null, { code: 'INTERNAL_ERROR', message: 'Unexpected evidence error' }, traceId) };
}

export function createEvidenceHttpHandler(
  service: EvidenceHttpService | null,
  idempotency: IdempotencyPort,
  actorResolver: ActorResolver,
  now: () => Date = () => new Date()
): (request: HttpRequest) => Promise<HttpResponse | undefined> {
  return async (request) => {
    const upload = /^\/api\/v1\/road-events\/([0-9a-f-]+)\/evidence\/upload-intents$/.exec(request.path);
    const action = /^\/api\/v1\/evidence\/([0-9a-f-]+)\/(complete|download-intents)$/.exec(request.path);
    if (upload === null && action === null) return undefined;
    if (service === null) return { status: 503, body: envelope(false, null, { code: 'EVIDENCE_UNAVAILABLE', message: 'Persistent Evidence runtime is unavailable' }, request.traceId) };
    try {
      const actor = await actorResolver.resolve(request.headers);
      const access = principal(actor);
      if (upload !== null) {
        if (request.method !== 'POST') throw new EvidenceHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
        requireRole(actor, ['OPERATOR', 'SUPERVISOR', 'INTEGRATION_SERVICE']);
        const roadEventId = upload[1]!;
        const body = record(request.body);
        const evaluatedAt = now();
        const input = {
          roadEventId,
          principal: access,
          traceId: request.traceId,
          filename: requiredString(body.filename, 'filename', 255),
          contentType: requiredString(body.contentType, 'contentType', 128),
          sizeBytes: requiredInteger(body.sizeBytes, 'sizeBytes'),
          checksumSha256: requiredString(body.checksumSha256, 'checksumSha256', 64),
          retention: {
            retainUntil: requiredFutureDate(body.retainUntil, 'retainUntil', evaluatedAt),
            legalHold: requiredBoolean(body.legalHold, 'legalHold')
          }
        } satisfies CreateEvidenceIntentInput;
        // Resource authorization must precede every idempotency lookup.
        await service.assertRoadEventAccess(roadEventId, access, 'UPLOAD');
        const key = idempotencyKey(request);
        const result = await idempotent(idempotency, actor, 'upload-intent', roadEventId, key, input, () => service.createUploadIntent(input));
        return { status: 201, body: envelope(true, result, null, request.traceId) };
      }

      if (request.method !== 'POST') throw new EvidenceHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
      const evidenceId = action![1]!;
      const operationName = action![2]!;
      requireRole(actor, operationName === 'complete' ? ['OPERATOR', 'SUPERVISOR', 'INTEGRATION_SERVICE'] : ['OPERATOR', 'SUPERVISOR', 'AUDITOR']);
      // Hide cross-scope identifiers before replay lookup or signed URL creation.
      await service.getAuthorizedMetadata(evidenceId, access, operationName === 'complete' ? 'UPLOAD' : 'DOWNLOAD');
      if (operationName === 'download-intents') {
        const key = idempotencyKey(request);
        const result = await idempotent(
          idempotency,
          actor,
          'download-intent',
          evidenceId,
          key,
          { evidenceId },
          () => service.createDownloadRequest(evidenceId, access, request.traceId)
        );
        return { status: 200, body: envelope(true, result, null, request.traceId) };
      }
      const key = idempotencyKey(request);
      const result = await idempotent(idempotency, actor, 'complete', evidenceId, key, { evidenceId }, () => service.completeUpload(evidenceId, access, request.traceId));
      return { status: 200, body: envelope(true, result, null, request.traceId) };
    } catch (error) {
      return mapError(error, request.traceId);
    }
  };
}
