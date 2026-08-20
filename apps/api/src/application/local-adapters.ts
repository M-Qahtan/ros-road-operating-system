import {
  RoadEvent,
  RoadEventAccessScope,
  RoadEventAlreadyExistsError,
  RoadEventConcurrencyError,
  RoadEventListQuery,
  RoadEventNotFoundError,
  RoadEventPage,
  RoadEventRepository,
  RoadEventWriteContext
} from '@ros/domain';
import {
  AuditTimelineEntry,
  AuditTimelinePort,
  AuthenticatedActor,
  AuthorizationPort,
  IdempotencyInFlightError,
  IdempotencyPort,
  IdempotencyRecord,
  RoadEventPermission,
  RosRole,
  SignalAttachmentInput,
  SignalAttachmentPort
} from './ports.js';

export class AuthorizationDeniedError extends Error { override readonly name = 'AuthorizationDeniedError'; }

const ROLE_PERMISSIONS: Readonly<Record<RosRole, readonly RoadEventPermission[]>> = {
  OPERATOR: [
    'road_event:create', 'road_event:read', 'road_event:list', 'road_event:attach_signal',
    'road_event:reassess_severity', 'road_event:transition', 'road_event:close'
  ],
  SUPERVISOR: [
    'road_event:create', 'road_event:read', 'road_event:list', 'road_event:attach_signal',
    'road_event:reassess_severity', 'road_event:transition', 'road_event:authorize_closure',
    'road_event:close', 'road_event:audit_read'
  ],
  AUDITOR: ['road_event:read', 'road_event:list', 'road_event:audit_read'],
  INTEGRATION_SERVICE: ['road_event:create', 'road_event:read', 'road_event:attach_signal']
};

function sameScope(left: RoadEventAccessScope, right: RoadEventAccessScope): boolean {
  return left.tenantId === right.tenantId && left.purpose === right.purpose;
}

export class RoleMatrixAuthorizationAdapter implements AuthorizationPort {
  assertAllowed(actor: AuthenticatedActor, permission: RoadEventPermission): void {
    if (!actor.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) === true)) {
      throw new AuthorizationDeniedError(`Actor is not allowed to perform ${permission}`);
    }
  }
}

export class MemoryIdempotencyAdapter implements IdempotencyPort {
  private readonly records = new Map<string, IdempotencyRecord<unknown>>();
  private readonly inFlight = new Set<string>();

  async executeExclusively<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T> {
    const composite = `${scope}:${key}`;
    if (this.inFlight.has(composite)) {
      throw new IdempotencyInFlightError('Equivalent idempotent request is already in progress');
    }
    this.inFlight.add(composite);
    try {
      return await operation();
    } finally {
      this.inFlight.delete(composite);
    }
  }

  async get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | undefined> {
    return this.records.get(`${scope}:${key}`) as IdempotencyRecord<T> | undefined;
  }
  async put<T>(scope: string, key: string, record: IdempotencyRecord<T>): Promise<void> {
    const composite = `${scope}:${key}`;
    if (!this.records.has(composite)) this.records.set(composite, record as IdempotencyRecord<unknown>);
  }
}

export class MemorySignalAttachmentAdapter implements SignalAttachmentPort {
  readonly attachments: SignalAttachmentInput[] = [];
  private readonly keys = new Set<string>();
  constructor(private readonly repository?: RoadEventRepository) {}

  async attach(input: SignalAttachmentInput): Promise<void> {
    if (this.repository !== undefined) {
      const event = await this.repository.findById(input.roadEventId, input.actor);
      if (event === undefined) throw new RoadEventNotFoundError(`RoadEvent ${input.roadEventId} was not found`);
    }
    const key = `${input.actor.tenantId}:${input.actor.purpose}:${input.roadEventId}:${input.signalId}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.attachments.push({ ...input, mergeReasons: [...input.mergeReasons], actor: { ...input.actor, roles: [...input.actor.roles] } });
  }
}

function cloneEvent(event: RoadEvent): RoadEvent {
  const authorization = event.closureAuthorization;
  return new RoadEvent({
    id: event.id,
    occurredAt: event.occurredAt,
    latitude: event.latitude,
    longitude: event.longitude,
    status: event.status,
    severity: event.severity,
    version: event.version,
    ...(authorization === undefined ? {} : { closureAuthorization: authorization })
  });
}

function eventSnapshot(event: RoadEvent): Readonly<Record<string, unknown>> {
  return {
    id: event.id,
    status: event.status,
    severity: event.severity.level,
    version: event.version,
    occurredAt: event.occurredAt.toISOString()
  };
}

export class MemoryRoadEventRepository implements RoadEventRepository, AuditTimelinePort {
  private readonly events = new Map<string, RoadEvent>();
  private readonly scopes = new Map<string, RoadEventAccessScope>();
  private readonly audit = new Map<string, AuditTimelineEntry[]>();

  async create(event: RoadEvent, context: RoadEventWriteContext): Promise<void> {
    if (this.events.has(event.id)) throw new RoadEventAlreadyExistsError(`RoadEvent ${event.id} already exists`);
    this.events.set(event.id, cloneEvent(event));
    this.scopes.set(event.id, { tenantId: context.tenantId, purpose: context.purpose });
    this.appendAudit(event.id, context, null, eventSnapshot(event));
  }

  async update(event: RoadEvent, expectedVersion: number, context: RoadEventWriteContext): Promise<void> {
    const current = this.events.get(event.id);
    const scope = this.scopes.get(event.id);
    if (current === undefined || scope === undefined || !sameScope(scope, context)) {
      throw new RoadEventNotFoundError(`RoadEvent ${event.id} was not found`);
    }
    if (current.version !== expectedVersion) {
      throw new RoadEventConcurrencyError(`RoadEvent ${event.id} expected version ${expectedVersion}`);
    }
    this.events.set(event.id, cloneEvent(event));
    this.appendAudit(event.id, context, eventSnapshot(current), eventSnapshot(event));
  }

  async findById(id: string, scope: RoadEventAccessScope): Promise<RoadEvent | undefined> {
    const event = this.events.get(id);
    const eventScope = this.scopes.get(id);
    return event === undefined || eventScope === undefined || !sameScope(eventScope, scope) ? undefined : cloneEvent(event);
  }

  async list(query: RoadEventListQuery, scope: RoadEventAccessScope): Promise<RoadEventPage> {
    const items = [...this.events.entries()]
      .filter(([id]) => {
        const eventScope = this.scopes.get(id);
        return eventScope !== undefined && sameScope(eventScope, scope);
      })
      .map(([, event]) => event)
      .filter((event) => query.statuses === undefined || query.statuses.includes(event.status))
      .filter((event) => query.severities === undefined || query.severities.includes(event.severity.level))
      .filter((event) => query.occurredFrom === undefined || event.occurredAt >= query.occurredFrom)
      .filter((event) => query.occurredTo === undefined || event.occurredAt < query.occurredTo)
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
    return {
      items: items.slice(query.offset, query.offset + query.limit).map(cloneEvent),
      total: items.length,
      limit: query.limit,
      offset: query.offset
    };
  }

  async listForRoadEvent(roadEventId: string, scope: RoadEventAccessScope): Promise<readonly AuditTimelineEntry[]> {
    const eventScope = this.scopes.get(roadEventId);
    if (eventScope === undefined || !sameScope(eventScope, scope)) return [];
    return [...(this.audit.get(roadEventId) ?? [])];
  }

  private appendAudit(
    roadEventId: string,
    context: RoadEventWriteContext,
    beforeState: Readonly<Record<string, unknown>> | null,
    afterState: Readonly<Record<string, unknown>> | null
  ): void {
    const entries = this.audit.get(roadEventId) ?? [];
    entries.push({
      action: context.action,
      actorType: context.actorType,
      actorId: context.actorId ?? null,
      beforeState,
      afterState,
      reason: context.reason ?? null,
      traceId: context.traceId,
      occurredAt: (context.occurredAt ?? new Date()).toISOString()
    });
    this.audit.set(roadEventId, entries);
  }
}