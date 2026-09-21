import type {
  AuthorizeClosureRequest,
  RoadEventPageResponse,
  RoadEventResponse,
  TransitionRoadEventRequest
} from '@ros/contracts';
import { authenticatedApiRequest, type AuthenticatedRequestFailure } from './authenticated-http.js';
import type { OperationsAccessTokenProvider } from './trusted-browser-session.js';

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

export interface RoadEventGateway {
  list(): Promise<RoadEventPageResponse>;
  getById(id: string): Promise<RoadEventResponse>;
  timeline(id: string): Promise<readonly AuditTimelineEntryContract[]>;
  transition(id: string, request: TransitionRoadEventRequest, operationId: string): Promise<RoadEventResponse>;
  authorizeClosure(id: string, request: AuthorizeClosureRequest, operationId: string): Promise<RoadEventResponse>;
}

export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError';
  readonly code: string;
  readonly traceId: string;
  readonly status: number;
  readonly outcomeAmbiguous: boolean;

  constructor(failure: AuthenticatedRequestFailure) {
    super(failure.message);
    this.code = failure.code;
    this.traceId = failure.traceId;
    this.status = failure.status;
    this.outcomeAmbiguous = failure.outcomeAmbiguous;
  }
}

export class HttpRoadEventGateway implements RoadEventGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly session: OperationsAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  list(): Promise<RoadEventPageResponse> { return this.request('/api/v1/road-events?limit=100&offset=0'); }
  getById(id: string): Promise<RoadEventResponse> { return this.request(`/api/v1/road-events/${encodeURIComponent(id)}`); }
  timeline(id: string): Promise<readonly AuditTimelineEntryContract[]> { return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/timeline`); }
  transition(id: string, request: TransitionRoadEventRequest, operationId: string): Promise<RoadEventResponse> {
    return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/transition`, 'POST', request, operationId);
  }
  authorizeClosure(id: string, request: AuthorizeClosureRequest, operationId: string): Promise<RoadEventResponse> {
    return this.request(`/api/v1/road-events/${encodeURIComponent(id)}/closure-authorization`, 'POST', request, operationId);
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, operationId?: string): Promise<T> {
    return authenticatedApiRequest<T, ApiRequestError>({
      baseUrl: this.baseUrl,
      path,
      method: method === 'POST' ? 'POST' : 'GET',
      ...(body === undefined ? {} : { body }),
      ...(method === 'POST' && operationId !== undefined ? { idempotencyKey: operationId } : {}),
      session: this.session,
      fetcher: this.fetcher,
      createError: (failure) => new ApiRequestError(failure)
    });
  }
}
