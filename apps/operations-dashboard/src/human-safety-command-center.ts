import type { HumanSafetyActorRole } from '@ros/contracts';
import {
  CommandCenterRequestError,
  type CommandCenterActionInput,
  type CommandCenterCaseView,
  type CommandCenterPage,
  type CommandCenterReassignInput,
  type HumanSafetyCommandCenterGateway
} from './human-safety-gateway.js';

export type CommandCenterPhase = 'loading' | 'ready' | 'empty' | 'failure';
export type CommandCenterFilter = 'ALL' | 'URGENT' | 'UNASSIGNED' | 'MY_CASES';
export type DeadlineState = 'OVERDUE' | 'IMMINENT' | 'ACTIVE' | 'NONE';

export interface HumanSafetyCommandCenterState {
  readonly phase: CommandCenterPhase;
  readonly items: readonly CommandCenterCaseView[];
  readonly selected: CommandCenterCaseView | null;
  readonly filter: CommandCenterFilter;
  readonly stale: boolean;
  readonly error: string | null;
  readonly lastUpdatedAt: string | null;
  readonly simulation: boolean;
}

export interface HumanSafetyCommandCenterSession {
  readonly actorId: string;
  readonly roles: readonly HumanSafetyActorRole[];
  readonly staleAfterMs?: number;
}

export interface CommandCenterMetrics {
  readonly total: number;
  readonly overdue: number;
  readonly imminent: number;
  readonly severityFour: number;
  readonly unassigned: number;
}

const DEFAULT_STALE_AFTER_MS = 15_000;
const IMMINENT_WINDOW_MS = 60_000;

export class HumanSafetyCommandCenterController {
  private current: HumanSafetyCommandCenterState = {
    phase: 'loading', items: [], selected: null, filter: 'ALL', stale: false, error: null, lastUpdatedAt: null, simulation: false
  };

  constructor(
    private readonly gateway: HumanSafetyCommandCenterGateway,
    private readonly session: HumanSafetyCommandCenterSession,
    private readonly now: () => Date = () => new Date()
  ) {}

  get state(): HumanSafetyCommandCenterState { return this.current; }

  async load(): Promise<HumanSafetyCommandCenterState> {
    this.current = { ...this.current, phase: 'loading', error: null };
    try { this.current = this.loadedState(await this.gateway.list()); }
    catch (error) {
      this.current = { ...this.current, phase: 'failure', error: error instanceof Error ? error.message : 'تعذر تحميل حالات سلامة الإنسان' };
    }
    return this.current;
  }

  async select(caseId: string): Promise<HumanSafetyCommandCenterState> {
    try {
      const selected = await this.gateway.get(caseId);
      this.current = { ...this.current, phase: 'ready', selected, items: replaceCase(this.current.items, selected), stale: false, error: null, lastUpdatedAt: this.now().toISOString() };
    } catch (error) {
      this.current = { ...this.current, phase: 'failure', error: error instanceof Error ? error.message : 'تعذر تحميل تفاصيل حالة سلامة الإنسان' };
    }
    return this.current;
  }

  setFilter(filter: CommandCenterFilter): HumanSafetyCommandCenterState { this.current = { ...this.current, filter }; return this.current; }

  refreshStaleness(): HumanSafetyCommandCenterState {
    const timestamp = this.current.lastUpdatedAt;
    const staleAfterMs = this.session.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.current = { ...this.current, stale: timestamp !== null && this.now().getTime() - Date.parse(timestamp) > staleAfterMs };
    return this.current;
  }

  visibleItems(): readonly CommandCenterCaseView[] {
    const sorted = [...this.current.items].sort((a, b) => {
      const priorityDifference = commandCenterPriority(b, this.now()) - commandCenterPriority(a, this.now());
      return priorityDifference !== 0 ? priorityDifference : Date.parse(a.safetyCase.openedAt) - Date.parse(b.safetyCase.openedAt);
    });
    if (this.current.filter === 'ALL') return sorted;
    const urgent = sorted.filter((item) => isUrgent(item, this.now()));
    const matching = sorted.filter((item) => {
      if (this.current.filter === 'URGENT') return isUrgent(item, this.now());
      if (this.current.filter === 'UNASSIGNED') return item.safetyCase.assignedActorId === null;
      return item.safetyCase.assignedActorId === this.session.actorId;
    });
    return uniqueCases([...urgent, ...matching]);
  }

  metrics(): CommandCenterMetrics { return commandCenterMetrics(this.current.items, this.now()); }

  canTakeover(): boolean {
    const selected = this.current.selected;
    return selected !== null && this.fresh() && roleAllowed(this.session.roles, ['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD'])
      && selected.safetyCase.state !== 'RESOLVED' && selected.dependencyHealth !== 'UNAVAILABLE' && selected.connectivity !== 'LOST';
  }

  canEscalate(): boolean {
    const selected = this.current.selected;
    return selected !== null && this.fresh() && roleAllowed(this.session.roles, ['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD'])
      && selected.safetyCase.state !== 'RESOLVED' && selected.dependencyHealth !== 'UNAVAILABLE';
  }

  canReassign(): boolean {
    const selected = this.current.selected;
    return selected !== null && this.fresh() && roleAllowed(this.session.roles, ['SUPERVISOR', 'SAFETY_LEAD'])
      && selected.safetyCase.state !== 'RESOLVED' && selected.dependencyHealth !== 'UNAVAILABLE';
  }

  canAuthorizeResolution(): boolean {
    const selected = this.current.selected;
    return selected !== null && this.fresh() && roleAllowed(this.session.roles, ['SUPERVISOR', 'SAFETY_LEAD'])
      && selected.safetyCase.state === 'MONITORED' && selected.evidenceState === 'TRUSTED'
      && selected.connectivity === 'HEALTHY' && selected.dependencyHealth === 'HEALTHY';
  }

  async takeover(reason: string, idempotencyKey: string, traceId: string): Promise<HumanSafetyCommandCenterState> {
    if (!this.canTakeover()) throw new Error(this.blockedReason('الاستحواذ على التواصل'));
    return this.apply(await this.execute(() => this.gateway.takeover(
      this.requireSelected().safetyCase.id,
      this.action(reason, idempotencyKey, traceId)
    )));
  }

  async escalate(reason: string, idempotencyKey: string, traceId: string): Promise<HumanSafetyCommandCenterState> {
    if (!this.canEscalate()) throw new Error(this.blockedReason('التصعيد'));
    return this.apply(await this.execute(() => this.gateway.escalate(
      this.requireSelected().safetyCase.id,
      this.action(reason, idempotencyKey, traceId)
    )));
  }

  async reassign(assigneeId: string, reason: string, idempotencyKey: string, traceId: string): Promise<HumanSafetyCommandCenterState> {
    if (!this.canReassign()) throw new Error(this.blockedReason('إعادة الإسناد'));
    const input: CommandCenterReassignInput = { ...this.action(reason, idempotencyKey, traceId), assigneeId: requireId(assigneeId, 'المستلم') };
    return this.apply(await this.execute(() => this.gateway.reassign(this.requireSelected().safetyCase.id, input)));
  }

  async authorizeResolution(reason: string, idempotencyKey: string, traceId: string): Promise<HumanSafetyCommandCenterState> {
    if (!this.canAuthorizeResolution()) throw new Error(this.blockedReason('تفويض الحل'));
    return this.apply(await this.execute(() => this.gateway.authorizeResolution(
      this.requireSelected().safetyCase.id,
      this.action(reason, idempotencyKey, traceId)
    )));
  }

  private loadedState(page: CommandCenterPage): HumanSafetyCommandCenterState {
    const selectedId = this.current.selected?.safetyCase.id ?? null;
    const selected = selectedId === null ? null : page.items.find((item) => item.safetyCase.id === selectedId) ?? null;
    return { phase: page.items.length === 0 ? 'empty' : 'ready', items: page.items, selected, filter: this.current.filter, stale: false, error: null, lastUpdatedAt: this.now().toISOString(), simulation: page.simulation };
  }

  private action(reason: string, idempotencyKey: string, traceId: string): CommandCenterActionInput {
    const selected = this.requireSelected();
    return { actorId: this.session.actorId, actorRoles: this.session.roles, expectedCaseVersion: selected.safetyCase.version,
      expectedContactVersion: selected.contactSession?.version ?? null, reason: requireReason(reason), traceId: requireId(traceId, 'معرّف التتبع'),
      occurredAt: this.now().toISOString(), idempotencyKey: requireId(idempotencyKey, 'مفتاح منع التكرار') };
  }

  private apply(updated: CommandCenterCaseView): HumanSafetyCommandCenterState {
    this.current = { ...this.current, phase: 'ready', items: replaceCase(this.current.items, updated), selected: updated, stale: false, error: null, lastUpdatedAt: this.now().toISOString() };
    return this.current;
  }

  private async execute(action: () => Promise<CommandCenterCaseView>): Promise<CommandCenterCaseView> {
    try { return await action(); }
    catch (error) {
      if (error instanceof CommandCenterRequestError) {
        this.current = { ...this.current, stale: true, error: error.message };
      }
      throw error;
    }
  }

  private fresh(): boolean { return !this.current.stale && this.current.phase === 'ready'; }

  private blockedReason(action: string): string {
    const selected = this.current.selected;
    if (selected === null) return `اختر حالة قبل ${action}`;
    if (this.current.stale) return `حدّث البيانات قبل ${action}`;
    if (selected.dependencyHealth === 'UNAVAILABLE') return `الاعتماديات الحرجة غير متاحة؛ تم منع ${action}`;
    if (selected.connectivity === 'LOST') return `الاتصال مفقود؛ تم منع ${action}`;
    return `لا تملك الصلاحية أو شروط السلامة اللازمة لتنفيذ ${action}`;
  }

  private requireSelected(): CommandCenterCaseView { if (this.current.selected === null) throw new Error('اختر حالة سلامة الإنسان أولًا'); return this.current.selected; }
}

export function deadlineState(item: CommandCenterCaseView, now: Date): DeadlineState {
  const candidates = [item.safetyCase.nextDeadlineAt, item.contactSession?.responseDeadlineAt ?? null]
    .filter((value): value is string => value !== null).map(Date.parse).filter(Number.isFinite);
  if (candidates.length === 0) return 'NONE';
  const remaining = Math.min(...candidates) - now.getTime();
  return remaining <= 0 ? 'OVERDUE' : remaining <= IMMINENT_WINDOW_MS ? 'IMMINENT' : 'ACTIVE';
}

export function deadlineRemainingSeconds(item: CommandCenterCaseView, now: Date): number | null {
  const candidates = [item.safetyCase.nextDeadlineAt, item.contactSession?.responseDeadlineAt ?? null]
    .filter((value): value is string => value !== null).map(Date.parse).filter(Number.isFinite);
  return candidates.length === 0 ? null : Math.ceil((Math.min(...candidates) - now.getTime()) / 1000);
}

export function isUrgent(item: CommandCenterCaseView, now: Date): boolean {
  return deadlineState(item, now) === 'OVERDUE' || deadlineState(item, now) === 'IMMINENT'
    || item.safetyCase.severity === 'S4' || item.safetyCase.state === 'NO_RESPONSE' || item.safetyCase.state === 'UNREACHABLE';
}

export function commandCenterPriority(item: CommandCenterCaseView, now: Date): number {
  const deadline = deadlineState(item, now);
  return (deadline === 'OVERDUE' ? 10_000 : deadline === 'IMMINENT' ? 8_000 : 0)
    + (item.safetyCase.severity === 'S4' ? 4_000 : item.safetyCase.severity === 'S3' ? 2_000 : 0)
    + (item.safetyCase.state === 'NO_RESPONSE' || item.safetyCase.state === 'UNREACHABLE' ? 3_000 : 0)
    + (item.safetyCase.assignedActorId === null ? 1_000 : 0);
}

export function commandCenterMetrics(items: readonly CommandCenterCaseView[], now: Date): CommandCenterMetrics {
  return { total: items.length, overdue: items.filter((item) => deadlineState(item, now) === 'OVERDUE').length,
    imminent: items.filter((item) => deadlineState(item, now) === 'IMMINENT').length,
    severityFour: items.filter((item) => item.safetyCase.severity === 'S4').length,
    unassigned: items.filter((item) => item.safetyCase.assignedActorId === null).length };
}

function replaceCase(items: readonly CommandCenterCaseView[], updated: CommandCenterCaseView): readonly CommandCenterCaseView[] { return items.map((item) => item.safetyCase.id === updated.safetyCase.id ? updated : item); }
function uniqueCases(items: readonly CommandCenterCaseView[]): readonly CommandCenterCaseView[] { const seen = new Set<string>(); return items.filter((item) => seen.has(item.safetyCase.id) ? false : (seen.add(item.safetyCase.id), true)); }
function roleAllowed(actual: readonly HumanSafetyActorRole[], allowed: readonly HumanSafetyActorRole[]): boolean { return actual.some((role) => allowed.includes(role)); }
function requireReason(reason: string): string { const normalized = reason.trim(); if (normalized.length < 3 || normalized.length > 500) throw new Error('يجب إدخال سبب واضح من 3 إلى 500 حرف'); return normalized; }
function requireId(value: string, label: string): string { const normalized = value.trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(normalized)) throw new Error(`${label} غير صالح`); return normalized; }
