import { RoadEvent, RoadEventAccessScope } from '@ros/domain';

export type RosRole = 'OPERATOR' | 'SUPERVISOR' | 'AUDITOR' | 'INTEGRATION_SERVICE';

export interface AuthenticatedActor extends RoadEventAccessScope {
  readonly actorId: string;
  readonly roles: readonly RosRole[];
}

export type RoadEventPermission =
  | 'road_event:create'
  | 'road_event:read'
  | 'road_event:list'
  | 'road_event:attach_signal'
  | 'road_event:reassess_severity'
  | 'road_event:transition'
  | 'road_event:authorize_closure'
  | 'road_event:close'
  | 'road_event:audit_read';

export interface AuthorizationPort {
  assertAllowed(actor: AuthenticatedActor, permission: RoadEventPermission): void;
}

export interface IdempotencyRecord<T> {
  readonly fingerprint: string;
  readonly value: T;
}

export class IdempotencyInFlightError extends Error {
  override readonly name = 'IdempotencyInFlightError';
}

export interface IdempotencyPort {
  /**
   * Ensures only one operation for a scope/key can cross the get -> operation -> put
   * boundary at a time. Production implementations must coordinate across processes.
   */
  executeExclusively<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T>;
  get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | undefined>;
  put<T>(scope: string, key: string, record: IdempotencyRecord<T>): Promise<void>;
}

export interface SignalAttachmentInput {
  readonly roadEventId: string;
  readonly signalId: string;
  readonly matchScore: number;
  readonly mergeReasons: readonly string[];
  readonly actor: AuthenticatedActor;
  readonly traceId: string;
}

export interface SignalAttachmentPort {
  attach(input: SignalAttachmentInput): Promise<void>;
}

export interface AuditTimelineEntry {
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly beforeState: Readonly<Record<string, unknown>> | null;
  readonly afterState: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
  readonly traceId: string;
  readonly occurredAt: string;
}

export interface AuditTimelinePort {
  listForRoadEvent(roadEventId: string, scope: RoadEventAccessScope): Promise<readonly AuditTimelineEntry[]>;
}

export interface RoadEventReadModel {
  readonly id: string;
  readonly status: string;
  readonly severity: {
    readonly level: string;
    readonly score: number;
    readonly confidence: number;
    readonly reasonCodes: readonly string[];
    readonly requiresHumanReview: boolean;
  };
  readonly latitude: number;
  readonly longitude: number;
  readonly occurredAt: string;
  readonly version: number;
  readonly closureAuthorization: {
    readonly actorId: string;
    readonly reason: string;
    readonly authorizedAt: string;
  } | null;
}

export function toRoadEventReadModel(event: RoadEvent): RoadEventReadModel {
  const authorization = event.closureAuthorization;
  return {
    id: event.id,
    status: event.status,
    severity: {
      level: event.severity.level,
      score: event.severity.score,
      confidence: event.severity.confidence,
      reasonCodes: [...event.severity.reasonCodes],
      requiresHumanReview: event.severity.requiresHumanReview
    },
    latitude: event.latitude,
    longitude: event.longitude,
    occurredAt: event.occurredAt.toISOString(),
    version: event.version,
    closureAuthorization: authorization === undefined
      ? null
      : {
          actorId: authorization.actorId,
          reason: authorization.reason,
          authorizedAt: authorization.authorizedAt.toISOString()
        }
  };
}
