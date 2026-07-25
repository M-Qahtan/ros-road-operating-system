import type {
  ApiEnvelope,
  AuthorizeClosureRequest,
  RoadEventPageResponse,
  RoadEventResponse,
  RosRoleContract,
  TransitionRoadEventRequest
} from '@ros/contracts';

export interface AuditTimelineEntryContract {
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly beforeState: Readonly<Record<string, unknown>> | null;
  readonly afterState: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
  readonly traceId: string;
  readonly occurredAt: string;
}

export interface OperationsIdentity {
  readonly actorId: string;
  readonly roles: readonly RosRoleContract[];
}

export interface RoadEventGateway {
  list(): Promise<RoadEventPageResponse>;
  getById(id: string): Promise<RoadEventResponse>;
  timeline(id: string): Promise<readonly AuditTimelineEntryContract[]>;
  transition(id: string, request: TransitionRoadEventRequest): Promise<RoadEventResponse>;
  authorizeClosure(id: string, request: AuthorizeClosureRequest): Promise<RoadEventResponse>;
}

export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError';
  constructor(readonly code: string, message: string, readonly traceId: string) { super(message); }
}

export class HttpRoadEventGateway implements RoadEventGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly identity: OperationsIdentity,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  list(): Promise<RoadEventPageResponse> { return this.request('/api/v1/road-events?limit=100&offset=0'); }
  getById(id: string): Promise<RoadEventResponse> { return this.request(`/api/v1/road-events/${encodeURIComponent(id)}`); }
  timeline(id: string): Promise<readonly AuditTimelineEntryContract[]> { return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/timeline`); }
  transition(id: string, request: TransitionRoadEventRequest): Promise<RoadEventResponse> {
    return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/transition`, 'POST', request);
  }
  authorizeClosure(id: string, request: AuthorizeClosureRequest): Promise<RoadEventResponse> {
    return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/closure-authorization`, 'POST', request);
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-actor-id': this.identity.actorId,
        'x-ros-roles': this.identity.roles.join(','),
        ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const envelope = await response.json() as ApiEnvelope<T>;
    if (!response.ok || !envelope.success || envelope.data === null) {
      throw new ApiRequestError(envelope.error?.code ?? 'HTTP_ERROR', envelope.error?.message ?? 'تعذر تنفيذ الطلب', envelope.traceId);
    }
    return envelope.data;
  }
}
