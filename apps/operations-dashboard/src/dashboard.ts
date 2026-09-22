import type {
  AuthorizeClosureRequest,
  RoadEventResponse,
  RoadEventStatusContract,
  RosRoleContract,
  TransitionRoadEventRequest
} from '@ros/contracts';
import { ApiRequestError, type AuditTimelineEntryContract, type RoadEventGateway } from './api-client.js';

export type DashboardPhase = 'loading' | 'ready' | 'empty' | 'failure';

export interface DashboardState {
  readonly phase: DashboardPhase;
  readonly events: readonly RoadEventResponse[];
  readonly selected: RoadEventResponse | null;
  readonly timeline: readonly AuditTimelineEntryContract[];
  readonly stale: boolean;
  readonly error: string | null;
  readonly lastUpdatedAt: string | null;
}

export interface OperationsSession {
  readonly roles: readonly RosRoleContract[];
  readonly staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30_000;
const TERMINAL_STATUSES: ReadonlySet<RoadEventStatusContract> = new Set([
  'CLOSED', 'FALSE_POSITIVE', 'DUPLICATE'
]);

type CriticalOperation =
  | { readonly action: 'TRANSITION'; readonly incidentId: string; readonly operationId: string; readonly key: string;
      readonly request: TransitionRoadEventRequest }
  | { readonly action: 'AUTHORIZE_CLOSURE'; readonly incidentId: string; readonly operationId: string; readonly key: string;
      readonly request: AuthorizeClosureRequest };

export type AmbiguousCriticalActionStatus = 'REFRESH_REQUIRED' | 'RETRY_ALLOWED' | 'INVALIDATED';

export interface AmbiguousCriticalActionView {
  readonly incidentId: string;
  readonly action: 'TRANSITION' | 'AUTHORIZE_CLOSURE';
  readonly expectedVersion: number;
  readonly nextStatus: RoadEventStatusContract | null;
  readonly status: AmbiguousCriticalActionStatus;
}

export class SupersededCriticalActionError extends Error {
  override readonly name = 'SupersededCriticalActionError';

  constructor(
    readonly incidentId: string,
    readonly action: 'TRANSITION' | 'AUTHORIZE_CLOSURE'
  ) {
    const label = action === 'TRANSITION' ? 'انتقال الحالة' : 'تفويض الإغلاق';
    super(`تعذر إكمال ${label} للحادث ${incidentId} بعد انتقال العرض. افتح الحادث مجددًا للتحقق من نتيجته.`);
  }
}

export class OperationsDashboardController {
  private current: DashboardState = {
    phase: 'loading', events: [], selected: null, timeline: [], stale: false, error: null, lastUpdatedAt: null
  };
  private failedSelectionId: string | null = null;
  private retryInFlight: Promise<DashboardState> | null = null;
  private criticalActionInFlight: { readonly key: string; readonly result: Promise<DashboardState> } | null = null;
  private ambiguousCriticalOperation: CriticalOperation | null = null;
  private readIntent = 0;

  constructor(
    private readonly gateway: RoadEventGateway,
    private readonly session: OperationsSession,
    private readonly now: () => Date = () => new Date()
  ) {}

  get state(): DashboardState { return this.current; }
  isCriticalActionInFlight(): boolean {
    return this.criticalActionInFlight !== null;
  }
  canAuthorizeClosure(): boolean {
    return this.current.phase === 'ready' && this.current.selected !== null && !this.current.stale
      && !TERMINAL_STATUSES.has(this.current.selected.status)
      && this.session.roles.includes('SUPERVISOR');
  }
  canTransition(): boolean {
    return this.current.phase === 'ready' && this.current.selected !== null && !this.current.stale
      && !TERMINAL_STATUSES.has(this.current.selected.status)
      && this.session.roles.some((role) => role === 'OPERATOR' || role === 'SUPERVISOR');
  }
  canTransitionTo(nextStatus: RoadEventStatusContract): boolean {
    if (!this.canTransition()) return false;
    const selected = this.current.selected;
    return nextStatus !== 'CLOSED' || (selected !== null && selected.closureAuthorization !== null);
  }

  async load(): Promise<DashboardState> {
    const intent = ++this.readIntent;
    this.failedSelectionId = null;
    this.current = { ...this.current, phase: 'loading', error: null };
    try {
      const page = await this.gateway.list();
      if (intent !== this.readIntent) return this.current;
      const updatedAt = this.now().toISOString();
      this.current = {
        phase: page.items.length === 0 ? 'empty' : 'ready',
        events: page.items,
        selected: null,
        timeline: [],
        stale: false,
        error: null,
        lastUpdatedAt: updatedAt
      };
    } catch (error) {
      if (intent !== this.readIntent) return this.current;
      this.current = {
        ...this.current,
        phase: 'failure',
        selected: null,
        timeline: [],
        stale: true,
        error: error instanceof Error ? error.message : 'تعذر تحميل الأحداث'
      };
    }
    return this.current;
  }

  async select(id: string): Promise<DashboardState> {
    const intent = ++this.readIntent;
    try {
      const [selected, timeline] = await Promise.all([this.gateway.getById(id), this.gateway.timeline(id)]);
      if (intent !== this.readIntent) return this.current;
      assertTerminalTimelineConsistency(selected, timeline);
      this.current = {
        ...this.current,
        phase: 'ready',
        selected,
        timeline,
        stale: false,
        error: null,
        lastUpdatedAt: this.now().toISOString()
      };
      this.failedSelectionId = null;
    } catch (error) {
      if (intent !== this.readIntent) return this.current;
      this.failedSelectionId = id;
      this.current = {
        ...this.current,
        phase: 'failure',
        selected: null,
        timeline: [],
        stale: true,
        error: error instanceof Error ? error.message : 'تعذر تحميل تفاصيل الحدث'
      };
    }
    return this.current;
  }

  retrySelection(): Promise<DashboardState> {
    if (this.retryInFlight !== null) return this.retryInFlight;
    const id = this.failedSelectionId;
    if (id === null) throw new Error('لا توجد محاولة تحميل فاشلة لإعادتها');
    this.retryInFlight = this.select(id).finally(() => { this.retryInFlight = null; });
    return this.retryInFlight;
  }

  canRetrySelection(): boolean {
    return this.failedSelectionId !== null && this.current.phase === 'failure'
      && this.current.selected === null && this.current.stale;
  }

  refreshStaleness(): DashboardState {
    const timestamp = this.current.lastUpdatedAt;
    const staleAfterMs = this.session.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.current = { ...this.current, stale: timestamp !== null && this.now().getTime() - new Date(timestamp).getTime() > staleAfterMs };
    return this.current;
  }

  async transition(nextStatus: RoadEventStatusContract, reason: string): Promise<DashboardState> {
    const selected = this.requireSelected();
    const intent = this.readIntent;
    if (TERMINAL_STATUSES.has(selected.status)) throw new Error('الحالة النهائية لا تقبل انتقالات جديدة');
    if (!this.canTransition()) throw new Error(this.current.stale ? 'حدّث البيانات قبل تنفيذ قرار حرج' : 'لا تملك صلاحية تغيير حالة الحدث');
    if (!this.canTransitionTo(nextStatus)) throw new Error('لا يمكن إغلاق الحدث دون تفويض إغلاق موثّق');
    const normalizedReason = this.requireReason(reason);
    const operation: CriticalOperation = {
      action: 'TRANSITION', incidentId: selected.id, operationId: crypto.randomUUID(),
      key: JSON.stringify(['TRANSITION', selected.id, selected.version, nextStatus, normalizedReason]),
      request: { expectedVersion: selected.version, nextStatus, reason: normalizedReason }
    };
    this.ambiguousCriticalOperation = null;
    return this.executeCriticalOperation(operation, intent);
  }

  async authorizeClosure(reason: string): Promise<DashboardState> {
    const selected = this.requireSelected();
    const intent = this.readIntent;
    if (TERMINAL_STATUSES.has(selected.status)) throw new Error('الحالة النهائية لا تقبل تفويض إغلاق جديد');
    if (!this.canAuthorizeClosure()) throw new Error(this.current.stale ? 'حدّث البيانات قبل تفويض الإغلاق' : 'تفويض إغلاق S3/S4 متاح للمشرف فقط');
    const normalizedReason = this.requireReason(reason);
    const operation: CriticalOperation = {
      action: 'AUTHORIZE_CLOSURE', incidentId: selected.id, operationId: crypto.randomUUID(),
      key: JSON.stringify(['AUTHORIZE_CLOSURE', selected.id, selected.version, normalizedReason]),
      request: { expectedVersion: selected.version, reason: normalizedReason, authorizedAt: this.now().toISOString() }
    };
    this.ambiguousCriticalOperation = null;
    return this.executeCriticalOperation(operation, intent);
  }

  canRetryAmbiguousCriticalAction(): boolean {
    const operation = this.ambiguousCriticalOperation;
    const selected = this.current.selected;
    if (operation === null || selected === null || this.current.phase !== 'ready' || this.current.stale
      || selected.id !== operation.incidentId || selected.version !== operation.request.expectedVersion) return false;
    return operation.action === 'TRANSITION'
      ? this.canTransitionTo(operation.request.nextStatus)
      : this.canAuthorizeClosure();
  }

  ambiguousCriticalActionView(): AmbiguousCriticalActionView | null {
    const operation = this.ambiguousCriticalOperation;
    if (operation === null) return null;
    const selected = this.current.selected;
    const status: AmbiguousCriticalActionStatus = this.current.phase !== 'ready' || selected === null || this.current.stale
      ? 'REFRESH_REQUIRED'
      : selected.id !== operation.incidentId || selected.version !== operation.request.expectedVersion
        ? 'INVALIDATED'
        : this.canRetryAmbiguousCriticalAction() ? 'RETRY_ALLOWED' : 'INVALIDATED';
    return {
      incidentId: operation.incidentId,
      action: operation.action,
      expectedVersion: operation.request.expectedVersion,
      nextStatus: operation.action === 'TRANSITION' ? operation.request.nextStatus : null,
      status
    };
  }

  discardBrowserSession(): DashboardState {
    ++this.readIntent;
    this.failedSelectionId = null;
    this.ambiguousCriticalOperation = null;
    this.current = {
      phase: 'loading', events: [], selected: null, timeline: [], stale: false, error: null, lastUpdatedAt: null
    };
    return this.current;
  }

  async retryAmbiguousCriticalAction(): Promise<DashboardState> {
    const operation = this.ambiguousCriticalOperation;
    if (operation === null) throw new Error('لا يوجد إجراء حرج غامض لإعادة التحقق منه');
    if (!this.canRetryAmbiguousCriticalAction()) {
      throw new Error('حدّث الحادث وتحقق من بقاء الإصدار والصلاحية قبل إعادة الإجراء الغامض');
    }
    return this.executeCriticalOperation(operation, this.readIntent);
  }

  private executeCriticalOperation(operation: CriticalOperation, intent: number): Promise<DashboardState> {
    return this.runCriticalAction(operation.key, async () => {
      try {
        const updated = operation.action === 'TRANSITION'
          ? await this.gateway.transition(operation.incidentId, operation.request, operation.operationId)
          : await this.gateway.authorizeClosure(operation.incidentId, operation.request, operation.operationId);
        if (this.ambiguousCriticalOperation?.operationId === operation.operationId) this.ambiguousCriticalOperation = null;
        return this.applyCriticalResult(updated, intent);
      } catch (error) {
        this.applyRemoteFailure(error, intent);
        if (intent !== this.readIntent) throw new SupersededCriticalActionError(operation.incidentId, operation.action);
        if (error instanceof ApiRequestError && error.outcomeAmbiguous) this.ambiguousCriticalOperation = operation;
        else if (this.ambiguousCriticalOperation?.operationId === operation.operationId) this.ambiguousCriticalOperation = null;
        throw error;
      }
    });
  }

  private runCriticalAction(key: string, execute: () => Promise<DashboardState>): Promise<DashboardState> {
    const active = this.criticalActionInFlight;
    if (active !== null) {
      if (active.key === key) return active.result;
      throw new Error('يوجد إجراء حرج قيد التنفيذ؛ انتظر اكتماله ثم حدّث الحادث قبل محاولة أخرى');
    }
    const result = execute().finally(() => {
      if (this.criticalActionInFlight?.result === result) this.criticalActionInFlight = null;
    });
    this.criticalActionInFlight = { key, result };
    return result;
  }

  private async applyCriticalResult(updated: RoadEventResponse, intent: number): Promise<DashboardState> {
    if (intent !== this.readIntent) return this.current;
    try {
      const timeline = await this.gateway.timeline(updated.id);
      if (intent !== this.readIntent) return this.current;
      this.current = {
        ...this.current,
        events: this.current.events.map((event) => event.id === updated.id ? updated : event),
        selected: updated,
        timeline,
        stale: false,
        error: null,
        lastUpdatedAt: this.now().toISOString()
      };
      return this.current;
    } catch (error) {
      if (intent !== this.readIntent) return this.current;
      this.applyRemoteFailure(error, intent);
      throw error;
    }
  }

  private applyRemoteFailure(error: unknown, intent: number = this.readIntent): void {
    if (intent !== this.readIntent) return;
    if (!(error instanceof ApiRequestError)) return;
    this.current = { ...this.current, stale: true, error: error.message };
  }

  private requireSelected(): RoadEventResponse {
    if (this.current.selected === null) throw new Error('اختر حدثًا أولًا');
    return this.current.selected;
  }

  private requireReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length < 3 || normalized.length > 500) throw new Error('يجب إدخال سبب واضح من 3 إلى 500 حرف');
    return normalized;
  }
}

function assertTerminalTimelineConsistency(
  selected: RoadEventResponse,
  timeline: readonly AuditTimelineEntryContract[]
): void {
  if (selected.status !== 'CLOSED') return;
  const matchingClosures = timeline.filter((entry) =>
    entry.action === 'road_event.closed' && entry.afterState?.version === selected.version
  );
  if (matchingClosures.length !== 1) {
    throw new Error('تعذر التحقق من سجل الإغلاق المطابق للإصدار النهائي للحادث');
  }
  const closure = matchingClosures[0];
  const priorVersion = selected.version - 1;
  if (closure?.beforeState?.version !== priorVersion) {
    throw new Error('تعذر التحقق من تسلسل سجل الإغلاق النهائي للحادث');
  }
  if (selected.severity.level === 'S3' || selected.severity.level === 'S4') {
    const closureIndex = timeline.indexOf(closure);
    const matchingAuthorizations = timeline
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) =>
        entry.action === 'road_event.closure_authorized' && entry.afterState?.version === priorVersion
      );
    if (matchingAuthorizations.length !== 1 || (matchingAuthorizations[0]?.index ?? closureIndex) >= closureIndex) {
      throw new Error('تعذر التحقق من ترتيب تفويض الإغلاق وسجله النهائي');
    }
    const authorization = matchingAuthorizations[0]?.entry;
    if (
      authorization?.actorType !== 'SUPERVISOR'
      || closure.actorType !== 'SUPERVISOR'
      || authorization.actorId !== closure.actorId
    ) {
      throw new Error('تعذر التحقق من تطابق هوية المشرف بين التفويض والإغلاق');
    }
    const authorizationTime = Date.parse(authorization.occurredAt);
    const closureTime = Date.parse(closure.occurredAt);
    if (!Number.isFinite(authorizationTime) || !Number.isFinite(closureTime) || closureTime < authorizationTime) {
      throw new Error('تعذر التحقق من التسلسل الزمني بين تفويض الإغلاق وتنفيذه');
    }
  }
}

export function slaAgeMinutes(event: RoadEventResponse, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(event.occurredAt).getTime()) / 60_000));
}

export function deriveHumanSafetyStatus(event: RoadEventResponse, timeline: readonly AuditTimelineEntryContract[]): string {
  const latestSafety = [...timeline].reverse().find((entry) => entry.action.includes('severity') || entry.action.includes('safety'));
  if (event.status === 'SAFETY_ASSESSMENT') return 'التقييم البشري جارٍ';
  if (event.severity.level === 'S3' || event.severity.level === 'S4') return latestSafety?.reason ?? 'خطر مرتفع — مراجعة بشرية إلزامية';
  return latestSafety?.reason ?? 'لا توجد مؤشرات حرجة مسجلة';
}

export function attachedSignalIds(timeline: readonly AuditTimelineEntryContract[]): readonly string[] {
  return timeline.flatMap((entry) => {
    const candidate = entry.afterState?.signalId;
    return typeof candidate === 'string' ? [candidate] : [];
  });
}
