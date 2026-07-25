import type {
  AuthorizeClosureRequest,
  RoadEventResponse,
  RoadEventStatusContract,
  RosRoleContract,
  TransitionRoadEventRequest
} from '@ros/contracts';
import type { AuditTimelineEntryContract, RoadEventGateway } from './api-client.js';

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

export class OperationsDashboardController {
  private current: DashboardState = {
    phase: 'loading', events: [], selected: null, timeline: [], stale: false, error: null, lastUpdatedAt: null
  };

  constructor(
    private readonly gateway: RoadEventGateway,
    private readonly session: OperationsSession,
    private readonly now: () => Date = () => new Date()
  ) {}

  get state(): DashboardState { return this.current; }
  canAuthorizeClosure(): boolean { return !this.current.stale && this.session.roles.includes('SUPERVISOR'); }
  canTransition(): boolean { return !this.current.stale && this.session.roles.some((role) => role === 'OPERATOR' || role === 'SUPERVISOR'); }

  async load(): Promise<DashboardState> {
    this.current = { ...this.current, phase: 'loading', error: null };
    try {
      const page = await this.gateway.list();
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
      this.current = { ...this.current, phase: 'failure', error: error instanceof Error ? error.message : 'تعذر تحميل الأحداث' };
    }
    return this.current;
  }

  async select(id: string): Promise<DashboardState> {
    try {
      const [selected, timeline] = await Promise.all([this.gateway.getById(id), this.gateway.timeline(id)]);
      this.current = {
        ...this.current,
        phase: 'ready',
        selected,
        timeline,
        stale: false,
        error: null,
        lastUpdatedAt: this.now().toISOString()
      };
    } catch (error) {
      this.current = { ...this.current, phase: 'failure', error: error instanceof Error ? error.message : 'تعذر تحميل تفاصيل الحدث' };
    }
    return this.current;
  }

  refreshStaleness(): DashboardState {
    const timestamp = this.current.lastUpdatedAt;
    const staleAfterMs = this.session.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.current = { ...this.current, stale: timestamp !== null && this.now().getTime() - new Date(timestamp).getTime() > staleAfterMs };
    return this.current;
  }

  async transition(nextStatus: RoadEventStatusContract, reason: string): Promise<DashboardState> {
    const selected = this.requireSelected();
    if (!this.canTransition()) throw new Error(this.current.stale ? 'حدّث البيانات قبل تنفيذ قرار حرج' : 'لا تملك صلاحية تغيير حالة الحدث');
    const normalizedReason = this.requireReason(reason);
    const request: TransitionRoadEventRequest = { expectedVersion: selected.version, nextStatus, reason: normalizedReason };
    const updated = await this.gateway.transition(selected.id, request);
    return this.applyCriticalResult(updated);
  }

  async authorizeClosure(reason: string): Promise<DashboardState> {
    const selected = this.requireSelected();
    if (!this.canAuthorizeClosure()) throw new Error(this.current.stale ? 'حدّث البيانات قبل تفويض الإغلاق' : 'تفويض إغلاق S3/S4 متاح للمشرف فقط');
    const request: AuthorizeClosureRequest = {
      expectedVersion: selected.version,
      reason: this.requireReason(reason),
      authorizedAt: this.now().toISOString()
    };
    const updated = await this.gateway.authorizeClosure(selected.id, request);
    return this.applyCriticalResult(updated);
  }

  private async applyCriticalResult(updated: RoadEventResponse): Promise<DashboardState> {
    const timeline = await this.gateway.timeline(updated.id);
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
