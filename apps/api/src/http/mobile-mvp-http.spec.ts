import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RoadEvent, RoadEventStatus, SeverityLevel } from '@ros/domain';
import {
  AuthorizationDeniedError,
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import { AuthenticatedActor, IdempotencyPort, IdempotencyRecord } from '../application/ports.js';
import {
  ContactAuditEvent,
  ContactChannelPort,
  ContactOrchestrationService,
  ContactOutboxMessage,
  ContactRuntimeRepositoryPort,
  ContactRuntimeTransaction,
  ContactScope,
  ContactSessionRecord,
  OutboxDeliveryDisposition
} from '../ros-eye/contact-orchestration.js';
import {
  ContactSqlPoolPort,
  ContactSqlQueryResult,
  ContactSqlRow
} from '../ros-eye/contact-orchestration-postgres.js';
import { ActorResolver } from './actor-resolver.js';
import { createEvidenceHttpHandler, EvidenceHttpService } from './evidence-http.js';
import { createHumanSafetyHttpHandler, HumanSafetyStore } from './human-safety-http.js';
import {
  createMobileMvpHttpHandler,
  DurableFieldCompanionStore,
  FieldCompanionDeviceBinding,
  FieldCompanionDeviceRegistryPort,
  MobileMvpHttpError,
  NotificationAuditPort,
  PostgresFieldCompanionDeviceRegistry
} from './mobile-mvp-http.js';
import { createRoadEventHttpHandler, HttpRequest } from './road-event-http.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const TRACE_ID = '44444444-4444-4444-8444-444444444444';
const TENANT = 'riyadh-pilot';
const PURPOSE = 'TRAFFIC_COORDINATION';
const SESSION_ID = 'session-mobile-001';
const DEVICE_ID = '77777777-7777-4777-8777-777777777777';
const ATTACKER_DEVICE_ID = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-08-21T00:00:00.000Z');

const FIELD_ACTOR: AuthenticatedActor = {
  actorId: ACTOR_ID,
  roles: ['FIELD_USER'],
  tenantId: TENANT,
  purpose: PURPOSE
};

function scopedKey(value: ContactScope): string {
  return `${value.tenantId}|${value.caseId}|${value.sessionId}`;
}

class MemoryContactRepository implements ContactRuntimeRepositoryPort, ContactRuntimeTransaction {
  readonly sessions = new Map<string, ContactSessionRecord>();
  readonly inbox = new Set<string>();
  readonly audits = new Map<string, ContactAuditEvent>();
  readonly outbox = new Map<string, ContactOutboxMessage>();

  async transaction<T>(work: (tx: ContactRuntimeTransaction) => Promise<T>): Promise<T> { return work(this); }
  async getSessionForUpdate(scope: ContactScope): Promise<ContactSessionRecord | null> { return this.sessions.get(scopedKey(scope)) ?? null; }
  async insertSession(session: ContactSessionRecord): Promise<void> { this.sessions.set(scopedKey(session), session); }
  async updateSession(session: ContactSessionRecord, expectedVersion: number): Promise<'UPDATED' | 'CONFLICT'> {
    const current = this.sessions.get(scopedKey(session));
    if (current === undefined || current.version !== expectedVersion) return 'CONFLICT';
    this.sessions.set(scopedKey(session), session);
    return 'UPDATED';
  }
  async insertInboxIfAbsent(scope: ContactScope, key: string): Promise<'INSERTED' | 'EXISTS'> {
    const scoped = `${scopedKey(scope)}|${key}`;
    if (this.inbox.has(scoped)) return 'EXISTS';
    this.inbox.add(scoped);
    return 'INSERTED';
  }
  async insertAuditIfAbsent(event: ContactAuditEvent): Promise<'INSERTED' | 'EXISTS'> {
    const key = `${scopedKey(event)}|${event.eventId}`;
    if (this.audits.has(key)) return 'EXISTS';
    this.audits.set(key, event);
    return 'INSERTED';
  }
  async insertOutboxIfAbsent(message: ContactOutboxMessage): Promise<'INSERTED' | 'EXISTS'> {
    const key = `${scopedKey(message)}|${message.messageId}`;
    if (this.outbox.has(key)) return 'EXISTS';
    this.outbox.set(key, message);
    return 'INSERTED';
  }
  async cancelPendingAutomation(scope: ContactScope, occurredAt: string): Promise<void> {
    for (const [key, message] of this.outbox) {
      if (scopedKey(message) === scopedKey(scope) && message.deliveredAt === null && message.cancelledAt === null) {
        this.outbox.set(key, { ...message, cancelledAt: occurredAt, leaseOwner: null, leaseExpiresAt: null });
      }
    }
  }
  async claimDueSessions(): Promise<ContactSessionRecord[]> { return []; }
  async releaseLease(): Promise<void> {}
  async claimDueOutbox(): Promise<ContactOutboxMessage[]> { return []; }
  async processClaimedOutbox(): Promise<OutboxDeliveryDisposition> { return 'CONFLICT'; }
  async releaseOutboxLease(): Promise<void> {}
}

class TrackingIdempotency implements IdempotencyPort {
  readonly memory = new MemoryIdempotencyAdapter();
  gets = 0;
  executeExclusively<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T> {
    return this.memory.executeExclusively(scope, key, operation);
  }
  get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | undefined> {
    this.gets += 1;
    return this.memory.get(scope, key);
  }
  put<T>(scope: string, key: string, record: IdempotencyRecord<T>): Promise<void> {
    return this.memory.put(scope, key, record);
  }
}

class MemoryNotificationAudit implements NotificationAuditPort {
  readonly deliveries = new Map<string, string>();
  readonly acknowledgements = new Map<string, string>();
  auditWrites = 0;
  private key(actor: AuthenticatedActor, notificationId: string): string {
    return `${actor.tenantId}|${actor.purpose}|${actor.actorId}|${notificationId}`;
  }
  async recordDelivered(actor: AuthenticatedActor, notificationIds: readonly string[], deliveredAt: string): Promise<void> {
    for (const notificationId of notificationIds) {
      const key = this.key(actor, notificationId);
      if (!this.deliveries.has(key)) this.deliveries.set(key, deliveredAt);
    }
  }
  async acknowledgedAt(actor: AuthenticatedActor, notificationIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const result = new Map<string, string>();
    for (const notificationId of notificationIds) {
      const acknowledgedAt = this.acknowledgements.get(this.key(actor, notificationId));
      if (acknowledgedAt !== undefined) result.set(notificationId, acknowledgedAt);
    }
    return result;
  }
  async acknowledge(actor: AuthenticatedActor, notificationId: string, _traceId: string, occurredAt: string): Promise<{
    readonly disposition: 'ACKNOWLEDGED' | 'IDEMPOTENT'; readonly acknowledgedAt: string;
  }> {
    const key = this.key(actor, notificationId);
    if (!this.deliveries.has(key)) throw new MobileMvpHttpError(404, 'NOTIFICATION_NOT_DELIVERED', 'Notification was not delivered to this principal');
    const existing = this.acknowledgements.get(key);
    if (existing !== undefined) return { disposition: 'IDEMPOTENT', acknowledgedAt: existing };
    this.acknowledgements.set(key, occurredAt);
    this.auditWrites += 1;
    return { disposition: 'ACKNOWLEDGED', acknowledgedAt: occurredAt };
  }
  hasAcknowledgement(actor: AuthenticatedActor, notificationId: string): boolean {
    return this.acknowledgements.has(this.key(actor, notificationId));
  }
}

class MemoryDeviceRegistry implements FieldCompanionDeviceRegistryPort {
  readonly bindings = new Map<string, FieldCompanionDeviceBinding>();
  async findBinding(deviceId: string): Promise<FieldCompanionDeviceBinding | null> {
    return this.bindings.get(deviceId) ?? null;
  }
  async assertActive(actor: AuthenticatedActor, deviceId: string): Promise<void> {
    const binding = this.bindings.get(deviceId);
    if (binding === undefined || binding.actorId !== actor.actorId || binding.tenantId !== actor.tenantId || binding.purpose !== actor.purpose) {
      throw new AuthorizationDeniedError('An ACTIVE device registration for the trusted FIELD_USER principal is required');
    }
  }
  async register(input: FieldCompanionDeviceBinding & { readonly observedAt: string; readonly traceId: string }): Promise<{
    readonly disposition: 'REGISTERED' | 'IDEMPOTENT'; readonly registeredAt: string; readonly consentGrantedAt: string;
  }> {
    const existing = this.bindings.get(input.deviceId);
    if (existing !== undefined) {
      if (existing.actorId !== input.actorId || existing.tenantId !== input.tenantId || existing.purpose !== input.purpose) {
        throw new MobileMvpHttpError(409, 'DEVICE_REBIND_FORBIDDEN', 'Device registration is bound to another trusted principal');
      }
      return { disposition: 'IDEMPOTENT', registeredAt: existing.registeredAt, consentGrantedAt: existing.consentGrantedAt };
    }
    this.bindings.set(input.deviceId, input);
    return { disposition: 'REGISTERED', registeredAt: input.registeredAt, consentGrantedAt: input.consentGrantedAt };
  }
}

class DeviceRegistrySqlFixture implements ContactSqlPoolPort {
  binding: ContactSqlRow | null = null;
  transactions = 0;
  auditWrites = 0;
  readonly auditTraceIds: unknown[] = [];
  readonly statements: string[] = [];

  async transaction<T>(work: (connection: this) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.statements.push(text);
    if (text.includes('FROM field_companion_devices') && text.includes('FOR UPDATE')) {
      return { rows: (this.binding === null ? [] : [this.binding]) as readonly Row[], rowCount: this.binding === null ? 0 : 1 };
    }
    if (text.includes('INSERT INTO field_companion_devices')) {
      this.binding = {
        device_id: values[0], tenant_id: values[1], purpose: values[2], actor_id: values[3],
        platform: values[4], app_version: values[5], consent_policy_version: values[6],
        client_consented_at: values[7], consent_granted_at: values[8], registered_at: values[8]
      };
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE field_companion_devices') && text.includes('consent_granted_at=')) {
      this.binding = {
        ...this.binding,
        platform: values[1], app_version: values[2], consent_policy_version: values[3],
        client_consented_at: values[4], consent_granted_at: values[5]
      };
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE field_companion_devices')) return { rows: [], rowCount: 1 };
    if (text.includes('INSERT INTO audit_logs')) {
      this.auditWrites += 1;
      this.auditTraceIds.push(values[4]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in device registry fixture: ${text}`);
  }
}

const channel: ContactChannelPort = { async send() { return 'SENT'; } };
const ids = {
  async create(namespace: string, material: string): Promise<string> {
    return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
  }
};

async function fixture(actor: AuthenticatedActor = FIELD_ACTOR, includeContactService = true) {
  const roadEvents = new MemoryRoadEventRepository();
  await roadEvents.create(new RoadEvent({
    id: CASE_ID,
    reporterActorId: ACTOR_ID,
    occurredAt: new Date('2020-08-20T23:50:00.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    status: RoadEventStatus.Confirmed,
    severity: {
      level: SeverityLevel.High,
      score: 80,
      confidence: 0.9,
      reasonCodes: ['possible_impact'],
      requiresHumanReview: true
    }
  }), {
    tenantId: TENANT,
    purpose: PURPOSE,
    reporterActorId: ACTOR_ID,
    actorType: 'FIELD_USER',
    actorId: ACTOR_ID,
    action: 'road_event.created',
    eventType: 'RoadEventCreated',
    traceId: TRACE_ID,
    correlationId: TRACE_ID,
    occurredAt: new Date('2020-08-20T23:50:00.000Z')
  });
  const contacts = new MemoryContactRepository();
  const service = new ContactOrchestrationService(contacts, channel, ids);
  const idempotency = new TrackingIdempotency();
  const notifications = new MemoryNotificationAudit();
  const devices = new MemoryDeviceRegistry();
  devices.bindings.set(DEVICE_ID, {
    deviceId: DEVICE_ID, tenantId: actor.tenantId, purpose: actor.purpose, actorId: actor.actorId,
    platform: 'WEB', appVersion: '1.0.0',
    consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1',
    clientConsentedAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString(), registeredAt: NOW.toISOString()
  });
  const handlerFor = (principal: AuthenticatedActor, withContactService = includeContactService) => {
    const principalResolver: ActorResolver = { resolve: async () => principal };
    return createMobileMvpHttpHandler(
      roadEvents,
      new DurableFieldCompanionStore(contacts),
      notifications,
      idempotency,
      principalResolver,
      { contactOrchestration: withContactService ? service : null, devices, now: () => new Date(NOW) }
    );
  };
  const resolver: ActorResolver = { resolve: async () => actor };
  const handler = handlerFor(actor);
  return { contacts, devices, handler, handlerFor, idempotency, notifications, resolver, roadEvents, service };
}

function request(method: string, path: string, body: unknown = null, headers: Readonly<Record<string, string | undefined>> = {}): HttpRequest {
  return { method, path, query: {}, headers: { 'x-device-id': DEVICE_ID, ...headers }, body, traceId: TRACE_ID };
}

function openRequest(key = 'contact-open-0001', sessionId = SESSION_ID, deviceId = DEVICE_ID): HttpRequest {
  return request('POST', `/api/v1/road-events/${CASE_ID}/contact-sessions`, {
    sessionId,
    language: 'UNKNOWN',
    preferredChannel: 'IN_APP',
    tenantId: 'forged-tenant',
    actorId: 'forged-actor'
  }, {
    authorization: 'Bearer trusted-token',
    'x-actor-id': 'forged-actor',
    'x-ros-roles': 'SUPERVISOR',
    'x-tenant-id': 'forged-tenant',
    'x-purpose': 'forged-purpose',
    'x-device-id': deviceId,
    'idempotency-key': key
  });
}

function deliveryRequest(kind: 'CONSENT' | 'LANGUAGE_SELECTION', payload: Readonly<Record<string, unknown>>, key: string, sessionId = SESSION_ID, deviceId = DEVICE_ID): HttpRequest {
  return request('POST', '/api/v1/field-companion/deliveries', {
    caseId: CASE_ID,
    sessionId,
    operation: {
      operationId: `operation-${key}`,
      idempotencyKey: key,
      kind,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      attemptCount: 0,
      payload
    }
  }, { authorization: 'Bearer trusted-token', 'x-ros-roles': 'SUPERVISOR', 'x-device-id': deviceId, 'idempotency-key': key });
}

function registrationRequest(
  deviceId = ATTACKER_DEVICE_ID,
  key = 'mobile-device-registration-99999999-9999-4999-8999-999999999999'
): HttpRequest {
  return request('POST', '/api/v1/field-companion/devices/registrations', {
    deviceId,
    platform: 'WEB',
    appVersion: '1.2.3',
    actorId: 'forged-actor',
    tenantId: 'forged-tenant',
    consent: {
      decision: 'GRANTED',
      policyVersion: 'ros-field-companion-device-registration-consent/v1',
      occurredAt: new Date(NOW.getTime() - 60_000).toISOString()
    }
  }, { 'idempotency-key': key });
}

test('contact session opens durably, replays idempotently, and ignores forged actor scope headers', async () => {
  const { contacts, handler } = await fixture();
  const first = await handler(openRequest());
  const replay = await handler(openRequest());
  assert.equal(first?.status, 201);
  assert.equal(replay?.status, 201);
  assert.deepEqual((first!.body as { data: unknown }).data, { caseId: CASE_ID, sessionId: SESSION_ID, disposition: 'APPLIED' });
  assert.equal(contacts.sessions.size, 1);
  assert.equal(contacts.inbox.size, 1);
  const durable = contacts.sessions.get(scopedKey({ tenantId: TENANT, caseId: CASE_ID, sessionId: SESSION_ID }));
  assert.equal(durable?.state, 'CONSENT_PENDING');
  assert.equal([...contacts.sessions.keys()].some((key) => key.startsWith('forged-tenant|')), false);
});

test('device registration binds the trusted FIELD_USER and issues a server-time consent receipt with replay semantics', async () => {
  const { devices, handler } = await fixture();
  const first = await handler(registrationRequest());
  const replay = await handler(registrationRequest());
  assert.equal(first?.status, 201);
  assert.equal(replay?.status, 200);
  const firstData = (first!.body as { data: { disposition: string; registeredAt: string; consentGrantedAt: string } }).data;
  const replayData = (replay!.body as { data: { disposition: string; registeredAt: string; consentGrantedAt: string } }).data;
  assert.deepEqual(firstData, { deviceId: ATTACKER_DEVICE_ID, disposition: 'REGISTERED', registeredAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString() });
  assert.deepEqual(replayData, { deviceId: ATTACKER_DEVICE_ID, disposition: 'IDEMPOTENT', registeredAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString() });
  const binding = devices.bindings.get(ATTACKER_DEVICE_ID);
  assert.equal(binding?.actorId, ACTOR_ID);
  assert.equal(binding?.tenantId, TENANT);
  assert.equal(binding?.clientConsentedAt, new Date(NOW.getTime() - 60_000).toISOString());
  assert.equal(binding?.consentGrantedAt, NOW.toISOString());
});

test('Postgres device registration persists an audited server-time receipt and renews consent without rebinding', async () => {
  const sql = new DeviceRegistrySqlFixture();
  const registry = new PostgresFieldCompanionDeviceRegistry(sql);
  const initial: FieldCompanionDeviceBinding & { readonly observedAt: string; readonly traceId: string } = {
    deviceId: DEVICE_ID,
    tenantId: TENANT,
    purpose: PURPOSE,
    actorId: ACTOR_ID,
    platform: 'WEB',
    appVersion: '1.0.0',
    consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1',
    clientConsentedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    consentGrantedAt: NOW.toISOString(),
    registeredAt: NOW.toISOString(),
    observedAt: NOW.toISOString(),
    traceId: 'trace_01HZX-abc.def'
  };
  assert.deepEqual(await registry.register(initial), {
    disposition: 'REGISTERED', registeredAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString()
  });

  const renewedAt = new Date(NOW.getTime() + 60_000).toISOString();
  assert.deepEqual(await registry.register({
    ...initial,
    appVersion: '1.1.0',
    clientConsentedAt: renewedAt,
    consentGrantedAt: renewedAt,
    observedAt: renewedAt,
    traceId: '55555555-5555-4555-8555-555555555555'
  }), {
    disposition: 'REGISTERED', registeredAt: NOW.toISOString(), consentGrantedAt: renewedAt
  });
  assert.equal(sql.transactions, 2);
  assert.equal(sql.auditWrites, 2);
  assert.match(String(sql.auditTraceIds[0]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(sql.binding?.app_version, '1.1.0');
  assert.equal(sql.binding?.consent_granted_at, renewedAt);
  assert.equal(sql.statements.some((statement) => statement.includes('consent_granted_at=$6::timestamptz')), true);

  await assert.rejects(() => registry.register({
    ...initial,
    actorId: '55555555-5555-4555-8555-555555555555',
    traceId: '66666666-6666-4666-8666-666666666666'
  }), /another trusted principal/);
  assert.equal(sql.auditWrites, 2);
});

test('device rebind and unregistered or other-principal device use fail before replay or incident lookup', async () => {
  const owner = await fixture();
  assert.equal((await owner.handler(registrationRequest()))?.status, 201);
  const attacker: AuthenticatedActor = { ...FIELD_ACTOR, actorId: '55555555-5555-4555-8555-555555555555' };
  const attack = owner.handlerFor(attacker);
  const replayLookupsBefore = owner.idempotency.gets;
  const rebind = await attack(registrationRequest(
    ATTACKER_DEVICE_ID,
    'mobile-device-registration-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ));
  assert.equal(rebind?.status, 409);
  assert.equal(owner.idempotency.gets, replayLookupsBefore);

  const wrongDevice = await attack({
    ...request('GET', '/api/v1/notifications/nearby', null, { 'x-device-id': ATTACKER_DEVICE_ID }),
    query: { latitude: '24.7136', longitude: '46.6753', radiusMeters: '1000' }
  });
  assert.equal(wrongDevice?.status, 403);
  const unregistered = await owner.handler({
    ...request('GET', '/api/v1/notifications/nearby', null, { 'x-device-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    query: { latitude: '24.7136', longitude: '46.6753', radiusMeters: '1000' }
  });
  assert.equal(unregistered?.status, 403);

  const resourceIdempotency = new TrackingIdempotency();
  const roadApplication = new RoadEventApplicationService(
    owner.roadEvents,
    new RoleMatrixAuthorizationAdapter(),
    resourceIdempotency,
    new MemorySignalAttachmentAdapter(owner.roadEvents),
    owner.roadEvents
  );
  const roadHandler = createRoadEventHttpHandler(roadApplication, { resolve: async () => attacker }, owner.devices);
  const incident = {
    id: '66666666-6666-4666-8666-666666666666',
    occurredAt: NOW.toISOString(), latitude: 24.7136, longitude: 46.6753
  };
  const wrongPrincipalDevice = await roadHandler(request(
    'POST', '/api/v1/road-events', incident,
    { 'x-device-id': ATTACKER_DEVICE_ID, 'idempotency-key': 'field-device-create-0001' }
  ));
  assert.equal(wrongPrincipalDevice.status, 403);
  const missingRegistration = await roadHandler(request(
    'POST', '/api/v1/road-events', incident,
    { 'x-device-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'idempotency-key': 'field-device-create-0001' }
  ));
  assert.equal(missingRegistration.status, 403);
  assert.equal(resourceIdempotency.gets, 0);
});

test('cross-tenant contact open is rejected before idempotency replay lookup', async () => {
  const wrongScope: AuthenticatedActor = { ...FIELD_ACTOR, tenantId: 'other-tenant' };
  const { contacts, handler, idempotency } = await fixture(wrongScope);
  const response = await handler(openRequest());
  assert.equal(response?.status, 404);
  assert.equal(idempotency.gets, 0);
  assert.equal(contacts.sessions.size, 0);
});

test('sanitized nearby visibility and recipient ack do not grant another FIELD_USER resource or contact authority', async () => {
  const owner = await fixture();
  assert.equal((await owner.handler(openRequest()))?.status, 201);
  const attacker: AuthenticatedActor = {
    ...FIELD_ACTOR,
    actorId: '55555555-5555-4555-8555-555555555555'
  };
  owner.devices.bindings.set(ATTACKER_DEVICE_ID, {
    deviceId: ATTACKER_DEVICE_ID, tenantId: attacker.tenantId, purpose: attacker.purpose, actorId: attacker.actorId,
    platform: 'WEB', appVersion: '1.0.0',
    consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1',
    clientConsentedAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString(), registeredAt: NOW.toISOString()
  });
  const attack = owner.handlerFor(attacker);
  const replayLookupsBefore = owner.idempotency.gets;

  const open = await attack(openRequest('contact-open-0001', SESSION_ID, ATTACKER_DEVICE_ID));
  assert.equal(open?.status, 404);
  assert.equal(owner.idempotency.gets, replayLookupsBefore);

  const delivery = await attack(deliveryRequest('CONSENT', { decision: 'GRANTED' }, 'attacker-consent-0001', SESSION_ID, ATTACKER_DEVICE_ID));
  assert.equal(delivery?.status, 404);
  assert.equal(owner.idempotency.gets, replayLookupsBefore);

  const nearby = await attack({
    ...request('GET', '/api/v1/notifications/nearby', null, { 'x-device-id': ATTACKER_DEVICE_ID }),
    query: { latitude: '24.7136', longitude: '46.6753', radiusMeters: '1000' }
  });
  assert.equal(nearby?.status, 200);
  assert.deepEqual((nearby!.body as { data: { items: Array<{ id: string }> } }).data.items.map((item) => item.id), [CASE_ID]);

  const acknowledgement = await attack(request(
    'POST',
    `/api/v1/notifications/${CASE_ID}/acknowledgements`,
    null,
    { 'x-device-id': ATTACKER_DEVICE_ID, 'idempotency-key': 'attacker-ack-0001' }
  ));
  assert.equal(acknowledgement?.status, 200);
  assert.equal(owner.notifications.hasAcknowledgement(attacker, CASE_ID), true);

  const resourceIdempotency = new TrackingIdempotency();
  const application = new RoadEventApplicationService(
    owner.roadEvents,
    new RoleMatrixAuthorizationAdapter(),
    resourceIdempotency,
    new MemorySignalAttachmentAdapter(owner.roadEvents),
    owner.roadEvents
  );
  const roadHandler = createRoadEventHttpHandler(application, { resolve: async () => attacker }, owner.devices);
  assert.equal((await roadHandler(request('GET', `/api/v1/road-events/${CASE_ID}`, null, { 'x-device-id': ATTACKER_DEVICE_ID }))).status, 404);
  const attachment = await roadHandler(request(
    'POST',
    `/api/v1/road-events/${CASE_ID}/signals`,
    {
      signalId: '66666666-6666-4666-8666-666666666666',
      matchScore: 0.8,
      mergeReasons: ['same_tenant_attack']
    },
    { 'x-device-id': ATTACKER_DEVICE_ID, 'idempotency-key': 'attacker-attach-0001' }
  ));
  assert.equal(attachment.status, 404);
  assert.equal(resourceIdempotency.gets, 0);
});

test('consent and language deliveries use orchestration callbacks and return durable contact states', async () => {
  const { contacts, handler } = await fixture();
  assert.equal((await handler(openRequest()))?.status, 201);

  const consent = await handler(deliveryRequest('CONSENT', { decision: 'GRANTED' }, 'consent-delivery-0001'));
  assert.equal(consent?.status, 202);
  assert.equal((consent!.body as { data: { contactState: string } }).data.contactState, 'LANGUAGE_SELECTION');
  assert.equal(contacts.sessions.get(scopedKey({ tenantId: TENANT, caseId: CASE_ID, sessionId: SESSION_ID }))?.state, 'LANGUAGE_SELECTION');
  assert.equal([...contacts.outbox.values()].some((message) => message.promptId === 'contact.language' && message.cancelledAt === null), true);

  const language = await handler(deliveryRequest('LANGUAGE_SELECTION', { language: 'ar' }, 'language-delivery-0001'));
  assert.equal(language?.status, 202);
  assert.equal((language!.body as { data: { contactState: string } }).data.contactState, 'CONTACTING');
  const durable = contacts.sessions.get(scopedKey({ tenantId: TENANT, caseId: CASE_ID, sessionId: SESSION_ID }));
  assert.equal(durable?.state, 'CONTACTING');
  assert.equal(durable?.language, 'ar');
});

test('contact callbacks fail closed without a pre-existing session or persistent orchestration dependency', async () => {
  const available = await fixture();
  const missing = await available.handler(deliveryRequest('CONSENT', { decision: 'GRANTED' }, 'missing-session-0001', 'session-missing-001'));
  assert.equal(missing?.status, 409);
  assert.equal((missing!.body as { error: { code: string } }).error.code, 'CONTACT_SESSION_REQUIRED');
  assert.equal(available.contacts.sessions.size, 0);

  const unavailable = await fixture(FIELD_ACTOR, false);
  const open = await unavailable.handler(openRequest('contact-open-unavailable-001'));
  assert.equal(open?.status, 503);
  assert.equal((open!.body as { error: { code: string } }).error.code, 'CONTACT_ORCHESTRATION_UNAVAILABLE');
});

test('FIELD_USER can use scoped nearby and acknowledgement routes', async () => {
  const { handler, notifications } = await fixture();
  const nearby = await handler({
    ...request('GET', '/api/v1/notifications/nearby'),
    query: { latitude: '24.7136', longitude: '46.6753', radiusMeters: '1000' }
  });
  assert.equal(nearby?.status, 200);
  assert.deepEqual((nearby!.body as { data: { items: Array<{ id: string }> } }).data.items.map((item) => item.id), [CASE_ID]);

  const acknowledged = await handler(request(
    'POST',
    `/api/v1/notifications/${CASE_ID}/acknowledgements`,
    null,
    { 'idempotency-key': 'notification-ack-0001' }
  ));
  assert.equal(acknowledged?.status, 200);
  assert.equal(notifications.hasAcknowledgement(FIELD_ACTOR, CASE_ID), true);
});

test('notification acknowledgement is recipient-scoped and a different key does not duplicate audit evidence', async () => {
  const owner = await fixture();
  await owner.handler({
    ...request('GET', '/api/v1/notifications/nearby'),
    query: { latitude: '24.7136', longitude: '46.6753', radiusMeters: '1000' }
  });
  const first = await owner.handler(request(
    'POST', `/api/v1/notifications/${CASE_ID}/acknowledgements`, null,
    { 'idempotency-key': 'notification-ack-first-0001' }
  ));
  const duplicate = await owner.handler(request(
    'POST', `/api/v1/notifications/${CASE_ID}/acknowledgements`, null,
    { 'idempotency-key': 'notification-ack-second-0001' }
  ));
  assert.equal((first!.body as { data: { disposition: string } }).data.disposition, 'ACKNOWLEDGED');
  assert.equal((duplicate!.body as { data: { disposition: string } }).data.disposition, 'IDEMPOTENT');
  assert.equal(owner.notifications.auditWrites, 1);

  const other: AuthenticatedActor = { ...FIELD_ACTOR, actorId: '55555555-5555-4555-8555-555555555555' };
  owner.devices.bindings.set(ATTACKER_DEVICE_ID, {
    deviceId: ATTACKER_DEVICE_ID, tenantId: other.tenantId, purpose: other.purpose, actorId: other.actorId,
    platform: 'WEB', appVersion: '1.0.0', consentPolicyVersion: 'ros-field-companion-device-registration-consent/v1',
    clientConsentedAt: NOW.toISOString(), consentGrantedAt: NOW.toISOString(), registeredAt: NOW.toISOString()
  });
  const otherHandler = owner.handlerFor(other);
  const denied = await otherHandler(request(
    'POST', `/api/v1/notifications/${CASE_ID}/acknowledgements`, null,
    { 'x-device-id': ATTACKER_DEVICE_ID, 'idempotency-key': 'notification-other-ack-0001' }
  ));
  assert.equal(denied?.status, 404);
  assert.equal(owner.notifications.auditWrites, 1);
});

test('FIELD_USER has only field RoadEvent permissions and cannot use global, transition, Human Safety, or Evidence surfaces', async () => {
  const { devices, resolver, roadEvents } = await fixture();
  const authorization = new RoleMatrixAuthorizationAdapter();
  for (const permission of ['road_event:create', 'road_event:read', 'road_event:attach_signal'] as const) {
    assert.doesNotThrow(() => authorization.assertAllowed(FIELD_ACTOR, permission));
  }
  for (const permission of ['road_event:list', 'road_event:transition'] as const) {
    assert.throws(() => authorization.assertAllowed(FIELD_ACTOR, permission), /not allowed/);
  }

  const application = new RoadEventApplicationService(
    roadEvents,
    authorization,
    new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(roadEvents),
    roadEvents
  );
  const roadHandler = createRoadEventHttpHandler(application, resolver, devices);
  assert.equal((await roadHandler(request('GET', '/api/v1/road-events'))).status, 403);
  assert.equal((await roadHandler(request(
    'POST',
    `/api/v1/road-events/${CASE_ID}/transition`,
    { expectedVersion: 1, nextStatus: 'SAFETY_ASSESSMENT', reason: 'forged field transition' },
    { 'idempotency-key': 'field-transition-0001' }
  ))).status, 403);

  const humanHandler = createHumanSafetyHttpHandler(
    application,
    {} as HumanSafetyStore,
    new MemoryIdempotencyAdapter(),
    resolver,
    () => new Date(NOW)
  );
  const human = await humanHandler(request(
    'POST',
    `/api/v1/human-safety/cases/${CASE_ID}/takeover`,
    { expectedCaseVersion: 1, expectedContactVersion: 1, reason: 'forged operator action' },
    { 'idempotency-key': 'field-takeover-0001' }
  ));
  assert.equal(human?.status, 403);

  const evidenceHandler = createEvidenceHttpHandler(
    {} as EvidenceHttpService,
    new MemoryIdempotencyAdapter(),
    resolver,
    () => new Date(NOW)
  );
  const evidence = await evidenceHandler(request('POST', `/api/v1/road-events/${OTHER_CASE_ID}/evidence/upload-intents`));
  assert.equal(evidence?.status, 403);
});
