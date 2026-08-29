import { createHash } from 'node:crypto';
import {
  CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
  CONTACT_RUNTIME_POLICY_VERSION,
  ContactAuditEvent,
  ContactRuntimeRepositoryPort,
  ContactSessionRecord
} from '../ros-eye/contact-orchestration.js';
import {
  HumanContactSessionContract,
  HumanSafetyActorRole,
  HumanSafetyCaseContract,
  SafetyFusionRecommendation,
  decideHumanContactTransition
} from '@ros/contracts';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import { AuthenticatedActor, IdempotencyInFlightError, IdempotencyPort, RoadEventReadModel } from '../application/ports.js';
import { ApplicationConflictError, IdempotencyConflictError } from '../application/road-event-application.js';
import { AuthorizationDeniedError } from '../application/local-adapters.js';
import { ContactSqlPoolPort, ContactSqlRow } from '../ros-eye/contact-orchestration-postgres.js';
import { ActorResolver } from './actor-resolver.js';
import { HttpRequest, HttpResponse } from './road-event-http.js';

type EvidenceState = 'TRUSTED' | 'AMBIGUOUS' | 'CONFLICTING' | 'MISSING' | 'QUARANTINED';

export interface HumanSafetyProvenanceEntry {
  readonly evidenceId: string;
  readonly sourceType: 'PHONE' | 'VEHICLE' | 'PERSON' | 'OPERATOR' | 'INFRASTRUCTURE' | 'CONTACT_RUNTIME' | 'SIMULATION';
  readonly integrity: 'VERIFIED' | 'UNVERIFIED' | 'INVALID';
  readonly receivedAt: string;
  readonly status: 'ACTIVE' | 'QUARANTINED' | 'REVOKED';
}

export interface HumanSafetyAuditEntry {
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

export interface HumanSafetyCaseView {
  readonly tenantId: string;
  readonly safetyCase: HumanSafetyCaseContract;
  readonly contactSession: HumanContactSessionContract | null;
  readonly recommendation: SafetyFusionRecommendation | null;
  readonly evidenceState: EvidenceState;
  readonly connectivity: 'HEALTHY' | 'DEGRADED' | 'LOST';
  readonly dependencyHealth: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  readonly provenance: readonly HumanSafetyProvenanceEntry[];
  readonly audit: readonly HumanSafetyAuditEntry[];
}

export interface HumanSafetyBacking {
  readonly contact: ContactSessionRecord | null;
  readonly recommendation: SafetyFusionRecommendation | null;
  readonly evidenceState: EvidenceState;
  readonly provenance: readonly HumanSafetyProvenanceEntry[];
  readonly audit: readonly HumanSafetyAuditEntry[];
}

export type HumanSafetyContactAction = 'takeover' | 'escalate' | 'assignment';

export interface HumanSafetyStore {
  read(scope: { readonly tenantId: string; readonly purpose: string }, caseId: string): Promise<HumanSafetyBacking>;
  mutate(input: {
    readonly tenantId: string;
    readonly caseId: string;
    readonly sessionId: string;
    readonly expectedContactVersion: number;
    readonly action: HumanSafetyContactAction;
    readonly actorId: string;
    readonly actorRole: 'OPERATOR' | 'SUPERVISOR';
    readonly assigneeId?: string;
    readonly reason: string;
    readonly traceId: string;
    readonly occurredAt: string;
  }): Promise<void>;
}

export class HumanSafetyHttpError extends Error {
  override readonly name = 'HumanSafetyHttpError';
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function text(row: ContactSqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`invalid ${key}`);
  return value;
}

function nullableText(row: ContactSqlRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`invalid ${key}`);
  return value;
}

function integer(row: ContactSqlRow, key: string): number {
  const parsed = typeof row[key] === 'number' ? row[key] : Number(row[key]);
  if (!Number.isInteger(parsed)) throw new Error(`invalid ${key}`);
  return parsed as number;
}

function timestamp(row: ContactSqlRow, key: string): string {
  const value = row[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${key}`);
  return parsed.toISOString();
}

function nullableTimestamp(row: ContactSqlRow, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : timestamp(row, key);
}

function stringArray(row: ContactSqlRow, key: string): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`invalid ${key}`);
  return value as readonly string[];
}

function jsonArray(row: ContactSqlRow, key: string): readonly unknown[] {
  const raw = row[key];
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value)) throw new Error(`invalid ${key}`);
  return value;
}

function mapContact(row: ContactSqlRow): ContactSessionRecord {
  const rawAccessibility = row.accessibility;
  const accessibility: unknown = typeof rawAccessibility === 'string' ? JSON.parse(rawAccessibility) : rawAccessibility;
  if (typeof accessibility !== 'object' || accessibility === null || Array.isArray(accessibility)) throw new Error('invalid accessibility');
  return {
    tenantId: text(row, 'tenant_id'), caseId: text(row, 'case_id'), sessionId: text(row, 'session_id'),
    ownerActorId: nullableText(row, 'owner_actor_id'),
    state: text(row, 'state') as ContactSessionRecord['state'], version: integer(row, 'version'),
    protocolVersion: text(row, 'protocol_version') as ContactSessionRecord['protocolVersion'],
    promptPolicyVersion: text(row, 'prompt_policy_version') as ContactSessionRecord['promptPolicyVersion'],
    accessibilityPolicyVersion: text(row, 'accessibility_policy_version') as ContactSessionRecord['accessibilityPolicyVersion'],
    language: text(row, 'language') as ContactSessionRecord['language'],
    identityConfidence: text(row, 'identity_confidence') as ContactSessionRecord['identityConfidence'],
    activeChannel: nullableText(row, 'active_channel') as ContactSessionRecord['activeChannel'],
    attemptCount: integer(row, 'attempt_count'), responseDeadlineAt: nullableTimestamp(row, 'response_deadline_at'),
    lastInteractionAt: timestamp(row, 'last_interaction_at'), assignedOperatorId: nullableText(row, 'assigned_operator_id'),
    accessibility: accessibility as unknown as ContactSessionRecord['accessibility'],
    automationSuppressed: row.automation_suppressed === true, nextActionAt: nullableTimestamp(row, 'next_action_at'),
    leaseOwner: nullableText(row, 'lease_owner'), leaseExpiresAt: nullableTimestamp(row, 'lease_expires_at'),
    updatedAt: timestamp(row, 'updated_at')
  };
}

function mapRecommendation(row: ContactSqlRow): SafetyFusionRecommendation {
  return {
    tenantId: text(row, 'tenant_id'), caseId: text(row, 'case_id'),
    inputVersion: integer(row, 'input_version'),
    evaluatedAt: timestamp(row, 'evaluated_at'),
    currentSeverity: text(row, 'current_severity') as SafetyFusionRecommendation['currentSeverity'],
    recommendedSeverity: text(row, 'recommended_severity') as SafetyFusionRecommendation['recommendedSeverity'],
    score: Number(row.score), confidence: Number(row.confidence), uncertainty: Number(row.uncertainty),
    reasonCodes: stringArray(row, 'reason_codes') as SafetyFusionRecommendation['reasonCodes'],
    missingEvidenceFlags: stringArray(row, 'missing_evidence_flags') as SafetyFusionRecommendation['missingEvidenceFlags'],
    contributions: [],
    guardResults: jsonArray(row, 'guard_results') as SafetyFusionRecommendation['guardResults'],
    requiresHumanReview: row.requires_human_review === true,
    authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false, autonomousDispatchPermitted: false,
    policyVersion: text(row, 'policy_version') as SafetyFusionRecommendation['policyVersion'],
    ruleSetVersion: text(row, 'rule_set_version'), thresholdVersion: text(row, 'threshold_version'),
    deterministicFingerprint: text(row, 'deterministic_fingerprint')
  };
}

function role(value: string): HumanSafetyActorRole {
  return ['SYSTEM', 'OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD', 'AUDITOR'].includes(value)
    ? value as HumanSafetyActorRole
    : 'SYSTEM';
}

const SESSION_COLUMNS = `tenant_id, case_id, session_id, state, version, protocol_version,
  prompt_policy_version, accessibility_policy_version, language, identity_confidence,
  active_channel, attempt_count, response_deadline_at, next_action_at, last_interaction_at,
  assigned_operator_id, automation_suppressed, accessibility, lease_owner, lease_expires_at, updated_at`;

export class PostgresHumanSafetyStore implements HumanSafetyStore {
  constructor(
    private readonly sql: ContactSqlPoolPort,
    private readonly contacts: ContactRuntimeRepositoryPort
  ) {}

  async read(scope: { readonly tenantId: string; readonly purpose: string }, caseId: string): Promise<HumanSafetyBacking> {
    const [contact, evidence, recommendation, contactAudit, eventAudit] = await Promise.all([
      this.sql.query(`SELECT ${SESSION_COLUMNS} FROM ros_eye_contact_sessions
        WHERE tenant_id=$1 AND case_id=$2 ORDER BY updated_at DESC, session_id DESC LIMIT 1`, [scope.tenantId, caseId]),
      this.sql.query(`SELECT e.id, e.status, e.created_at
        FROM evidence_objects e JOIN road_events r ON r.id=e.road_event_id
        WHERE r.id=$1::uuid AND r.tenant_id=$2 AND r.purpose=$3
        ORDER BY e.created_at, e.id`, [caseId, scope.tenantId, scope.purpose]),
      this.sql.query(`SELECT * FROM ros_eye_safety_fusion_recommendations
        WHERE tenant_id=$1 AND case_id=$2 ORDER BY input_version DESC, evaluated_at DESC LIMIT 1`, [scope.tenantId, caseId]),
      this.sql.query(`SELECT event_id,event_type,state,session_version,actor_id,authorized_by_role,reason_code,occurred_at,trace_id
        FROM ros_eye_contact_audit WHERE tenant_id=$1 AND case_id=$2 ORDER BY occurred_at,event_id`, [scope.tenantId, caseId]),
      this.sql.query(`SELECT a.id,a.action,a.actor_type,a.actor_id,a.reason,a.trace_id,a.occurred_at,r.version
        FROM audit_logs a JOIN road_events r ON r.id=a.resource_id
        WHERE a.resource_type='RoadEvent' AND r.id=$1::uuid AND r.tenant_id=$2 AND r.purpose=$3
        ORDER BY a.occurred_at,a.id`, [caseId, scope.tenantId, scope.purpose])
    ]);
    const statuses = evidence.rows.map((row) => text(row, 'status'));
    const evidenceState: EvidenceState = statuses.includes('QUARANTINED') ? 'QUARANTINED'
      : statuses.includes('PRESERVED') ? 'TRUSTED'
        : statuses.length > 0 ? 'AMBIGUOUS' : 'MISSING';
    const provenance: HumanSafetyProvenanceEntry[] = evidence.rows.map((row) => ({
      evidenceId: text(row, 'id'), sourceType: 'INFRASTRUCTURE',
      integrity: text(row, 'status') === 'PRESERVED' ? 'VERIFIED' : 'UNVERIFIED',
      receivedAt: timestamp(row, 'created_at'),
      status: text(row, 'status') === 'QUARANTINED' ? 'QUARANTINED' : 'ACTIVE'
    }));
    const audit: HumanSafetyAuditEntry[] = [
      ...contactAudit.rows.map((row): HumanSafetyAuditEntry => ({
        eventId: text(row, 'event_id'), action: text(row, 'event_type'), actorId: text(row, 'actor_id'),
        actorRole: role(text(row, 'authorized_by_role')), reason: text(row, 'reason_code'),
        reasonCode: text(row, 'reason_code'), traceId: text(row, 'trace_id'),
        occurredAt: timestamp(row, 'occurred_at'), caseVersion: integer(row, 'session_version'), immutable: true
      })),
      ...eventAudit.rows.map((row): HumanSafetyAuditEntry => ({
        eventId: text(row, 'id'), action: text(row, 'action'), actorId: nullableText(row, 'actor_id') ?? 'system',
        actorRole: role(text(row, 'actor_type')), reason: nullableText(row, 'reason') ?? text(row, 'action'),
        reasonCode: text(row, 'action'), traceId: text(row, 'trace_id'), occurredAt: timestamp(row, 'occurred_at'),
        caseVersion: integer(row, 'version'), immutable: true
      }))
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    return {
      contact: contact.rows[0] === undefined ? null : mapContact(contact.rows[0]),
      recommendation: recommendation.rows[0] === undefined ? null : mapRecommendation(recommendation.rows[0]),
      evidenceState, provenance, audit
    };
  }

  async mutate(input: {
    readonly tenantId: string; readonly caseId: string; readonly sessionId: string;
    readonly expectedContactVersion: number; readonly action: HumanSafetyContactAction;
    readonly actorId: string; readonly actorRole: 'OPERATOR' | 'SUPERVISOR'; readonly assigneeId?: string;
    readonly reason: string; readonly traceId: string; readonly occurredAt: string;
  }): Promise<void> {
    await this.contacts.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(input);
      if (current === null) throw new HumanSafetyHttpError(409, 'CONTACT_SESSION_REQUIRED', 'A durable contact session is required');
      if (current.version !== input.expectedContactVersion) throw new HumanSafetyHttpError(409, 'VERSION_CONFLICT', 'Contact session version is stale');
      let nextState = current.state;
      let assignedOperatorId = current.assignedOperatorId;
      let suppressAutomation = current.automationSuppressed;
      if (input.action === 'takeover') {
        const decision = decideHumanContactTransition(current, 'OPERATOR_TAKEOVER', {
          actorId: input.actorId, actorRoles: [input.actorRole], occurredAt: input.occurredAt,
          reason: input.reason, traceId: input.traceId, channelHealthy: true,
          accessibilitySatisfied: true, expectedVersion: current.version
        });
        if (!decision.allowed) throw new HumanSafetyHttpError(409, 'TRANSITION_REJECTED', decision.reasonCode);
        nextState = 'OPERATOR_TAKEOVER'; assignedOperatorId = input.actorId; suppressAutomation = true;
      } else if (input.action === 'escalate') {
        const decision = decideHumanContactTransition(current, 'ESCALATED', {
          actorId: input.actorId, actorRoles: [input.actorRole], occurredAt: input.occurredAt,
          reason: input.reason, traceId: input.traceId, channelHealthy: true,
          accessibilitySatisfied: true, expectedVersion: current.version
        });
        if (!decision.allowed) throw new HumanSafetyHttpError(409, 'TRANSITION_REJECTED', decision.reasonCode);
        nextState = 'ESCALATED'; suppressAutomation = true;
      } else {
        assignedOperatorId = input.assigneeId!; suppressAutomation = true;
      }
      const next: ContactSessionRecord = {
        ...current, state: nextState, assignedOperatorId, automationSuppressed: suppressAutomation,
        nextActionAt: suppressAutomation ? null : current.nextActionAt,
        responseDeadlineAt: suppressAutomation ? null : current.responseDeadlineAt,
        leaseOwner: null, leaseExpiresAt: null, version: current.version + 1,
        lastInteractionAt: input.occurredAt, updatedAt: input.occurredAt
      };
      if (suppressAutomation) await tx.cancelPendingAutomation(input, input.occurredAt);
      if ((await tx.updateSession(next, current.version)) !== 'UPDATED') {
        throw new HumanSafetyHttpError(409, 'VERSION_CONFLICT', 'Contact session changed concurrently');
      }
      const eventType = input.action === 'takeover' ? 'OPERATOR_TAKEOVER'
        : input.action === 'escalate' ? 'OPERATOR_ESCALATION' : 'OPERATOR_ASSIGNMENT';
      const eventId = `mvp-${createHash('sha256').update(`${input.tenantId}|${input.caseId}|${input.sessionId}|${next.version}|${eventType}`).digest('hex')}`;
      const audit: ContactAuditEvent = {
        tenantId: input.tenantId, caseId: input.caseId, sessionId: input.sessionId,
        eventId, eventType, state: next.state, version: next.version, actorType: 'OPERATOR',
        actorId: input.actorId, authorizedByRole: input.actorRole,
        authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
        reasonCode: input.reason, occurredAt: input.occurredAt, traceId: input.traceId,
        runtimePolicyVersion: CONTACT_RUNTIME_POLICY_VERSION
      };
      await tx.insertAuditIfAbsent(audit);
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', 'body must be an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maximum = 500): string {
  if (typeof value !== 'string') throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', `${field} is invalid`);
  return normalized;
}

function requiredVersion(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', `${field} must be a positive integer`);
  return Number(value);
}

function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', `${field} must be a provisioned UUID`);
  }
  return normalized;
}

function numberQuery(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', 'pagination values must be non-negative integers');
  return parsed;
}

function requireRole(actor: AuthenticatedActor, allowed: readonly AuthenticatedActor['roles'][number][]): void {
  if (!actor.roles.some((candidate) => allowed.includes(candidate))) {
    throw new HumanSafetyHttpError(403, 'FORBIDDEN', 'Human Safety authority is required');
  }
}

function primaryHumanRole(actor: AuthenticatedActor): 'OPERATOR' | 'SUPERVISOR' {
  if (actor.roles.includes('SUPERVISOR')) return 'SUPERVISOR';
  if (actor.roles.includes('OPERATOR')) return 'OPERATOR';
  throw new HumanSafetyHttpError(403, 'FORBIDDEN', 'Operational Human Safety authority is required');
}

function stateOf(event: RoadEventReadModel, contact: ContactSessionRecord | null): HumanSafetyCaseContract['state'] {
  if (event.closureAuthorization !== null) return 'RESOLVED';
  if (contact === null) return event.severity.requiresHumanReview ? 'HUMAN_REVIEW' : 'UNKNOWN';
  const states: Readonly<Record<ContactSessionRecord['state'], HumanSafetyCaseContract['state']>> = {
    CREATED: 'CONTACT_PENDING', CONSENT_PENDING: 'CONTACT_PENDING', LANGUAGE_SELECTION: 'CONTACTING',
    CONTACTING: 'CONTACTING', AWAITING_RESPONSE: 'CONTACTING', PARTIAL_RESPONSE: 'RESPONDED',
    RESPONSE_CONFIRMED: 'RESPONDED', DISCONNECTED: 'UNREACHABLE', NO_RESPONSE: 'NO_RESPONSE',
    UNREACHABLE: 'UNREACHABLE', OPERATOR_TAKEOVER: 'HUMAN_REVIEW', HUMAN_REVIEW: 'HUMAN_REVIEW',
    ESCALATED: 'ESCALATED', COMPLETED: 'MONITORED'
  };
  return states[contact.state];
}

function view(event: RoadEventReadModel, actor: AuthenticatedActor, backing: HumanSafetyBacking): HumanSafetyCaseView {
  const contact = backing.contact;
  const authorization = event.closureAuthorization;
  return {
    tenantId: actor.tenantId,
    safetyCase: {
      id: event.id, roadEventId: event.id, state: stateOf(event, contact),
      severity: event.severity.level as HumanSafetyCaseContract['severity'], version: event.version,
      severityAssessmentVersion: event.version, evidenceRevision: backing.provenance.length,
      indicatorRevision: 0, openedAt: event.occurredAt,
      nextDeadlineAt: contact?.responseDeadlineAt ?? null, activeChannel: contact?.activeChannel ?? null,
      assignedActorId: contact?.assignedOperatorId ?? null, indicators: [],
      highRiskResolutionAuthorization: authorization === null ? null : {
        caseId: event.id, decision: 'RESOLVE', actorId: authorization.actorId, role: 'SUPERVISOR',
        reason: authorization.reason, authorizedAt: authorization.authorizedAt,
        expiresAt: new Date(Date.parse(authorization.authorizedAt) + 5 * 60_000).toISOString(),
        caseVersion: Math.max(1, event.version - 1), severityAssessmentVersion: Math.max(1, event.version - 1),
        evidenceRevision: backing.provenance.length, indicatorRevision: 0,
        connectivity: 'HEALTHY', dependenciesHealthy: true
      }
    },
    contactSession: contact === null ? null : contact,
    recommendation: backing.recommendation,
    evidenceState: backing.evidenceState,
    connectivity: 'HEALTHY', dependencyHealth: 'HEALTHY',
    provenance: backing.provenance, audit: backing.audit
  };
}

function envelope(success: boolean, data: unknown, error: { readonly code: string; readonly message: string } | null, traceId: string) {
  return { success, data, error, traceId };
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function operationScope(action: string, actor: AuthenticatedActor): string {
  return `human-safety:${action}:${fingerprint([actor.tenantId, actor.purpose, actor.actorId]).slice(0, 32)}`;
}

async function idempotent<T>(
  idempotency: IdempotencyPort,
  scope: string,
  key: string,
  input: unknown,
  operation: () => Promise<T>
): Promise<T> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', 'Idempotency-Key is invalid');
  const requestFingerprint = fingerprint(input);
  try {
    return await idempotency.executeExclusively(scope, key, async () => {
      const replay = await idempotency.get<T>(scope, key);
      if (replay !== undefined) {
        if (replay.fingerprint !== requestFingerprint) throw new IdempotencyConflictError('Idempotency key was reused with a different request');
        return replay.value;
      }
      const result = await operation();
      await idempotency.put(scope, key, { fingerprint: requestFingerprint, value: result });
      return result;
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) throw new ApplicationConflictError(error.message);
    throw error;
  }
}

function mapError(error: unknown, traceId: string): HttpResponse {
  if (error instanceof HumanSafetyHttpError) return { status: error.status, body: envelope(false, null, { code: error.code, message: error.message }, traceId) };
  if (error instanceof AuthorizationDeniedError) return { status: 403, body: envelope(false, null, { code: 'FORBIDDEN', message: error.message }, traceId) };
  if (error instanceof IdempotencyConflictError || error instanceof ApplicationConflictError) return { status: 409, body: envelope(false, null, { code: 'CONFLICT', message: error.message }, traceId) };
  if (error instanceof Error && error.name === 'RoadEventNotFoundError') return { status: 404, body: envelope(false, null, { code: 'NOT_FOUND', message: 'Human Safety case was not found' }, traceId) };
  return { status: 500, body: envelope(false, null, { code: 'INTERNAL_ERROR', message: 'Unexpected Human Safety error' }, traceId) };
}

export function createHumanSafetyHttpHandler(
  application: RoadEventApplicationService,
  store: HumanSafetyStore | null,
  idempotency: IdempotencyPort,
  actorResolver: ActorResolver,
  now: () => Date = () => new Date()
): (request: HttpRequest) => Promise<HttpResponse | undefined> {
  return async (request) => {
    if (!request.path.startsWith('/api/v1/human-safety/')) return undefined;
    if (store === null) return { status: 503, body: envelope(false, null, { code: 'HUMAN_SAFETY_UNAVAILABLE', message: 'Persistent Human Safety runtime is unavailable' }, request.traceId) };
    try {
      const actor = await actorResolver.resolve(request.headers);
      const caseMatch = /^\/api\/v1\/human-safety\/cases\/([0-9a-f-]+)$/.exec(request.path);
      const actionMatch = /^\/api\/v1\/human-safety\/cases\/([0-9a-f-]+)\/(takeover|escalate|assignment|resolution-authorization)$/.exec(request.path);
      if (request.path === '/api/v1/human-safety/cases') {
        if (request.method !== 'GET') throw new HumanSafetyHttpError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported');
        requireRole(actor, ['OPERATOR', 'SUPERVISOR', 'AUDITOR']);
        const limit = Math.min(numberQuery(request.query.limit, 20), 100);
        const offset = numberQuery(request.query.offset, 0);
        const page = await application.list({ limit, offset }, actor);
        const items = await Promise.all(page.items.map(async (event) => view(event, actor, await store.read(actor, event.id))));
        return { status: 200, body: envelope(true, { items, generatedAt: now().toISOString(), simulation: false }, null, request.traceId) };
      }
      if (caseMatch !== null) {
        if (request.method !== 'GET') throw new HumanSafetyHttpError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported');
        requireRole(actor, ['OPERATOR', 'SUPERVISOR', 'AUDITOR']);
        const event = await application.getById(caseMatch[1]!, actor);
        return { status: 200, body: envelope(true, view(event, actor, await store.read(actor, event.id)), null, request.traceId) };
      }
      if (actionMatch === null) throw new HumanSafetyHttpError(404, 'NOT_FOUND', 'Route not found');
      if (request.method !== 'POST') throw new HumanSafetyHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
      const caseId = actionMatch[1]!;
      const action = actionMatch[2]!;
      const body = record(request.body);
      const reason = requiredString(body.reason, 'reason');
      const expectedCaseVersion = requiredVersion(body.expectedCaseVersion, 'expectedCaseVersion');
      const expectedContactVersion = body.expectedContactVersion === null ? null : requiredVersion(body.expectedContactVersion, 'expectedContactVersion');
      const key = requiredString(request.headers['idempotency-key'], 'Idempotency-Key', 128);
      if (body.idempotencyKey !== undefined && requiredString(body.idempotencyKey, 'idempotencyKey', 128) !== key) {
        throw new HumanSafetyHttpError(400, 'INVALID_REQUEST', 'Body idempotencyKey must match Idempotency-Key header');
      }
      requireRole(actor, action === 'assignment' || action === 'resolution-authorization' ? ['SUPERVISOR'] : ['OPERATOR', 'SUPERVISOR']);
      // Resource authorization deliberately happens before any idempotency lookup.
      await application.getById(caseId, actor);
      const assigneeId = action === 'assignment' ? requiredUuid(body.assigneeId, 'assigneeId') : undefined;
      const result = await idempotent(idempotency, operationScope(action, actor), key, {
        caseId, action, expectedCaseVersion, expectedContactVersion, reason, assigneeId
      }, async () => {
        const event = await application.getById(caseId, actor);
        if (event.version !== expectedCaseVersion) throw new HumanSafetyHttpError(409, 'VERSION_CONFLICT', 'Human Safety case version is stale');
        const backing = await store.read(actor, caseId);
        if (action === 'resolution-authorization') {
          if (backing.evidenceState !== 'TRUSTED') throw new HumanSafetyHttpError(409, 'EVIDENCE_NOT_TRUSTED', 'Trusted preserved evidence is required');
          await application.authorizeClosure({
            roadEventId: caseId, expectedVersion: event.version, reason, authorizedAt: now().toISOString()
          }, { actor, traceId: request.traceId, idempotencyKey: key });
        } else {
          if (backing.contact === null || expectedContactVersion === null) throw new HumanSafetyHttpError(409, 'CONTACT_SESSION_REQUIRED', 'A current contact session version is required');
          await store.mutate({
            tenantId: actor.tenantId, caseId, sessionId: backing.contact.sessionId,
            expectedContactVersion, action: action as HumanSafetyContactAction,
            actorId: actor.actorId, actorRole: primaryHumanRole(actor),
            ...(assigneeId === undefined ? {} : { assigneeId }), reason,
            traceId: request.traceId, occurredAt: now().toISOString()
          });
        }
        const updatedEvent = await application.getById(caseId, actor);
        return view(updatedEvent, actor, await store.read(actor, caseId));
      });
      return { status: 200, body: envelope(true, result, null, request.traceId) };
    } catch (error) {
      return mapError(error, request.traceId);
    }
  };
}
