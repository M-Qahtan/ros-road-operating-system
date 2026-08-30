import {
  InvalidRoadEventError,
  InvalidRoadEventTransitionError,
  RoadEventAlreadyExistsError,
  RoadEventClosureRequiresHumanAuthorizationError,
  RoadEventNotFoundError,
  RoadEventStatus,
  SeverityLevel
} from '@ros/domain';
import {
  ApplicationConflictError,
  ApplicationValidationError,
  IdempotencyConflictError,
  RoadEventApplicationService
} from '../application/road-event-application.js';
import { AuthorizationDeniedError } from '../application/local-adapters.js';
import { AuthenticatedActor, FieldCompanionDeviceAuthorizationPort } from '../application/ports.js';
import { ActorResolver, createActorResolverForEnvironment } from './actor-resolver.js';

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
  readonly traceId: string;
}

export interface HttpResponse { readonly status: number; readonly body: unknown; }

class HttpInputError extends Error { override readonly name = 'HttpInputError'; }
class DeviceAuthorizationUnavailableError extends Error { override readonly name = 'DeviceAuthorizationUnavailableError'; }

function asRecord(value: unknown, field = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpInputError(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new HttpInputError(`${field} must be a string`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number') throw new HttpInputError(`${field} must be a number`);
  return value;
}

function stringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new HttpInputError(`${field} must be a string array`);
  return value as string[];
}

function isFieldUserOnly(actor: AuthenticatedActor): boolean {
  return actor.roles.includes('FIELD_USER') &&
    !actor.roles.some((role) => ['OPERATOR', 'SUPERVISOR', 'INTEGRATION_SERVICE'].includes(role));
}

async function incidentActor(
  request: HttpRequest,
  actorResolver: ActorResolver,
  deviceAuthorizer: FieldCompanionDeviceAuthorizationPort | null
): Promise<AuthenticatedActor> {
  const actor = await actorResolver.resolve(request.headers);
  if (!isFieldUserOnly(actor)) return actor;
  if (deviceAuthorizer === null) throw new DeviceAuthorizationUnavailableError('Persistent device authorization is unavailable');
  const deviceId = request.headers['x-device-id'];
  if (deviceId === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new HttpInputError('X-Device-Id header must be a UUID');
  }
  await deviceAuthorizer.assertActive(actor, deviceId.toLowerCase());
  return actor;
}

async function commandContext(request: HttpRequest, actorResolver: ActorResolver, deviceAuthorizer: FieldCompanionDeviceAuthorizationPort | null) {
  const idempotencyKey = request.headers['idempotency-key'];
  if (idempotencyKey === undefined) throw new HttpInputError('Idempotency-Key header is required');
  return { actor: await incidentActor(request, actorResolver, deviceAuthorizer), traceId: request.traceId, idempotencyKey };
}

function parseSeverity(value: unknown) {
  const record = asRecord(value, 'severity');
  const level = requiredString(record, 'level') as SeverityLevel;
  if (!Object.values(SeverityLevel).includes(level)) throw new HttpInputError('severity.level is invalid');
  return {
    level,
    score: requiredNumber(record, 'score'),
    confidence: requiredNumber(record, 'confidence'),
    reasonCodes: stringArray(record, 'reasonCodes'),
    requiresHumanReview: record.requiresHumanReview === true
  };
}

function parseStatus(value: unknown): RoadEventStatus {
  if (typeof value !== 'string' || !Object.values(RoadEventStatus).includes(value as RoadEventStatus)) {
    throw new HttpInputError('nextStatus is invalid');
  }
  return value as RoadEventStatus;
}

function numberQuery(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new HttpInputError('pagination values must be integers');
  return parsed;
}

function envelope(success: boolean, data: unknown, error: { readonly code: string; readonly message: string } | null, traceId: string) {
  return { success, data, error, traceId };
}

function mapError(error: unknown, traceId: string): HttpResponse {
  if (error instanceof AuthorizationDeniedError) return { status: 403, body: envelope(false, null, { code: 'FORBIDDEN', message: error.message }, traceId) };
  if (error instanceof DeviceAuthorizationUnavailableError) return { status: 503, body: envelope(false, null, { code: 'DEVICE_AUTHORIZATION_UNAVAILABLE', message: error.message }, traceId) };
  if (error instanceof RoadEventNotFoundError) return { status: 404, body: envelope(false, null, { code: 'ROAD_EVENT_NOT_FOUND', message: error.message }, traceId) };
  if (error instanceof RoadEventAlreadyExistsError || error instanceof ApplicationConflictError || error instanceof IdempotencyConflictError) {
    return { status: 409, body: envelope(false, null, { code: 'CONFLICT', message: error.message }, traceId) };
  }
  if (error instanceof RoadEventClosureRequiresHumanAuthorizationError) {
    return { status: 409, body: envelope(false, null, { code: 'HUMAN_AUTHORIZATION_REQUIRED', message: error.message }, traceId) };
  }
  if (error instanceof HttpInputError || error instanceof ApplicationValidationError || error instanceof InvalidRoadEventError || error instanceof InvalidRoadEventTransitionError || error instanceof TypeError || error instanceof RangeError) {
    return { status: 400, body: envelope(false, null, { code: 'VALIDATION_ERROR', message: error.message }, traceId) };
  }
  return { status: 500, body: envelope(false, null, { code: 'INTERNAL_ERROR', message: 'Unexpected server error' }, traceId) };
}

export function createRoadEventHttpHandler(
  application: RoadEventApplicationService,
  actorResolver: ActorResolver = createActorResolverForEnvironment(process.env),
  deviceAuthorizer: FieldCompanionDeviceAuthorizationPort | null = null
) {
  return async function handle(request: HttpRequest): Promise<HttpResponse> {
    try {
      const eventMatch = /^\/api\/v1\/road-events\/([0-9a-f-]+)$/.exec(request.path);
      const actionMatch = /^\/api\/v1\/road-events\/([0-9a-f-]+)\/(severity|transition|closure-authorization|signals|timeline)$/.exec(request.path);

      if (request.method === 'POST' && request.path === '/api/v1/road-events') {
        const body = asRecord(request.body);
        const severity = body.severity === undefined ? undefined : parseSeverity(body.severity);
        const data = await application.create({
          id: requiredString(body, 'id'), occurredAt: requiredString(body, 'occurredAt'),
          latitude: requiredNumber(body, 'latitude'), longitude: requiredNumber(body, 'longitude'),
          ...(severity === undefined ? {} : { severity })
        }, await commandContext(request, actorResolver, deviceAuthorizer));
        return { status: 201, body: envelope(true, data, null, request.traceId) };
      }

      if (request.method === 'GET' && request.path === '/api/v1/road-events') {
        const statuses = request.query.status === undefined ? undefined : request.query.status.split(',').map(parseStatus);
        const severities = request.query.severity === undefined ? undefined : request.query.severity.split(',').map((level) => {
          if (!Object.values(SeverityLevel).includes(level as SeverityLevel)) throw new HttpInputError('severity filter is invalid');
          return level as SeverityLevel;
        });
        const data = await application.list({
          ...(statuses === undefined ? {} : { statuses }), ...(severities === undefined ? {} : { severities }),
          ...(request.query.occurredFrom === undefined ? {} : { occurredFrom: new Date(request.query.occurredFrom) }),
          ...(request.query.occurredTo === undefined ? {} : { occurredTo: new Date(request.query.occurredTo) }),
          limit: numberQuery(request.query.limit, 20), offset: numberQuery(request.query.offset, 0)
        }, await actorResolver.resolve(request.headers));
        return { status: 200, body: envelope(true, data, null, request.traceId) };
      }

      if (eventMatch !== null && request.method === 'GET') {
        const data = await application.getById(eventMatch[1]!, await incidentActor(request, actorResolver, deviceAuthorizer));
        return { status: 200, body: envelope(true, data, null, request.traceId) };
      }

      if (actionMatch !== null) {
        const roadEventId = actionMatch[1]!;
        const action = actionMatch[2]!;
        if (request.method === 'GET' && action === 'timeline') {
          const data = await application.timeline(roadEventId, await actorResolver.resolve(request.headers));
          return { status: 200, body: envelope(true, data, null, request.traceId) };
        }
        if (request.method !== 'POST') return { status: 405, body: envelope(false, null, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, request.traceId) };
        const body = asRecord(request.body);
        const context = await commandContext(request, actorResolver, deviceAuthorizer);
        if (action === 'severity') {
          const data = await application.reassessSeverity({ roadEventId, expectedVersion: requiredNumber(body, 'expectedVersion'), assessment: parseSeverity(body.assessment), reason: requiredString(body, 'reason') }, context);
          return { status: 200, body: envelope(true, data, null, request.traceId) };
        }
        if (action === 'transition') {
          const data = await application.transition({ roadEventId, expectedVersion: requiredNumber(body, 'expectedVersion'), nextStatus: parseStatus(body.nextStatus), reason: requiredString(body, 'reason') }, context);
          return { status: 200, body: envelope(true, data, null, request.traceId) };
        }
        if (action === 'closure-authorization') {
          const data = await application.authorizeClosure({ roadEventId, expectedVersion: requiredNumber(body, 'expectedVersion'), reason: requiredString(body, 'reason'), authorizedAt: requiredString(body, 'authorizedAt') }, context);
          return { status: 200, body: envelope(true, data, null, request.traceId) };
        }
        const data = await application.attachSignal({ roadEventId, signalId: requiredString(body, 'signalId'), matchScore: requiredNumber(body, 'matchScore'), mergeReasons: stringArray(body, 'mergeReasons') }, context);
        return { status: 200, body: envelope(true, data, null, request.traceId) };
      }

      return { status: 404, body: envelope(false, null, { code: 'NOT_FOUND', message: 'Route not found' }, request.traceId) };
    } catch (error) {
      return mapError(error, request.traceId);
    }
  };
}
