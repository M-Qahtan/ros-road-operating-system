import type {
  HumanContactSessionContract,
  HumanSafetyActorRole,
  HumanSafetyCaseContract,
  SafetyFusionRecommendation
} from '@ros/contracts';
import { authenticatedApiRequest, type AuthenticatedRequestFailure } from './authenticated-http.js';
import type { OperationsAccessTokenProvider } from './trusted-browser-session.js';

export type CommandCenterConnectivity = 'HEALTHY' | 'DEGRADED' | 'LOST';
export type CommandCenterDependencyHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
export type CommandCenterEvidenceState = 'TRUSTED' | 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING' | 'QUARANTINED';

export interface CommandCenterProvenanceEntry {
  readonly evidenceId: string;
  readonly sourceType: 'PHONE' | 'VEHICLE' | 'PERSON' | 'OPERATOR' | 'INFRASTRUCTURE' | 'CONTACT_RUNTIME' | 'SIMULATION';
  readonly integrity: 'VERIFIED' | 'UNVERIFIED' | 'INVALID';
  readonly receivedAt: string;
  readonly status: 'ACTIVE' | 'QUARANTINED' | 'REVOKED';
}

export interface CommandCenterAuditEntry {
  readonly eventId: string;
  readonly action: string;
  readonly actorId: string;
  readonly actorRole: HumanSafetyActorRole;
  readonly reason: string;
  readonly reasonCode: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly caseVersion: number;
  readonly immutable: true;
}

export interface CommandCenterCaseView {
  readonly tenantId: string;
  readonly safetyCase: HumanSafetyCaseContract;
  readonly contactSession: HumanContactSessionContract | null;
  readonly recommendation: SafetyFusionRecommendation | null;
  readonly evidenceState: CommandCenterEvidenceState;
  readonly connectivity: CommandCenterConnectivity;
  readonly dependencyHealth: CommandCenterDependencyHealth;
  readonly provenance: readonly CommandCenterProvenanceEntry[];
  readonly audit: readonly CommandCenterAuditEntry[];
}

export interface CommandCenterPage {
  readonly items: readonly CommandCenterCaseView[];
  readonly generatedAt: string;
  readonly simulation: boolean;
}

export interface CommandCenterActionInput {
  readonly actorId: string;
  readonly actorRoles: readonly HumanSafetyActorRole[];
  readonly expectedCaseVersion: number;
  readonly expectedContactVersion: number | null;
  readonly reason: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

export interface CommandCenterReassignInput extends CommandCenterActionInput {
  readonly assigneeId: string;
}

export interface HumanSafetyCommandCenterGateway {
  list(): Promise<CommandCenterPage>;
  get(caseId: string): Promise<CommandCenterCaseView>;
  takeover(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView>;
  escalate(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView>;
  reassign(caseId: string, input: CommandCenterReassignInput): Promise<CommandCenterCaseView>;
  authorizeResolution(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView>;
}

export class CommandCenterRequestError extends Error {
  override readonly name = 'CommandCenterRequestError';
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

export class HttpHumanSafetyCommandCenterGateway implements HumanSafetyCommandCenterGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly session: OperationsAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  list(): Promise<CommandCenterPage> { return this.request('/api/v1/human-safety/cases?limit=100&offset=0'); }
  get(caseId: string): Promise<CommandCenterCaseView> {
    return this.request(`/api/v1/human-safety/cases/${encodeURIComponent(caseId)}`);
  }
  takeover(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return this.request(`/api/v1/human-safety/cases/${encodeURIComponent(caseId)}/takeover`, 'POST', input);
  }
  escalate(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return this.request(`/api/v1/human-safety/cases/${encodeURIComponent(caseId)}/escalate`, 'POST', input);
  }
  reassign(caseId: string, input: CommandCenterReassignInput): Promise<CommandCenterCaseView> {
    return this.request(`/api/v1/human-safety/cases/${encodeURIComponent(caseId)}/assignment`, 'POST', input);
  }
  authorizeResolution(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return this.request(`/api/v1/human-safety/cases/${encodeURIComponent(caseId)}/resolution-authorization`, 'POST', input);
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const transmittedBody = method === 'POST' && isAction(body) ? actionRequestBody(body) : body;
    return authenticatedApiRequest<T, CommandCenterRequestError>({
      baseUrl: this.baseUrl,
      path,
      method: method === 'POST' ? 'POST' : 'GET',
      ...(transmittedBody === undefined ? {} : { body: transmittedBody }),
      ...(method === 'POST' && isAction(body) ? { idempotencyKey: body.idempotencyKey } : {}),
      session: this.session,
      fetcher: this.fetcher,
      createError: (failure) => new CommandCenterRequestError(failure)
    });
  }
}

export class SimulatedHumanSafetyCommandCenterGateway implements HumanSafetyCommandCenterGateway {
  private readonly cases = new Map<string, CommandCenterCaseView>();
  private readonly idempotentResults = new Map<string, CommandCenterCaseView>();

  constructor(seed: readonly CommandCenterCaseView[] = seedCommandCenterCases()) {
    for (const item of seed) this.cases.set(item.safetyCase.id, clone(item));
  }

  async list(): Promise<CommandCenterPage> {
    return { items: [...this.cases.values()].map(clone), generatedAt: new Date().toISOString(), simulation: true };
  }

  async get(caseId: string): Promise<CommandCenterCaseView> {
    return clone(this.requireCase(caseId));
  }

  async takeover(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return this.mutate(caseId, input, ['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD'], 'human_safety.operator_takeover', 'operator_takeover', (current) => ({
      ...current,
      safetyCase: {
        ...current.safetyCase,
        state: current.safetyCase.state === 'ESCALATED' ? 'ESCALATED' : 'HUMAN_REVIEW',
        activeChannel: 'OPERATOR',
        assignedActorId: input.actorId,
        version: current.safetyCase.version + 1
      },
      contactSession: current.contactSession === null ? null : {
        ...current.contactSession,
        state: 'OPERATOR_TAKEOVER',
        assignedOperatorId: input.actorId,
        activeChannel: 'OPERATOR',
        responseDeadlineAt: null,
        version: current.contactSession.version + 1,
        lastInteractionAt: input.occurredAt
      }
    }));
  }

  async escalate(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    return this.mutate(caseId, input, ['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD'], 'human_safety.escalated', 'manual_escalation', (current) => ({
      ...current,
      safetyCase: {
        ...current.safetyCase,
        state: 'ESCALATED',
        severity: severityAtLeastS3(current.safetyCase.severity),
        assignedActorId: current.safetyCase.assignedActorId ?? input.actorId,
        nextDeadlineAt: null,
        version: current.safetyCase.version + 1,
        severityAssessmentVersion: current.safetyCase.severityAssessmentVersion + 1
      },
      contactSession: current.contactSession === null ? null : {
        ...current.contactSession,
        state: 'ESCALATED',
        assignedOperatorId: current.contactSession.assignedOperatorId ?? input.actorId,
        responseDeadlineAt: null,
        version: current.contactSession.version + 1,
        lastInteractionAt: input.occurredAt
      }
    }));
  }

  async reassign(caseId: string, input: CommandCenterReassignInput): Promise<CommandCenterCaseView> {
    if (!validId(input.assigneeId)) throw new Error('معرّف المستلم الجديد غير صالح');
    return this.mutate(caseId, input, ['SUPERVISOR', 'SAFETY_LEAD'], 'human_safety.reassigned', 'manual_reassignment', (current) => ({
      ...current,
      safetyCase: {
        ...current.safetyCase,
        assignedActorId: input.assigneeId,
        version: current.safetyCase.version + 1
      },
      contactSession: current.contactSession === null ? null : {
        ...current.contactSession,
        assignedOperatorId: input.assigneeId,
        version: current.contactSession.version + 1,
        lastInteractionAt: input.occurredAt
      }
    }));
  }

  async authorizeResolution(caseId: string, input: CommandCenterActionInput): Promise<CommandCenterCaseView> {
    const current = this.requireCase(caseId);
    if (current.safetyCase.state !== 'MONITORED') throw new Error('لا يمكن تفويض الحل قبل وصول الحالة إلى المراقبة');
    if (current.evidenceState !== 'TRUSTED' || current.connectivity !== 'HEALTHY' || current.dependencyHealth !== 'HEALTHY') {
      throw new Error('الأدلة أو الاتصال أو الاعتماديات لا تسمح بحل الحالة');
    }
    const role = input.actorRoles.includes('SAFETY_LEAD') ? 'SAFETY_LEAD'
      : input.actorRoles.includes('SUPERVISOR') ? 'SUPERVISOR'
      : null;
    if (role === null) throw new Error('تفويض الحل عالي الخطورة متاح للمشرف أو قائد السلامة فقط');
    return this.mutate(caseId, input, [role], 'human_safety.resolution_authorized', 'authorized_resolution', (item) => ({
      ...item,
      safetyCase: {
        ...item.safetyCase,
        state: 'RESOLVED',
        nextDeadlineAt: null,
        version: item.safetyCase.version + 1,
        highRiskResolutionAuthorization: {
          caseId: item.safetyCase.id,
          decision: 'RESOLVE',
          actorId: input.actorId,
          role,
          reason: input.reason,
          authorizedAt: input.occurredAt,
          expiresAt: new Date(Date.parse(input.occurredAt) + 5 * 60_000).toISOString(),
          caseVersion: item.safetyCase.version,
          severityAssessmentVersion: item.safetyCase.severityAssessmentVersion,
          evidenceRevision: item.safetyCase.evidenceRevision,
          indicatorRevision: item.safetyCase.indicatorRevision,
          connectivity: 'HEALTHY',
          dependenciesHealthy: true
        }
      },
      contactSession: item.contactSession === null ? null : {
        ...item.contactSession,
        state: 'COMPLETED',
        responseDeadlineAt: null,
        version: item.contactSession.version + 1,
        lastInteractionAt: input.occurredAt
      }
    }));
  }

  private async mutate(
    caseId: string,
    input: CommandCenterActionInput,
    allowedRoles: readonly HumanSafetyActorRole[],
    action: string,
    reasonCode: string,
    transform: (current: CommandCenterCaseView) => CommandCenterCaseView
  ): Promise<CommandCenterCaseView> {
    const replay = this.idempotentResults.get(input.idempotencyKey);
    if (replay !== undefined) return clone(replay);
    validateAction(input, allowedRoles);
    const current = this.requireCase(caseId);
    if (current.safetyCase.version !== input.expectedCaseVersion) throw new Error('تعارض إصدار الحالة؛ حدّث البيانات');
    if ((current.contactSession?.version ?? null) !== input.expectedContactVersion) throw new Error('تعارض إصدار جلسة التواصل؛ حدّث البيانات');
    if (current.dependencyHealth === 'UNAVAILABLE') throw new Error('الاعتماديات الحرجة غير متاحة');
    const next = transform(current);
    const result: CommandCenterCaseView = {
      ...next,
      audit: [...current.audit, auditEntry(next, input, action, reasonCode)]
    };
    this.cases.set(caseId, clone(result));
    this.idempotentResults.set(input.idempotencyKey, clone(result));
    return clone(result);
  }

  private requireCase(caseId: string): CommandCenterCaseView {
    const item = this.cases.get(caseId);
    if (item === undefined) throw new Error('حالة سلامة الإنسان غير موجودة');
    return item;
  }
}

export function seedCommandCenterCases(now: Date = new Date()): readonly CommandCenterCaseView[] {
  const at = (offsetMs: number): string => new Date(now.getTime() + offsetMs).toISOString();
  return [
    {
      tenantId: 'tenant-riyadh-simulation',
      safetyCase: {
        id: 'case-ros-eye-001', roadEventId: 'road-event-001', state: 'NO_RESPONSE', severity: 'S4', version: 7,
        severityAssessmentVersion: 4, evidenceRevision: 9, indicatorRevision: 4, openedAt: at(-8 * 60_000),
        nextDeadlineAt: at(-45_000), activeChannel: 'PUSH', assignedActorId: null,
        indicators: [
          { code: 'PERSON_NOT_RESPONDING', observedAt: at(-90_000), source: 'SIMULATION', confidence: 0.98, requiresHumanReview: true },
          { code: 'POSSIBLE_IMMEDIATE_DANGER', observedAt: at(-80_000), source: 'DEVICE', confidence: 0.91, requiresHumanReview: true }
        ],
        highRiskResolutionAuthorization: null
      },
      contactSession: contactSession('contact-session-001', 'case-ros-eye-001', 'NO_RESPONSE', 5, at(-60_000), at(-45_000), null, 'PUSH'),
      recommendation: recommendation('case-ros-eye-001', 'S4', 'S4', 0.93, 0.22, at(-30_000), ['FUSION_NO_RESPONSE', 'FUSION_HIGH_RISK_INDICATOR', 'FUSION_HUMAN_AUTHORITY_REQUIRED'], ['MISSING_CONTACT_OUTCOME']),
      evidenceState: 'CONFLICTING', connectivity: 'DEGRADED', dependencyHealth: 'HEALTHY',
      provenance: [
        { evidenceId: 'evidence-vehicle-001', sourceType: 'VEHICLE', integrity: 'VERIFIED', receivedAt: at(-120_000), status: 'ACTIVE' },
        { evidenceId: 'evidence-phone-001', sourceType: 'PHONE', integrity: 'VERIFIED', receivedAt: at(-110_000), status: 'ACTIVE' }
      ],
      audit: [
        auditSeed('audit-001', 'human_safety.case_opened', 'SYSTEM', 'system', 'case_opened', 'trace-open-001', at(-8 * 60_000), 1),
        auditSeed('audit-002', 'contact.no_response', 'SYSTEM', 'runtime', 'response_deadline_exceeded', 'trace-timeout-001', at(-60_000), 7)
      ]
    },
    {
      tenantId: 'tenant-riyadh-simulation',
      safetyCase: {
        id: 'case-ros-eye-002', roadEventId: 'road-event-002', state: 'MONITORED', severity: 'S3', version: 11,
        severityAssessmentVersion: 6, evidenceRevision: 12, indicatorRevision: 7, openedAt: at(-18 * 60_000),
        nextDeadlineAt: at(8 * 60_000), activeChannel: 'OPERATOR', assignedActorId: 'operator-7',
        indicators: [
          { code: 'PERSON_RESPONDED', observedAt: at(-5 * 60_000), source: 'PERSON', confidence: 1, requiresHumanReview: false },
          { code: 'HELP_REQUESTED', observedAt: at(-4 * 60_000), source: 'PERSON', confidence: 1, requiresHumanReview: true }
        ],
        highRiskResolutionAuthorization: null
      },
      contactSession: contactSession('contact-session-002', 'case-ros-eye-002', 'COMPLETED', 9, at(-4 * 60_000), null, 'operator-7', 'OPERATOR'),
      recommendation: recommendation('case-ros-eye-002', 'S3', 'S3', 0.96, 0.08, at(-3 * 60_000), ['FUSION_HELP_REQUESTED', 'FUSION_HUMAN_AUTHORITY_REQUIRED'], []),
      evidenceState: 'TRUSTED', connectivity: 'HEALTHY', dependencyHealth: 'HEALTHY',
      provenance: [
        { evidenceId: 'evidence-person-002', sourceType: 'PERSON', integrity: 'VERIFIED', receivedAt: at(-5 * 60_000), status: 'ACTIVE' },
        { evidenceId: 'evidence-operator-002', sourceType: 'OPERATOR', integrity: 'VERIFIED', receivedAt: at(-3 * 60_000), status: 'ACTIVE' }
      ],
      audit: [auditSeed('audit-003', 'human_safety.monitored', 'OPERATOR', 'operator-7', 'monitoring_started', 'trace-monitor-002', at(-4 * 60_000), 11)]
    },
    {
      tenantId: 'tenant-riyadh-simulation',
      safetyCase: {
        id: 'case-ros-eye-003', roadEventId: 'road-event-003', state: 'HUMAN_REVIEW', severity: 'S2', version: 3,
        severityAssessmentVersion: 2, evidenceRevision: 3, indicatorRevision: 2, openedAt: at(-3 * 60_000),
        nextDeadlineAt: at(40_000), activeChannel: 'IN_APP_CHAT', assignedActorId: 'operator-9',
        indicators: [{ code: 'LOCATION_UNCERTAIN', observedAt: at(-70_000), source: 'DEVICE', confidence: 0.55, requiresHumanReview: true }],
        highRiskResolutionAuthorization: null
      },
      contactSession: contactSession('contact-session-003', 'case-ros-eye-003', 'AWAITING_RESPONSE', 2, at(-50_000), at(40_000), 'operator-9', 'IN_APP_CHAT'),
      recommendation: recommendation('case-ros-eye-003', 'S2', 'S3', 0.62, 0.47, at(-20_000), ['FUSION_SPARSE_EVIDENCE', 'FUSION_HIGH_UNCERTAINTY', 'FUSION_HUMAN_AUTHORITY_REQUIRED'], ['MISSING_CORROBORATION', 'MISSING_LOCATION_QUALITY']),
      evidenceState: 'AMBIGUOUS', connectivity: 'HEALTHY', dependencyHealth: 'DEGRADED',
      provenance: [{ evidenceId: 'evidence-phone-003', sourceType: 'PHONE', integrity: 'UNVERIFIED', receivedAt: at(-70_000), status: 'QUARANTINED' }],
      audit: [auditSeed('audit-004', 'human_safety.human_review', 'SYSTEM', 'fusion-runtime', 'high_uncertainty', 'trace-review-003', at(-20_000), 3)]
    }
  ];
}

function contactSession(sessionId: string, caseId: string, state: HumanContactSessionContract['state'], version: number, lastInteractionAt: string, responseDeadlineAt: string | null, assignedOperatorId: string | null, activeChannel: HumanContactSessionContract['activeChannel']): HumanContactSessionContract {
  return {
    sessionId, caseId, state, version, protocolVersion: 'ros-eye.contact.v1', promptPolicyVersion: 'ros-eye.contact-prompts.v1',
    accessibilityPolicyVersion: 'ros-eye.accessibility.v1', language: 'ar', identityConfidence: state === 'COMPLETED' ? 'CONFIRMED' : 'PARTIAL',
    activeChannel, attemptCount: state === 'NO_RESPONSE' ? 3 : 1, responseDeadlineAt, lastInteractionAt, assignedOperatorId,
    accessibility: { screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true, simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true }
  };
}

function recommendation(caseId: string, currentSeverity: SafetyFusionRecommendation['currentSeverity'], recommendedSeverity: SafetyFusionRecommendation['recommendedSeverity'], confidence: number, uncertainty: number, evaluatedAt: string, reasonCodes: SafetyFusionRecommendation['reasonCodes'], missingEvidenceFlags: SafetyFusionRecommendation['missingEvidenceFlags']): SafetyFusionRecommendation {
  return {
    tenantId: 'tenant-riyadh-simulation', caseId, inputVersion: 1, evaluatedAt, recommendedSeverity, currentSeverity,
    score: recommendedSeverity === 'S4' ? 96 : recommendedSeverity === 'S3' ? 78 : 45, confidence, uncertainty, reasonCodes,
    missingEvidenceFlags, contributions: [],
    guardResults: [
      { kind: 'DATA_QUALITY', disposition: 'CLEAR', reasonCode: 'quality_clear', guardVersion: 'dq.v1', evaluatedInputVersion: 1 },
      { kind: 'DRIFT', disposition: 'CLEAR', reasonCode: 'drift_clear', guardVersion: 'drift.v1', evaluatedInputVersion: 1 },
      { kind: 'OUT_OF_DISTRIBUTION', disposition: uncertainty > 0.4 ? 'DEGRADED' : 'CLEAR', reasonCode: uncertainty > 0.4 ? 'ood_degraded' : 'ood_clear', guardVersion: 'ood.v1', evaluatedInputVersion: 1 },
      { kind: 'ADVERSARIAL_INPUT', disposition: 'CLEAR', reasonCode: 'adversarial_clear', guardVersion: 'adv.v1', evaluatedInputVersion: 1 }
    ],
    requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false, autonomousDispatchPermitted: false, policyVersion: 'ros-eye.safety-fusion.v1',
    ruleSetVersion: 'ros-eye.rules.baseline.v1', thresholdVersion: 'ros-eye.safety-fusion.thresholds.v1',
    deterministicFingerprint: `simulation-${caseId}`
  };
}

function auditSeed(eventId: string, action: string, actorRole: HumanSafetyActorRole, actorId: string, reasonCode: string, traceId: string, occurredAt: string, caseVersion: number): CommandCenterAuditEntry {
  return { eventId, action, actorRole, actorId, reason: reasonCode, reasonCode, traceId, occurredAt, caseVersion, immutable: true };
}

function auditEntry(item: CommandCenterCaseView, input: CommandCenterActionInput, action: string, reasonCode: string): CommandCenterAuditEntry {
  return { eventId: `audit-${input.idempotencyKey}`, action, actorId: input.actorId, actorRole: highestRole(input.actorRoles), reason: input.reason, reasonCode, traceId: input.traceId, occurredAt: input.occurredAt, caseVersion: item.safetyCase.version, immutable: true };
}

function highestRole(roles: readonly HumanSafetyActorRole[]): HumanSafetyActorRole {
  for (const role of ['SAFETY_LEAD', 'SUPERVISOR', 'OPERATOR', 'SYSTEM', 'AUDITOR', 'SIMULATED_CHANNEL'] as const) if (roles.includes(role)) return role;
  return 'AUDITOR';
}

function validateAction(input: CommandCenterActionInput, allowedRoles: readonly HumanSafetyActorRole[]): void {
  if (!validId(input.actorId) || !validId(input.traceId) || !validId(input.idempotencyKey)) throw new Error('سياق الإجراء غير صالح');
  if (input.reason.trim().length < 3 || input.reason.trim().length > 500) throw new Error('يجب إدخال سبب واضح من 3 إلى 500 حرف');
  if (!Number.isInteger(input.expectedCaseVersion) || input.expectedCaseVersion < 1) throw new Error('إصدار الحالة غير صالح');
  if (input.expectedContactVersion !== null && (!Number.isInteger(input.expectedContactVersion) || input.expectedContactVersion < 1)) throw new Error('إصدار جلسة التواصل غير صالح');
  if (!input.actorRoles.some((role) => allowedRoles.includes(role))) throw new Error('لا تملك الصلاحية المطلوبة');
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('وقت الإجراء غير صالح');
}

function isAction(value: unknown): value is CommandCenterActionInput { return typeof value === 'object' && value !== null && 'idempotencyKey' in value; }
function actionRequestBody(value: CommandCenterActionInput | CommandCenterReassignInput): Omit<CommandCenterActionInput, 'actorId' | 'actorRoles'> & { readonly assigneeId?: string } {
  const base = {
    expectedCaseVersion: value.expectedCaseVersion,
    expectedContactVersion: value.expectedContactVersion,
    reason: value.reason,
    traceId: value.traceId,
    occurredAt: value.occurredAt,
    idempotencyKey: value.idempotencyKey
  };
  return 'assigneeId' in value ? { ...base, assigneeId: value.assigneeId } : base;
}
function severityAtLeastS3(value: HumanSafetyCaseContract['severity']): HumanSafetyCaseContract['severity'] { return value === 'S4' ? 'S4' : 'S3'; }
function validId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value); }
function clone<T>(value: T): T { return structuredClone(value); }
