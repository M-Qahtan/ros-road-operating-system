import { createHash } from 'node:crypto';
import {
  RoadEvent,
  RoadEventConcurrencyError,
  RoadEventListQuery,
  RoadEventNotFoundError,
  RoadEventRepository,
  RoadEventStatus,
  SeverityAssessment,
  SeverityLevel
} from '@ros/domain';
import {
  AuditTimelinePort,
  AuthenticatedActor,
  AuthorizationPort,
  IdempotencyInFlightError,
  IdempotencyPort,
  RoadEventReadModel,
  SignalAttachmentPort,
  toRoadEventReadModel
} from './ports.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export class ApplicationValidationError extends Error { override readonly name = 'ApplicationValidationError'; }
export class ApplicationConflictError extends Error { override readonly name = 'ApplicationConflictError'; }
export class IdempotencyConflictError extends Error { override readonly name = 'IdempotencyConflictError'; }

export interface CommandContext {
  readonly actor: AuthenticatedActor;
  readonly traceId: string;
  readonly idempotencyKey: string;
}

export interface CreateRoadEventCommand {
  readonly id: string;
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly severity?: SeverityAssessment;
}

export interface ReassessSeverityCommand {
  readonly roadEventId: string;
  readonly expectedVersion: number;
  readonly assessment: SeverityAssessment;
  readonly reason: string;
}

export interface TransitionRoadEventCommand {
  readonly roadEventId: string;
  readonly expectedVersion: number;
  readonly nextStatus: RoadEventStatus;
  readonly reason: string;
}

export interface AuthorizeClosureCommand {
  readonly roadEventId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly authorizedAt: string;
}

export interface AttachSignalCommand {
  readonly roadEventId: string;
  readonly signalId: string;
  readonly matchScore: number;
  readonly mergeReasons: readonly string[];
}

export interface RoadEventPageReadModel {
  readonly items: readonly RoadEventReadModel[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new ApplicationValidationError(`${field} must be a UUID`);
  return value;
}

function requireText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new ApplicationValidationError(`${field} must contain between 1 and ${maximumLength} characters`);
  }
  return normalized;
}

function requireTraceId(value: string): string {
  return requireText(value, 'traceId', 64);
}

function requireIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApplicationValidationError('Idempotency-Key must contain 8 to 128 safe characters');
  }
  return value;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApplicationValidationError(`${field} must be an ISO timestamp`);
  return date;
}

function validateExpectedVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApplicationValidationError('expectedVersion must be a positive safe integer');
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class RoadEventApplicationService {
  constructor(
    private readonly repository: RoadEventRepository,
    private readonly authorization: AuthorizationPort,
    private readonly idempotency: IdempotencyPort,
    private readonly signals: SignalAttachmentPort,
    private readonly auditTimeline: AuditTimelinePort
  ) {}

  async create(command: CreateRoadEventCommand, context: CommandContext): Promise<RoadEventReadModel> {
    this.authorization.assertAllowed(context.actor, 'road_event:create');
    requireUuid(command.id, 'id');
    requireTraceId(context.traceId);
    const occurredAt = parseDate(command.occurredAt, 'occurredAt');
    const event = new RoadEvent({
      id: command.id,
      occurredAt,
      latitude: command.latitude,
      longitude: command.longitude,
      ...(command.severity === undefined ? {} : { severity: command.severity })
    });
    return this.executeIdempotently('road_event:create', context.idempotencyKey, command, async () => {
      await this.repository.create(event, {
        actorType: this.primaryRole(context.actor),
        actorId: context.actor.actorId,
        action: 'road_event.created',
        traceId: context.traceId,
        eventType: 'RoadEventCreated',
        correlationId: command.id,
        occurredAt: new Date()
      });
      return toRoadEventReadModel(event);
    });
  }

  async reassessSeverity(command: ReassessSeverityCommand, context: CommandContext): Promise<RoadEventReadModel> {
    this.authorization.assertAllowed(context.actor, 'road_event:reassess_severity');
    requireUuid(command.roadEventId, 'roadEventId');
    validateExpectedVersion(command.expectedVersion);
    const reason = requireText(command.reason, 'reason', 500);
    return this.executeIdempotently('road_event:reassess_severity', context.idempotencyKey, command, async () => {
      const event = await this.requireEvent(command.roadEventId);
      if (event.version !== command.expectedVersion) throw new RoadEventConcurrencyError('RoadEvent version is stale');
      event.assessSeverity(command.assessment);
      await this.repository.update(event, command.expectedVersion, {
        actorType: this.primaryRole(context.actor),
        actorId: context.actor.actorId,
        action: 'road_event.severity_reassessed',
        reason,
        traceId: context.traceId,
        eventType: 'RoadEventSeverityReassessed',
        correlationId: command.roadEventId,
        occurredAt: new Date()
      });
      return toRoadEventReadModel(event);
    });
  }

  async transition(command: TransitionRoadEventCommand, context: CommandContext): Promise<RoadEventReadModel> {
    this.authorization.assertAllowed(context.actor, command.nextStatus === RoadEventStatus.Closed ? 'road_event:close' : 'road_event:transition');
    requireUuid(command.roadEventId, 'roadEventId');
    validateExpectedVersion(command.expectedVersion);
    const reason = requireText(command.reason, 'reason', 500);
    return this.executeIdempotently('road_event:transition', context.idempotencyKey, command, async () => {
      const event = await this.requireEvent(command.roadEventId);
      if (event.version !== command.expectedVersion) throw new RoadEventConcurrencyError('RoadEvent version is stale');
      event.transitionTo(command.nextStatus);
      await this.repository.update(event, command.expectedVersion, {
        actorType: this.primaryRole(context.actor),
        actorId: context.actor.actorId,
        action: command.nextStatus === RoadEventStatus.Closed ? 'road_event.closed' : 'road_event.transitioned',
        reason,
        traceId: context.traceId,
        eventType: command.nextStatus === RoadEventStatus.Closed ? 'RoadEventClosed' : 'RoadEventTransitioned',
        correlationId: command.roadEventId,
        occurredAt: new Date()
      });
      return toRoadEventReadModel(event);
    });
  }

  async authorizeClosure(command: AuthorizeClosureCommand, context: CommandContext): Promise<RoadEventReadModel> {
    this.authorization.assertAllowed(context.actor, 'road_event:authorize_closure');
    requireUuid(command.roadEventId, 'roadEventId');
    validateExpectedVersion(command.expectedVersion);
    const reason = requireText(command.reason, 'reason', 500);
    const authorizedAt = parseDate(command.authorizedAt, 'authorizedAt');
    return this.executeIdempotently('road_event:authorize_closure', context.idempotencyKey, command, async () => {
      const event = await this.requireEvent(command.roadEventId);
      if (event.version !== command.expectedVersion) throw new RoadEventConcurrencyError('RoadEvent version is stale');
      event.authorizeClosure({ actorId: context.actor.actorId, reason, authorizedAt });
      await this.repository.update(event, command.expectedVersion, {
        actorType: this.primaryRole(context.actor),
        actorId: context.actor.actorId,
        action: 'road_event.closure_authorized',
        reason,
        traceId: context.traceId,
        eventType: 'RoadEventClosureAuthorized',
        correlationId: command.roadEventId,
        occurredAt: new Date()
      });
      return toRoadEventReadModel(event);
    });
  }

  async attachSignal(command: AttachSignalCommand, context: CommandContext): Promise<{ readonly attached: true }> {
    this.authorization.assertAllowed(context.actor, 'road_event:attach_signal');
    requireUuid(command.roadEventId, 'roadEventId');
    requireUuid(command.signalId, 'signalId');
    if (!Number.isFinite(command.matchScore) || command.matchScore < 0 || command.matchScore > 1) {
      throw new ApplicationValidationError('matchScore must be between 0 and 1');
    }
    if (command.mergeReasons.length === 0 || command.mergeReasons.some((reason) => reason.trim().length === 0)) {
      throw new ApplicationValidationError('mergeReasons must contain at least one non-empty reason');
    }
    return this.executeIdempotently('road_event:attach_signal', context.idempotencyKey, command, async () => {
      await this.requireEvent(command.roadEventId);
      await this.signals.attach({
        roadEventId: command.roadEventId,
        signalId: command.signalId,
        matchScore: command.matchScore,
        mergeReasons: [...command.mergeReasons],
        actor: context.actor,
        traceId: context.traceId
      });
      return { attached: true as const };
    });
  }

  async getById(id: string, actor: AuthenticatedActor): Promise<RoadEventReadModel> {
    this.authorization.assertAllowed(actor, 'road_event:read');
    return toRoadEventReadModel(await this.requireEvent(requireUuid(id, 'roadEventId')));
  }

  async list(query: RoadEventListQuery, actor: AuthenticatedActor): Promise<RoadEventPageReadModel> {
    this.authorization.assertAllowed(actor, 'road_event:list');
    const page = await this.repository.list(query);
    return { ...page, items: page.items.map(toRoadEventReadModel) };
  }

  async timeline(id: string, actor: AuthenticatedActor) {
    this.authorization.assertAllowed(actor, 'road_event:audit_read');
    await this.requireEvent(requireUuid(id, 'roadEventId'));
    return this.auditTimeline.listForRoadEvent(id);
  }

  private async requireEvent(id: string): Promise<RoadEvent> {
    const event = await this.repository.findById(id);
    if (event === undefined) throw new RoadEventNotFoundError(`RoadEvent ${id} was not found`);
    return event;
  }

  private primaryRole(actor: AuthenticatedActor): string {
    requireUuid(actor.actorId, 'actorId');
    const role = actor.roles[0];
    if (role === undefined) throw new ApplicationValidationError('actor must have at least one role');
    return role;
  }

  private async executeIdempotently<T>(scope: string, rawKey: string, input: unknown, operation: () => Promise<T>): Promise<T> {
    const key = requireIdempotencyKey(rawKey);
    const requestFingerprint = fingerprint(input);
    try {
      return await this.idempotency.executeExclusively(scope, key, async () => {
        const existing = await this.idempotency.get<T>(scope, key);
        if (existing !== undefined) {
          if (existing.fingerprint !== requestFingerprint) {
            throw new IdempotencyConflictError('Idempotency key was reused with a different request');
          }
          return existing.value;
        }
        try {
          const value = await operation();
          await this.idempotency.put(scope, key, { fingerprint: requestFingerprint, value });
          return value;
        } catch (error) {
          if (error instanceof RoadEventConcurrencyError) throw new ApplicationConflictError(error.message);
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof IdempotencyInFlightError) {
        throw new ApplicationConflictError(error.message);
      }
      throw error;
    }
  }
}

export const defaultSeverity: SeverityAssessment = {
  level: SeverityLevel.Informational,
  score: 0,
  confidence: 0,
  reasonCodes: ['initial_detection'],
  requiresHumanReview: true
};