import { RoadEvent } from './road-event.js';
import { RoadEventStatus } from './road-event-status.js';
import { SeverityLevel } from './severity.js';

export interface RoadEventWriteContext {
  readonly actorType: string;
  readonly actorId?: string;
  readonly action: string;
  readonly reason?: string;
  readonly traceId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt?: Date;
}

export interface RoadEventListQuery {
  readonly statuses?: readonly RoadEventStatus[];
  readonly severities?: readonly SeverityLevel[];
  readonly occurredFrom?: Date;
  readonly occurredTo?: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface RoadEventPage {
  readonly items: readonly RoadEvent[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface RoadEventRepository {
  create(event: RoadEvent, context: RoadEventWriteContext): Promise<void>;
  update(event: RoadEvent, expectedVersion: number, context: RoadEventWriteContext): Promise<void>;
  findById(id: string): Promise<RoadEvent | undefined>;
  list(query: RoadEventListQuery): Promise<RoadEventPage>;
}

export class RoadEventAlreadyExistsError extends Error { override readonly name = 'RoadEventAlreadyExistsError'; }
export class RoadEventNotFoundError extends Error { override readonly name = 'RoadEventNotFoundError'; }
export class RoadEventConcurrencyError extends Error { override readonly name = 'RoadEventConcurrencyError'; }
