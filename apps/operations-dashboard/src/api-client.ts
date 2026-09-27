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
  readonly correlationId?: string;
  readonly causationId?: string | null;
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
  async getById(id: string): Promise<RoadEventResponse> {
    const response = await this.request<unknown>(`/api/v1/road-events/${encodeURIComponent(id)}`);
    return requireRoadEventDetailReconciliation(response);
  }
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

const RECONCILIATION_KEYS = ['automaticRetryAuthorized', 'closureAuthorized', 'state'] as const;

function requireRoadEventDetailReconciliation(value: unknown): RoadEventResponse {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'reconciliation')) {
    throw untrustedRoadEventDetail();
  }
  const reconciliation = value.reconciliation;
  if (reconciliation === null) return value as unknown as RoadEventResponse;
  if (!isRecord(reconciliation)) throw untrustedRoadEventDetail();
  const keys = Object.keys(reconciliation).sort();
  if (keys.length !== RECONCILIATION_KEYS.length
    || !keys.every((key, index) => key === RECONCILIATION_KEYS[index])
    || reconciliation.state !== 'HUMAN_REVIEW_REQUIRED'
    || reconciliation.automaticRetryAuthorized !== false
    || reconciliation.closureAuthorized !== false) {
    throw untrustedRoadEventDetail();
  }
  return value as unknown as RoadEventResponse;
}

function untrustedRoadEventDetail(): ApiRequestError {
  return new ApiRequestError({
    status: 502,
    code: 'UNTRUSTED_RESPONSE',
    message: 'تعذر التحقق من حالة المصالحة للحادث. حُجبت الإجراءات الحرجة حتى تحديث موثوق.',
    traceId: 'local-response-validation',
    outcomeAmbiguous: false
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
