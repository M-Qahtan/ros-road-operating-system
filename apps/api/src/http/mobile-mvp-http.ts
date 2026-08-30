import { createHash } from 'node:crypto';
import { RoadEvent, RoadEventAccessScope, RoadEventRepository, RoadEventStatus, SeverityLevel } from '@ros/domain';
import { HumanContactReplyOption, HumanContactState } from '@ros/contracts';
import { AuthenticatedActor, FieldCompanionDeviceAuthorizationPort, IdempotencyInFlightError, IdempotencyPort } from '../application/ports.js';
import { ApplicationConflictError, IdempotencyConflictError } from '../application/road-event-application.js';
import { AuthorizationDeniedError } from '../application/local-adapters.js';
import {
  CallbackInput,
  CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
  CONTACT_RUNTIME_POLICY_VERSION,
  ContactAuditEvent,
  ContactOrchestrationService,
  ContactRuntimeRepositoryPort,
  ContactScope,
  ContactSessionRecord,
  OpenContactInput,
  RuntimeDisposition
} from '../ros-eye/contact-orchestration.js';
import { ContactSqlPoolPort, ContactSqlRow } from '../ros-eye/contact-orchestration-postgres.js';
import { ActorResolver } from './actor-resolver.js';
import { HttpRequest, HttpResponse } from './road-event-http.js';

type DeliveryDisposition = 'ACCEPTED' | 'DUPLICATE' | 'HUMAN_REVIEW' | 'OPERATOR_TAKEOVER';
type DeliveryOperationKind = 'STRUCTURED_REPLY' | 'DEVICE_METADATA' | 'RECONNECT' | 'CONSENT' | 'LANGUAGE_SELECTION';

export interface ContactOrchestrationPort {
  open(input: OpenContactInput): Promise<RuntimeDisposition>;
  handleCallback(input: CallbackInput): Promise<RuntimeDisposition>;
}

export interface MobileMvpHttpOptions {
  readonly contactOrchestration?: Pick<ContactOrchestrationService, 'open' | 'handleCallback'> | ContactOrchestrationPort | null;
  readonly devices?: FieldCompanionDeviceRegistryPort | null;
  readonly now?: () => Date;
}

export interface FieldCompanionDeviceBinding {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly actorId: string;
  readonly platform: 'WEB';
  readonly appVersion: string;
  readonly consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1';
  readonly clientConsentedAt: string;
  readonly consentGrantedAt: string;
  readonly registeredAt: string;
}

export interface FieldCompanionDeviceRegistryPort extends FieldCompanionDeviceAuthorizationPort {
  findBinding(deviceId: string): Promise<FieldCompanionDeviceBinding | null>;
  register(input: FieldCompanionDeviceBinding & { readonly observedAt: string; readonly traceId: string }): Promise<{
    readonly disposition: 'REGISTERED' | 'IDEMPOTENT';
    readonly registeredAt: string;
    readonly consentGrantedAt: string;
  }>;
}

export interface FieldCompanionDeliveryReceipt {
  readonly idempotencyKey: string;
  readonly disposition: DeliveryDisposition;
  readonly contactState: HumanContactState;
  readonly statusMessageCode: string;
  readonly receivedAt: string;
}

export interface FieldCompanionOperation {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly kind: DeliveryOperationKind;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly attemptCount: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FieldCompanionStore {
  deliver(input: {
    readonly tenantId: string; readonly caseId: string; readonly sessionId: string;
    readonly actorId: string; readonly traceId: string; readonly receivedAt: string;
    readonly operation: FieldCompanionOperation;
  }): Promise<Omit<FieldCompanionDeliveryReceipt, 'idempotencyKey' | 'receivedAt'>>;
  readSession(scope: ContactScope): Promise<ContactSessionRecord | null>;
}

export interface NotificationAuditPort {
  recordDelivered(actor: AuthenticatedActor, notificationIds: readonly string[], deliveredAt: string): Promise<void>;
  acknowledgedAt(actor: AuthenticatedActor, notificationIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  acknowledge(actor: AuthenticatedActor, notificationId: string, traceId: string, occurredAt: string): Promise<{
    readonly disposition: 'ACKNOWLEDGED' | 'IDEMPOTENT';
    readonly acknowledgedAt: string;
  }>;
}

export class MobileMvpHttpError extends Error {
  override readonly name = 'MobileMvpHttpError';
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function envelope(success: boolean, data: unknown, error: { readonly code: string; readonly message: string } | null, traceId: string) {
  return { success, data, error, traceId };
}

function record(value: unknown, field = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', `${field} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maximum = 128): string {
  if (typeof value !== 'string') throw new MobileMvpHttpError(400, 'INVALID_REQUEST', `${field} must be a string`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized) || normalized.length < 3 || normalized.length > maximum) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', `${field} is invalid`);
  }
  return normalized;
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', `${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function appVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value)) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'appVersion is invalid');
  }
  return value;
}

function consentOccurredAt(value: unknown, evaluatedAt: Date): string {
  if (typeof value !== 'string') throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'consent.occurredAt must be an ISO timestamp');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > evaluatedAt.getTime() + 5 * 60_000 || parsed < evaluatedAt.getTime() - 24 * 60 * 60_000) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'consent.occurredAt is invalid');
  }
  return new Date(parsed).toISOString();
}

function finite(value: string | undefined, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', `${field} is invalid`);
  return parsed;
}

function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function operationScope(operation: string, actor: AuthenticatedActor): string {
  return `mobile:${operation}:${fingerprint([actor.tenantId, actor.purpose, actor.actorId, [...new Set(actor.roles)].sort()]).slice(0, 40)}`;
}

async function idempotentOutcome<T>(idempotency: IdempotencyPort, scope: string, key: string, input: unknown, operation: () => Promise<T>): Promise<{ readonly value: T; readonly replayed: boolean }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Idempotency-Key is invalid');
  const requestFingerprint = fingerprint(input);
  try {
    return await idempotency.executeExclusively(scope, key, async () => {
      const replay = await idempotency.get<T>(scope, key);
      if (replay !== undefined) {
        if (replay.fingerprint !== requestFingerprint) throw new IdempotencyConflictError('Idempotency key was reused with a different request');
        return { value: replay.value, replayed: true };
      }
      const result = await operation();
      await idempotency.put(scope, key, { fingerprint: requestFingerprint, value: result });
      return { value: result, replayed: false };
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) throw new ApplicationConflictError(error.message);
    throw error;
  }
}

async function idempotent<T>(idempotency: IdempotencyPort, scope: string, key: string, input: unknown, operation: () => Promise<T>): Promise<T> {
  return (await idempotentOutcome(idempotency, scope, key, input, operation)).value;
}

function validateOperation(value: unknown, headerKey: string, now: Date): FieldCompanionOperation {
  const input = record(value, 'operation');
  const operationId = requiredString(input.operationId, 'operation.operationId');
  const idempotencyKey = requiredString(input.idempotencyKey, 'operation.idempotencyKey');
  if (idempotencyKey !== headerKey) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Operation idempotencyKey must match Idempotency-Key header');
  if (!['STRUCTURED_REPLY', 'DEVICE_METADATA', 'RECONNECT', 'CONSENT', 'LANGUAGE_SELECTION'].includes(String(input.kind))) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'operation.kind is invalid');
  }
  const createdAt = requiredString(input.createdAt, 'operation.createdAt');
  const expiresAt = requiredString(input.expiresAt, 'operation.expiresAt');
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires <= now.getTime() || created > now.getTime() + 5 * 60_000) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'operation time window is invalid or expired');
  }
  if (!Number.isSafeInteger(input.attemptCount) || Number(input.attemptCount) < 0 || Number(input.attemptCount) > 20) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'operation.attemptCount is invalid');
  }
  const payload = record(input.payload, 'operation.payload');
  if (input.kind === 'CONSENT' && !['GRANTED', 'DECLINED'].includes(String(payload.decision))) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'operation.payload.decision must be GRANTED or DECLINED');
  }
  if (input.kind === 'LANGUAGE_SELECTION' && !['ar', 'en'].includes(String(payload.language))) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'operation.payload.language must be ar or en');
  }
  return { operationId, idempotencyKey, kind: input.kind as DeliveryOperationKind, createdAt, expiresAt, attemptCount: Number(input.attemptCount), payload };
}

const REPLY_OPTIONS = new Set<HumanContactReplyOption>(['YES', 'NO', 'UNKNOWN', 'HELP_REQUESTED', 'CANNOT_SPEAK', 'ACCESSIBILITY_SUPPORT_REQUIRED']);

function structuredOptions(operation: FieldCompanionOperation): readonly HumanContactReplyOption[] {
  const options = operation.payload.selectedOptions;
  if (!Array.isArray(options) || options.length === 0 || options.some((item) => typeof item !== 'string' || !REPLY_OPTIONS.has(item as HumanContactReplyOption))) {
    throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Structured reply options are invalid');
  }
  if (new Set(options).size !== options.length) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Structured reply options must be unique');
  return options as HumanContactReplyOption[];
}

function nextContactState(current: ContactSessionRecord, operation: FieldCompanionOperation): HumanContactState {
  if (operation.kind === 'RECONNECT') return current.state === 'DISCONNECTED' ? 'CONTACTING' : current.state;
  if (operation.kind === 'DEVICE_METADATA') {
    return ['POSSIBLE_IMPACT', 'POSSIBLE_ROLLOVER'].includes(String(operation.payload.motion)) ? 'HUMAN_REVIEW' : current.state;
  }
  if (operation.kind !== 'STRUCTURED_REPLY') {
    throw new MobileMvpHttpError(503, 'CONTACT_ORCHESTRATION_UNAVAILABLE', 'Durable contact orchestration is required for this operation');
  }
  const options = structuredOptions(operation);
  if ((options.includes('YES') && options.includes('NO')) || options.some((option) => ['HELP_REQUESTED', 'CANNOT_SPEAK', 'ACCESSIBILITY_SUPPORT_REQUIRED'].includes(option))) {
    return 'HUMAN_REVIEW';
  }
  return ['AWAITING_RESPONSE', 'PARTIAL_RESPONSE'].includes(current.state) ? 'RESPONSE_CONFIRMED' : 'HUMAN_REVIEW';
}

export class DurableFieldCompanionStore implements FieldCompanionStore {
  constructor(private readonly contacts: ContactRuntimeRepositoryPort) {}

  async deliver(input: {
    readonly tenantId: string; readonly caseId: string; readonly sessionId: string;
    readonly actorId: string; readonly traceId: string; readonly receivedAt: string;
    readonly operation: FieldCompanionOperation;
  }): Promise<Omit<FieldCompanionDeliveryReceipt, 'idempotencyKey' | 'receivedAt'>> {
    return this.contacts.transaction(async (tx) => {
      const current = await tx.getSessionForUpdate(input);
      if (current === null) throw new MobileMvpHttpError(404, 'CONTACT_SESSION_NOT_FOUND', 'Contact session was not found');
      const state = nextContactState(current, input.operation);
      const humanReview = state === 'HUMAN_REVIEW';
      const next: ContactSessionRecord = {
        ...current, state, version: current.version + 1, lastInteractionAt: input.receivedAt, updatedAt: input.receivedAt,
        automationSuppressed: humanReview || current.automationSuppressed,
        nextActionAt: humanReview ? null : current.nextActionAt,
        responseDeadlineAt: humanReview ? null : current.responseDeadlineAt,
        leaseOwner: null, leaseExpiresAt: null
      };
      if (humanReview) await tx.cancelPendingAutomation(input, input.receivedAt);
      if ((await tx.updateSession(next, current.version)) !== 'UPDATED') throw new MobileMvpHttpError(409, 'VERSION_CONFLICT', 'Contact session changed concurrently');
      const eventType = `FIELD_COMPANION_${input.operation.kind}`;
      const audit: ContactAuditEvent = {
        tenantId: input.tenantId, caseId: input.caseId, sessionId: input.sessionId,
        eventId: `mvp-${fingerprint([input.tenantId, input.caseId, input.sessionId, input.operation.operationId])}`,
        eventType, state: next.state, version: next.version, actorType: 'SYSTEM', actorId: input.actorId,
        authorizedByRole: 'SYSTEM', authorityPolicyVersion: CONTACT_OPERATOR_AUTHORITY_POLICY_VERSION,
        reasonCode: humanReview ? 'field_companion_human_review' : 'field_companion_delivery_accepted',
        occurredAt: input.receivedAt, traceId: input.traceId, runtimePolicyVersion: CONTACT_RUNTIME_POLICY_VERSION
      };
      await tx.insertAuditIfAbsent(audit);
      return {
        disposition: humanReview ? 'HUMAN_REVIEW' : state === 'OPERATOR_TAKEOVER' ? 'OPERATOR_TAKEOVER' : 'ACCEPTED',
        contactState: state,
        statusMessageCode: humanReview ? 'human_review_required' : 'delivery_accepted'
      };
    });
  }

  async readSession(scope: ContactScope): Promise<ContactSessionRecord | null> {
    return this.contacts.transaction(async (tx) => tx.getSessionForUpdate(scope));
  }
}

function databaseUuid(value: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function canonicalActorType(actor: AuthenticatedActor): string {
  return (['SUPERVISOR', 'OPERATOR', 'INTEGRATION_SERVICE', 'FIELD_USER', 'AUDITOR'] as const)
    .find((role) => actor.roles.includes(role)) ?? 'INTEGRATION_SERVICE';
}

export class PostgresNotificationAudit implements NotificationAuditPort {
  constructor(private readonly sql: ContactSqlPoolPort) {}

  async acknowledgedAt(actor: AuthenticatedActor, notificationIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (notificationIds.length === 0) return new Map();
    const result = await this.sql.query(`SELECT notification_id,acknowledged_at
      FROM field_notification_deliveries
      WHERE recipient_actor_id=$1::uuid AND tenant_id=$2 AND purpose=$3
        AND notification_id=ANY($4::uuid[]) AND acknowledged_at IS NOT NULL`,
    [actor.actorId, actor.tenantId, actor.purpose, notificationIds]);
    const acknowledgements = new Map<string, string>();
    for (const row of result.rows) {
      const id = String(row.notification_id);
      acknowledgements.set(id, new Date(String(row.acknowledged_at)).toISOString());
    }
    return acknowledgements;
  }

  async recordDelivered(actor: AuthenticatedActor, notificationIds: readonly string[], deliveredAt: string): Promise<void> {
    if (notificationIds.length === 0) return;
    await this.sql.query(`INSERT INTO field_notification_deliveries
      (tenant_id,purpose,notification_id,recipient_actor_id,delivered_at)
      SELECT $1,$2,notification_id,$3::uuid,$4::timestamptz FROM unnest($5::uuid[]) AS notification_id
      ON CONFLICT (tenant_id,purpose,notification_id,recipient_actor_id) DO NOTHING`,
    [actor.tenantId, actor.purpose, actor.actorId, deliveredAt, notificationIds]);
  }

  async acknowledge(actor: AuthenticatedActor, notificationId: string, traceId: string, occurredAt: string): Promise<{
    readonly disposition: 'ACKNOWLEDGED' | 'IDEMPOTENT'; readonly acknowledgedAt: string;
  }> {
    return this.sql.transaction(async (connection) => {
      const delivery = await connection.query(`SELECT acknowledged_at FROM field_notification_deliveries
        WHERE notification_id=$1::uuid AND tenant_id=$2 AND purpose=$3 AND recipient_actor_id=$4::uuid
        FOR UPDATE`, [notificationId, actor.tenantId, actor.purpose, actor.actorId]);
      const row = delivery.rows[0];
      if (row === undefined) throw new MobileMvpHttpError(404, 'NOTIFICATION_NOT_DELIVERED', 'Notification was not delivered to this principal');
      if (row.acknowledged_at !== null && row.acknowledged_at !== undefined) {
        return { disposition: 'IDEMPOTENT', acknowledgedAt: new Date(String(row.acknowledged_at)).toISOString() };
      }
      await connection.query(`UPDATE field_notification_deliveries SET acknowledged_at=$5::timestamptz
        WHERE notification_id=$1::uuid AND tenant_id=$2 AND purpose=$3 AND recipient_actor_id=$4::uuid
          AND acknowledged_at IS NULL`, [notificationId, actor.tenantId, actor.purpose, actor.actorId, occurredAt]);
      const payload = { notificationId, acknowledgedAt: occurredAt };
      await connection.query(`INSERT INTO audit_logs
        (actor_type,actor_id,action,resource_type,resource_id,before_state,after_state,reason,trace_id,occurred_at)
        VALUES ($1,$2::uuid,'nearby_notification.acknowledged','RoadEvent',$3::uuid,NULL,$4::jsonb,'user_acknowledged',$5::uuid,$6::timestamptz)`,
      [canonicalActorType(actor), actor.actorId, notificationId, JSON.stringify(payload), databaseUuid(traceId), occurredAt]);
      await connection.query(`INSERT INTO road_event_timeline
        (road_event_id,event_type,actor_type,actor_id,payload,trace_id,occurred_at)
        VALUES ($1::uuid,'NearbyNotificationAcknowledged',$2,$3::uuid,$4::jsonb,$5::uuid,$6::timestamptz)`,
      [notificationId, canonicalActorType(actor), actor.actorId, JSON.stringify(payload), databaseUuid(traceId), occurredAt]);
      return { disposition: 'ACKNOWLEDGED', acknowledgedAt: occurredAt };
    });
  }
}

export class PostgresFieldCompanionDeviceRegistry implements FieldCompanionDeviceRegistryPort {
  constructor(private readonly sql: ContactSqlPoolPort) {}

  async findBinding(deviceId: string): Promise<FieldCompanionDeviceBinding | null> {
    const result = await this.sql.query(`SELECT device_id,tenant_id,purpose,actor_id,platform,app_version,
      consent_policy_version,client_consented_at,consent_granted_at,registered_at
      FROM field_companion_devices WHERE device_id=$1::uuid`, [deviceId]);
    return result.rows[0] === undefined ? null : mapDeviceBinding(result.rows[0]);
  }

  async assertActive(actor: AuthenticatedActor, deviceId: string): Promise<void> {
    const binding = await this.findBinding(deviceId);
    if (binding === null || binding.actorId !== actor.actorId || binding.tenantId !== actor.tenantId || binding.purpose !== actor.purpose) {
      throw new AuthorizationDeniedError('An ACTIVE device registration for the trusted FIELD_USER principal is required');
    }
  }

  async register(input: FieldCompanionDeviceBinding & { readonly observedAt: string; readonly traceId: string }): Promise<{
    readonly disposition: 'REGISTERED' | 'IDEMPOTENT';
    readonly registeredAt: string;
    readonly consentGrantedAt: string;
  }> {
    return this.sql.transaction(async (connection) => {
      const existingResult = await connection.query(`SELECT device_id,tenant_id,purpose,actor_id,platform,app_version,
        consent_policy_version,client_consented_at,consent_granted_at,registered_at
        FROM field_companion_devices WHERE device_id=$1::uuid FOR UPDATE`, [input.deviceId]);
      const existing = existingResult.rows[0] === undefined ? null : mapDeviceBinding(existingResult.rows[0]);
      if (existing !== null) {
        if (existing.tenantId !== input.tenantId || existing.purpose !== input.purpose || existing.actorId !== input.actorId) {
          throw new MobileMvpHttpError(409, 'DEVICE_REBIND_FORBIDDEN', 'Device registration is bound to another trusted principal');
        }
        const identical = existing.platform === input.platform && existing.appVersion === input.appVersion &&
          existing.consentPolicyVersion === input.consentPolicyVersion && existing.clientConsentedAt === input.clientConsentedAt;
        if (identical) {
          await connection.query(`UPDATE field_companion_devices SET
            status='ACTIVE',last_seen_at=$2::timestamptz
            WHERE device_id=$1::uuid AND actor_id=$3::uuid AND tenant_id=$4 AND purpose=$5`, [
            input.deviceId, input.observedAt, input.actorId, input.tenantId, input.purpose
          ]);
          await this.appendDeviceAudit(connection, {
            ...input, registeredAt: existing.registeredAt, consentGrantedAt: existing.consentGrantedAt
          }, 'field_companion.device_registration_refreshed');
          return { disposition: 'IDEMPOTENT', registeredAt: existing.registeredAt, consentGrantedAt: existing.consentGrantedAt };
        }
        await connection.query(`UPDATE field_companion_devices SET
          platform=$2,app_version=$3,consent_policy_version=$4,client_consented_at=$5::timestamptz,
          consent_granted_at=$6::timestamptz,status='ACTIVE',last_seen_at=$7::timestamptz
          WHERE device_id=$1::uuid AND actor_id=$8::uuid AND tenant_id=$9 AND purpose=$10`, [
          input.deviceId, input.platform, input.appVersion, input.consentPolicyVersion,
          input.clientConsentedAt, input.consentGrantedAt, input.observedAt,
          input.actorId, input.tenantId, input.purpose
        ]);
        await this.appendDeviceAudit(connection, {
          ...input, registeredAt: existing.registeredAt
        }, 'field_companion.device_registration_renewed');
        return { disposition: 'REGISTERED', registeredAt: existing.registeredAt, consentGrantedAt: input.consentGrantedAt };
      }
      await connection.query(`INSERT INTO field_companion_devices
        (device_id,tenant_id,purpose,actor_id,platform,app_version,status,consent_policy_version,
         client_consented_at,consent_granted_at,registered_at,last_seen_at)
        VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,'ACTIVE',$7,$8::timestamptz,$9::timestamptz,$9::timestamptz,$9::timestamptz)`, [
        input.deviceId, input.tenantId, input.purpose, input.actorId, input.platform,
        input.appVersion, input.consentPolicyVersion, input.clientConsentedAt, input.consentGrantedAt
      ]);
      await this.appendDeviceAudit(connection, input, 'field_companion.device_registered');
      return { disposition: 'REGISTERED', registeredAt: input.registeredAt, consentGrantedAt: input.consentGrantedAt };
    });
  }

  private async appendDeviceAudit(
    connection: { query(text: string, values?: readonly unknown[]): Promise<{ readonly rowCount: number }> },
    input: FieldCompanionDeviceBinding & { readonly observedAt: string; readonly traceId: string },
    action: string
  ): Promise<void> {
    const receipt = {
      deviceId: input.deviceId,
      platform: input.platform,
      appVersion: input.appVersion,
      status: 'ACTIVE',
      consentPolicyVersion: input.consentPolicyVersion,
      clientConsentedAt: input.clientConsentedAt,
      consentGrantedAt: input.consentGrantedAt,
      registeredAt: input.registeredAt
    };
    await connection.query(`INSERT INTO audit_logs
      (actor_type,actor_id,action,resource_type,resource_id,before_state,after_state,reason,trace_id,occurred_at)
      VALUES ('FIELD_USER',$1::uuid,$2,'FieldCompanionDevice',$3::uuid,NULL,$4::jsonb,'trusted_device_registration',$5::uuid,$6::timestamptz)`,
    [input.actorId, action, input.deviceId, JSON.stringify(receipt), databaseUuid(input.traceId), input.observedAt]);
  }
}

function mapDeviceBinding(row: ContactSqlRow): FieldCompanionDeviceBinding {
  const textValue = (key: string): string => {
    const current = row[key];
    if (typeof current !== 'string') throw new Error(`invalid ${key}`);
    return current;
  };
  const timestampValue = (key: string): string => {
    const current = row[key];
    if (current instanceof Date) return current.toISOString();
    if (typeof current === 'string' && Number.isFinite(Date.parse(current))) return new Date(current).toISOString();
    throw new Error(`invalid ${key}`);
  };
  return {
    deviceId: textValue('device_id'), tenantId: textValue('tenant_id'), purpose: textValue('purpose'),
    actorId: textValue('actor_id'), platform: textValue('platform') as 'WEB', appVersion: textValue('app_version'),
    consentPolicyVersion: textValue('consent_policy_version') as FieldCompanionDeviceBinding['consentPolicyVersion'],
    clientConsentedAt: timestampValue('client_consented_at'), consentGrantedAt: timestampValue('consent_granted_at'),
    registeredAt: timestampValue('registered_at')
  };
}

function requireMobileRole(actor: AuthenticatedActor): void {
  if (!actor.roles.some((role) => ['FIELD_USER', 'INTEGRATION_SERVICE', 'OPERATOR', 'SUPERVISOR'].includes(role))) {
    throw new MobileMvpHttpError(403, 'FORBIDDEN', 'Field Companion authority is required');
  }
}

function isFieldUserOnly(actor: AuthenticatedActor): boolean {
  return actor.roles.includes('FIELD_USER') &&
    !actor.roles.some((role) => ['OPERATOR', 'SUPERVISOR', 'INTEGRATION_SERVICE'].includes(role));
}

function ownedResourceScope(actor: AuthenticatedActor): RoadEventAccessScope {
  return {
    tenantId: actor.tenantId,
    purpose: actor.purpose,
    ...(isFieldUserOnly(actor) ? { reporterActorId: actor.actorId } : {})
  };
}

function assertContactOwner(actor: AuthenticatedActor, event: RoadEvent, session: ContactSessionRecord): void {
  if (session.ownerActorId !== event.reporterActorId) {
    throw new MobileMvpHttpError(409, 'CONTACT_OWNER_MISMATCH', 'Contact session ownership does not match its RoadEvent');
  }
  if (isFieldUserOnly(actor) && session.ownerActorId !== actor.actorId) {
    throw new MobileMvpHttpError(404, 'CONTACT_SESSION_NOT_FOUND', 'Contact session was not found');
  }
}

function callbackForOperation(
  actor: AuthenticatedActor,
  caseId: string,
  sessionId: string,
  operation: FieldCompanionOperation,
  traceId: string,
  occurredAt: string,
  ownerActorId: string | null
): CallbackInput {
  const common = {
    tenantId: actor.tenantId,
    caseId,
    sessionId,
    authenticatedTenantId: actor.tenantId,
    authenticatedCaseId: caseId,
    callbackId: operation.operationId,
    traceId,
    occurredAt,
    idempotencyKey: operation.idempotencyKey,
    ownerActorId
  } as const;
  if (operation.kind === 'CONSENT') {
    return { ...common, kind: operation.payload.decision === 'GRANTED' ? 'CONSENT_GRANTED' : 'CONSENT_DECLINED' };
  }
  if (operation.kind === 'LANGUAGE_SELECTION') {
    return { ...common, kind: 'LANGUAGE_SELECTED', selectedLanguage: operation.payload.language as 'ar' | 'en' };
  }
  throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Operation is not a contact protocol callback');
}

function receiptFromSession(
  session: ContactSessionRecord,
  callbackDisposition: RuntimeDisposition
): Omit<FieldCompanionDeliveryReceipt, 'idempotencyKey' | 'receivedAt'> {
  if (session.state === 'HUMAN_REVIEW' || session.state === 'ESCALATED' || callbackDisposition === 'HUMAN_REVIEW' || callbackDisposition === 'ESCALATED') {
    return { disposition: 'HUMAN_REVIEW', contactState: session.state, statusMessageCode: 'human_review_required' };
  }
  if (session.state === 'OPERATOR_TAKEOVER') {
    return { disposition: 'OPERATOR_TAKEOVER', contactState: session.state, statusMessageCode: 'operator_takeover_active' };
  }
  if (callbackDisposition === 'IDEMPOTENT') {
    return { disposition: 'DUPLICATE', contactState: session.state, statusMessageCode: 'delivery_duplicate' };
  }
  return { disposition: 'ACCEPTED', contactState: session.state, statusMessageCode: 'delivery_accepted' };
}

function distanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapError(error: unknown, traceId: string): HttpResponse {
  if (error instanceof MobileMvpHttpError) return { status: error.status, body: envelope(false, null, { code: error.code, message: error.message }, traceId) };
  if (error instanceof AuthorizationDeniedError) return { status: 403, body: envelope(false, null, { code: 'FORBIDDEN', message: error.message }, traceId) };
  if (error instanceof IdempotencyConflictError || error instanceof ApplicationConflictError) return { status: 409, body: envelope(false, null, { code: 'CONFLICT', message: error.message }, traceId) };
  return { status: 500, body: envelope(false, null, { code: 'INTERNAL_ERROR', message: 'Unexpected mobile API error' }, traceId) };
}

export function createMobileMvpHttpHandler(
  roadEvents: RoadEventRepository,
  fieldCompanion: FieldCompanionStore | null,
  notifications: NotificationAuditPort | null,
  idempotency: IdempotencyPort,
  actorResolver: ActorResolver,
  options: MobileMvpHttpOptions = {}
): (request: HttpRequest) => Promise<HttpResponse | undefined> {
  const contactOrchestration = options.contactOrchestration ?? null;
  const devices = options.devices ?? null;
  const now = options.now ?? (() => new Date());
  return async (request) => {
    const deliveryRoute = request.path === '/api/v1/field-companion/deliveries';
    const deviceRegistrationRoute = request.path === '/api/v1/field-companion/devices/registrations';
    const nearbyRoute = request.path === '/api/v1/notifications/nearby';
    const acknowledgement = /^\/api\/v1\/notifications\/([0-9a-f-]+)\/acknowledgements$/.exec(request.path);
    const contactSession = /^\/api\/v1\/road-events\/([0-9a-f-]+)\/contact-sessions$/.exec(request.path);
    if (!deliveryRoute && !deviceRegistrationRoute && !nearbyRoute && acknowledgement === null && contactSession === null) return undefined;
    try {
      const actor = await actorResolver.resolve(request.headers);
      requireMobileRole(actor);
      if (!deviceRegistrationRoute && isFieldUserOnly(actor)) {
        if (devices === null) throw new MobileMvpHttpError(503, 'DEVICE_REGISTRATION_UNAVAILABLE', 'Persistent device registration is unavailable');
        const deviceId = requiredUuid(request.headers['x-device-id'], 'X-Device-Id');
        await devices.assertActive(actor, deviceId);
      }
      if (deviceRegistrationRoute) {
        if (request.method !== 'POST') throw new MobileMvpHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
        if (!isFieldUserOnly(actor)) throw new MobileMvpHttpError(403, 'FORBIDDEN', 'FIELD_USER device registration authority is required');
        if (devices === null) throw new MobileMvpHttpError(503, 'DEVICE_REGISTRATION_UNAVAILABLE', 'Persistent device registration is unavailable');
        const body = record(request.body);
        const deviceId = requiredUuid(body.deviceId, 'deviceId');
        if (body.platform !== 'WEB') throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'platform must be WEB');
        const version = appVersion(body.appVersion);
        const consent = record(body.consent, 'consent');
        if (consent.decision !== 'GRANTED') throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'consent.decision must be GRANTED');
        if (consent.policyVersion !== 'ros-field-companion-device-registration-consent/v1') {
          throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'consent.policyVersion is unsupported');
        }
        const evaluatedAt = now();
        const grantedAt = consentOccurredAt(consent.occurredAt, evaluatedAt);
        const key = requiredString(request.headers['idempotency-key'], 'Idempotency-Key');
        if (!/^mobile-device-registration-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
          throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'Idempotency-Key must use the mobile device registration format');
        }
        // Durable device ownership is checked before any idempotency replay lookup.
        const existing = await devices.findBinding(deviceId);
        if (existing !== null && (existing.actorId !== actor.actorId || existing.tenantId !== actor.tenantId || existing.purpose !== actor.purpose)) {
          throw new MobileMvpHttpError(409, 'DEVICE_REBIND_FORBIDDEN', 'Device registration is bound to another trusted principal');
        }
        const observedAt = evaluatedAt.toISOString();
        const outcome = await idempotentOutcome(idempotency, operationScope('device-registration', actor), key, {
          deviceId, platform: 'WEB', appVersion: version,
          consent: { decision: 'GRANTED', policyVersion: 'ros-field-companion-device-registration-consent/v1', occurredAt: grantedAt }
        }, async () => devices.register({
          deviceId, tenantId: actor.tenantId, purpose: actor.purpose, actorId: actor.actorId,
          platform: 'WEB', appVersion: version,
          consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1',
          clientConsentedAt: grantedAt, consentGrantedAt: observedAt,
          registeredAt: observedAt, observedAt, traceId: request.traceId
        }));
        const disposition = outcome.replayed ? 'IDEMPOTENT' : outcome.value.disposition;
        return {
          status: disposition === 'REGISTERED' ? 201 : 200,
          body: envelope(true, {
            deviceId, disposition, registeredAt: outcome.value.registeredAt,
            consentGrantedAt: outcome.value.consentGrantedAt
          }, null, request.traceId)
        };
      }
      if (contactSession !== null) {
        if (request.method !== 'POST') throw new MobileMvpHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
        const caseId = contactSession[1]!;
        const body = record(request.body);
        const sessionId = requiredString(body.sessionId, 'sessionId');
        const language = String(body.language);
        if (!['ar', 'en', 'UNKNOWN'].includes(language)) throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'language must be ar, en, or UNKNOWN');
        if (body.preferredChannel !== 'IN_APP') throw new MobileMvpHttpError(400, 'INVALID_REQUEST', 'preferredChannel must be IN_APP');
        const key = requiredString(request.headers['idempotency-key'], 'Idempotency-Key');
        // Tenant/purpose resource authorization precedes replay lookup and runtime invocation.
        const event = await roadEvents.findById(caseId, ownedResourceScope(actor));
        if (event === undefined) throw new MobileMvpHttpError(404, 'CASE_NOT_FOUND', 'Field Companion case was not found');
        if (contactOrchestration === null) throw new MobileMvpHttpError(503, 'CONTACT_ORCHESTRATION_UNAVAILABLE', 'Persistent contact orchestration is unavailable');
        const opened = await idempotent(idempotency, operationScope('contact-open', actor), key, { caseId, sessionId, language, preferredChannel: 'IN_APP' }, async () => {
          const disposition = await contactOrchestration.open({
            tenantId: actor.tenantId,
            caseId,
            sessionId,
            ownerActorId: event.reporterActorId,
            language: language as 'ar' | 'en' | 'UNKNOWN',
            preferredChannel: 'IN_APP',
            traceId: request.traceId,
            occurredAt: now().toISOString(),
            idempotencyKey: key
          });
          if (disposition !== 'APPLIED' && disposition !== 'IDEMPOTENT') {
            throw new MobileMvpHttpError(409, 'CONTACT_SESSION_NOT_OPENED', 'Contact session could not be opened safely');
          }
          return { caseId, sessionId, disposition };
        });
        return { status: opened.disposition === 'IDEMPOTENT' ? 200 : 201, body: envelope(true, opened, null, request.traceId) };
      }
      if (deliveryRoute) {
        if (request.method !== 'POST') throw new MobileMvpHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
        const body = record(request.body);
        const caseId = requiredString(body.caseId, 'caseId');
        const sessionId = requiredString(body.sessionId, 'sessionId');
        const headerKey = requiredString(request.headers['idempotency-key'], 'Idempotency-Key');
        const operation = validateOperation(body.operation, headerKey, now());
        // Tenant/purpose resource authorization precedes replay lookup.
        const event = await roadEvents.findById(caseId, ownedResourceScope(actor));
        if (event === undefined) throw new MobileMvpHttpError(404, 'CASE_NOT_FOUND', 'Field Companion case was not found');
        if (fieldCompanion === null) throw new MobileMvpHttpError(503, 'FIELD_COMPANION_UNAVAILABLE', 'Persistent Field Companion runtime is unavailable');
        const currentSession = await fieldCompanion.readSession({ tenantId: actor.tenantId, caseId, sessionId });
        if (currentSession === null) throw new MobileMvpHttpError(409, 'CONTACT_SESSION_REQUIRED', 'A durable contact session is required before delivery');
        assertContactOwner(actor, event, currentSession);
        const callbackOperation = operation.kind === 'CONSENT' || operation.kind === 'LANGUAGE_SELECTION';
        if (callbackOperation && contactOrchestration === null) {
          throw new MobileMvpHttpError(503, 'CONTACT_ORCHESTRATION_UNAVAILABLE', 'Persistent contact orchestration is unavailable');
        }
        const receipt = await idempotent(idempotency, operationScope('delivery', actor), headerKey, { caseId, sessionId, operation }, async () => {
          const receivedAt = now().toISOString();
          if (callbackOperation) {
            const disposition = await contactOrchestration!.handleCallback(callbackForOperation(
              actor, caseId, sessionId, operation, request.traceId, receivedAt, currentSession.ownerActorId
            ));
            const session = await fieldCompanion.readSession({ tenantId: actor.tenantId, caseId, sessionId });
            if (session === null) throw new MobileMvpHttpError(409, 'CONTACT_SESSION_REQUIRED', 'A durable contact session is required before protocol callbacks');
            assertContactOwner(actor, event, session);
            if (disposition === 'CONFLICT') throw new MobileMvpHttpError(409, 'CONTACT_SESSION_CONFLICT', 'Contact session changed concurrently');
            return { idempotencyKey: headerKey, ...receiptFromSession(session, disposition), receivedAt };
          }
          return {
            idempotencyKey: headerKey,
            ...(await fieldCompanion.deliver({ tenantId: actor.tenantId, caseId, sessionId, actorId: actor.actorId, traceId: request.traceId, receivedAt, operation })),
            receivedAt
          };
        });
        return { status: 202, body: envelope(true, receipt, null, request.traceId) };
      }
      if (nearbyRoute) {
        if (request.method !== 'GET') throw new MobileMvpHttpError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported');
        if (notifications === null) throw new MobileMvpHttpError(503, 'NOTIFICATIONS_UNAVAILABLE', 'Persistent notification audit is unavailable');
        const latitude = finite(request.query.latitude, 'latitude', -90, 90);
        const longitude = finite(request.query.longitude, 'longitude', -180, 180);
        const radiusMeters = finite(request.query.radiusMeters, 'radiusMeters', 1, 50_000);
        const page = await roadEvents.list({
          statuses: [RoadEventStatus.Confirmed, RoadEventStatus.SafetyAssessment, RoadEventStatus.ResponseCoordination, RoadEventStatus.RoadClearance],
          severities: [SeverityLevel.Moderate, SeverityLevel.High, SeverityLevel.Critical], limit: 100, offset: 0
        }, actor);
        const nearby = page.items.map((event) => ({ event, distance: distanceMeters(latitude, longitude, event.latitude, event.longitude) }))
          .filter((entry) => entry.distance <= radiusMeters)
          .sort((left, right) => left.distance - right.distance);
        const generatedAt = now().toISOString();
        const notificationIds = nearby.map((entry) => entry.event.id);
        await notifications.recordDelivered(actor, notificationIds, generatedAt);
        const acknowledgements = await notifications.acknowledgedAt(actor, notificationIds);
        const items = nearby.map(({ event, distance }) => ({
          id: event.id, roadEventId: event.id, severity: event.severity.level,
          distanceMeters: Math.round(distance), occurredAt: event.occurredAt.toISOString(),
          acknowledgedAt: acknowledgements.get(event.id) ?? null
        }));
        return { status: 200, body: envelope(true, { items, generatedAt }, null, request.traceId) };
      }
      if (request.method !== 'POST') throw new MobileMvpHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported');
      if (notifications === null) throw new MobileMvpHttpError(503, 'NOTIFICATIONS_UNAVAILABLE', 'Persistent notification audit is unavailable');
      const notificationId = acknowledgement![1]!;
      if (await roadEvents.findById(notificationId, actor) === undefined) throw new MobileMvpHttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification was not found');
      const key = requiredString(request.headers['idempotency-key'], 'Idempotency-Key');
      const result = await idempotent(idempotency, operationScope('notification-ack', actor), key, { notificationId }, async () => {
        const acknowledgementResult = await notifications.acknowledge(actor, notificationId, request.traceId, now().toISOString());
        return { notificationId, ...acknowledgementResult };
      });
      return { status: 200, body: envelope(true, result, null, request.traceId) };
    } catch (error) {
      return mapError(error, request.traceId);
    }
  };
}
