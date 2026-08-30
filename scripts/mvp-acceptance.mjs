import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RoadEventApplicationService } from '../apps/api/dist/application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../apps/api/dist/application/local-adapters.js';
import { EvidenceService } from '../apps/api/dist/evidence/evidence-service.js';
import { SafeLocalMalwareScanner } from '../apps/api/dist/evidence/safe-local-malware-scanner.js';
import { ScopedRoadEventEvidenceAuthorization } from '../apps/api/dist/evidence/scoped-road-event-evidence-authorization.js';
import { createHumanSafetyHttpHandler } from '../apps/api/dist/http/human-safety-http.js';
import { createMobileMvpHttpHandler } from '../apps/api/dist/http/mobile-mvp-http.js';
import { createRoadEventHttpHandler } from '../apps/api/dist/http/road-event-http.js';
import { createRuntimeActorResolver } from '../apps/api/dist/http/runtime-actor-resolver.js';
import { prepareMigrationSql } from '../apps/api/dist/persistence/postgres/migration-runner.js';
import { HttpFieldCompanionGateway } from '../apps/mobile/dist/mvp-http-gateway.js';
import { HttpRoadEventGateway } from '../apps/operations-dashboard/dist/api-client.js';
import { HttpHumanSafetyCommandCenterGateway } from '../apps/operations-dashboard/dist/human-safety-gateway.js';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const ROAD_EVENT_ID = '11111111-1111-4111-8111-111111111111';
const EVIDENCE_ID = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = '33333333-3333-4333-8333-333333333333';
const SUPERVISOR_ID = '44444444-4444-4444-8444-444444444444';
const ATTACKER_ID = '55555555-5555-4555-8555-555555555555';
const ASSIGNEE_ID = '66666666-6666-4666-8666-666666666666';
const MOBILE_DEVICE_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_DEVICE_ID = '99999999-9999-4999-8999-999999999999';
const MOBILE_REGISTRATION_OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_REGISTRATION_OPERATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TENANT = 'riyadh-mvp';
const OTHER_TENANT = 'other-tenant';
const PURPOSE = 'TRAFFIC_COORDINATION';

const APPLIED_MIGRATIONS = Object.freeze({
  '0001_initial.sql': '62eb5e77bea0df14169ff284c45f6e8dd865b8afaf62172a1a721e867a5e5730',
  '0002_foundation_hardening.sql': '0b83e4ceb2e3dd2242084c40017044de9c8726ab5eba7203ef69deede200a717',
  '0003_road_event_persistence.sql': 'dd1289f91082615848c0b670bdaf8a51260ed37389625a1219e88f782c9a3ba9',
  '0004_outbox_delivery.sql': 'a7fabf1f3de1f1f1fa527c8adc7c907106a9f78dec0833fd8804ef93265391d0',
  '0005_evidence_storage.sql': 'dab840ab91438755175729636453f64b4656c3deaca5ffca188fbf7657d34021',
  '0006_ros_eye_contact_runtime.sql': 'cad20503e998ee1e80e59a74155d3fd2bc20f749f3aaa1a60a523f6aa1c67ec0',
  '0007_ros_eye_privacy_security_oversight.sql': '4638508eb812098fe83ea3d22ea345fc13a8c8963a1e4373eb6ea698c96159cb',
  '0008_ros_eye_break_glass_atomic_proof.sql': 'f393ab04fa040f9f038e5453bdd89227bd346fdf8c30d0fa41b51573cc0d7d29',
  '0009_ros_eye_safety_fusion_governance.sql': '0ad2abe559d51ae12121b30a066e1bdc95b1385da364de2fb736a557576d4ae2',
  '0010_runtime_idempotency.sql': '136f50dddad3741e5a5e901df0686ecb66fcd94716fad4c084f5119517c996fa',
  '0011_road_event_access_scope.sql': '295d2da6e36dd4b302b7c89baaf4812d745f71603c92074d0e009e835b1d80d8',
  '0012_outbox_access_scope.sql': 'b1ebfae0a7d5b1c11546efdc0e0d602f24e1d6990b9879c3f64fdfc0a1c72a21',
  '0013_integration_callback_nonce.sql': '2348ecda0a889c6eaef334de6c9175d64e9c4bc02c30450412e73a5942ad6b74',
  '0014_integration_delivery_lifecycle.sql': '870e243336ff483bb62d6386ce30b6a6bcd60b5a9da069cdaf95d4b0f1185e07',
  '0015_field_user_resource_ownership.sql': 'c195a5af113e483ae8120591518a24bc206177d90c2d87866a8b6948ad2fa2af'
});

class MemoryNotificationAudit {
  deliveries = new Set();
  acknowledgements = new Map();
  entries = [];

  async recordDelivered(actor, notificationIds) {
    for (const id of notificationIds) {
      this.deliveries.add(`${actor.tenantId}:${actor.purpose}:${actor.actorId}:${id}`);
    }
  }

  async acknowledgedAt(actor, notificationIds) {
    return new Map(notificationIds.flatMap((id) => {
      const occurredAt = this.acknowledgements.get(`${actor.tenantId}:${actor.purpose}:${actor.actorId}:${id}`);
      return occurredAt === undefined ? [] : [[id, occurredAt]];
    }));
  }

  async acknowledge(actor, notificationId, traceId, occurredAt) {
    const key = `${actor.tenantId}:${actor.purpose}:${actor.actorId}:${notificationId}`;
    assert.equal(this.deliveries.has(key), true, 'acknowledgement must follow recipient-scoped delivery');
    if (!this.acknowledgements.has(key)) {
      this.acknowledgements.set(key, occurredAt);
      this.entries.push(Object.freeze({ action: 'nearby_notification.acknowledged', notificationId, actorId: actor.actorId, traceId, occurredAt }));
      return { disposition: 'ACKNOWLEDGED', acknowledgedAt: occurredAt };
    }
    return { disposition: 'IDEMPOTENT', acknowledgedAt: this.acknowledgements.get(key) };
  }
}

class MemoryDeviceRegistry {
  bindings = new Map();
  audits = [];

  async findBinding(deviceId) { return structuredClone(this.bindings.get(deviceId) ?? null); }

  async assertActive(actor, deviceId) {
    const binding = this.bindings.get(deviceId);
    assert.ok(binding, 'an ACTIVE device registration is required');
    assert.equal(binding.actorId, actor.actorId);
    assert.equal(binding.tenantId, actor.tenantId);
    assert.equal(binding.purpose, actor.purpose);
  }

  async register(input) {
    const existing = this.bindings.get(input.deviceId);
    if (existing !== undefined) {
      assert.equal(existing.actorId, input.actorId);
      assert.equal(existing.tenantId, input.tenantId);
      assert.equal(existing.purpose, input.purpose);
      return { disposition: 'IDEMPOTENT', registeredAt: existing.registeredAt, consentGrantedAt: existing.consentGrantedAt };
    }
    this.bindings.set(input.deviceId, structuredClone(input));
    this.audits.push(Object.freeze({ action: 'field_companion.device_registered', actorId: input.actorId, traceId: input.traceId, occurredAt: input.observedAt }));
    return { disposition: 'REGISTERED', registeredAt: input.registeredAt, consentGrantedAt: input.consentGrantedAt };
  }
}

class MemoryHumanSafetyStore {
  evidence = null;
  evidenceAudits = [];
  audit = [];

  constructor() {
    this.contact = {
      tenantId: TENANT,
      caseId: ROAD_EVENT_ID,
      sessionId: 'session-mvp-001',
      state: 'AWAITING_RESPONSE',
      version: 1,
      protocolVersion: 'ros-eye.contact.v1',
      promptPolicyVersion: 'ros-eye.contact-prompts.v1',
      accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
      language: 'ar',
      identityConfidence: 'CONFIRMED',
      activeChannel: 'PUSH',
      attemptCount: 1,
      responseDeadlineAt: new Date(NOW.getTime() + 60_000).toISOString(),
      lastInteractionAt: NOW.toISOString(),
      assignedOperatorId: null,
      accessibility: {
        screenReaderRequired: false,
        handsFreeRequired: false,
        largeControlsRequired: true,
        simpleLanguageRequired: true,
        visualAlternativeRequired: true,
        audioAlternativeRequired: true
      },
      automationSuppressed: false,
      nextActionAt: new Date(NOW.getTime() + 30_000).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: NOW.toISOString(),
      ownerActorId: OPERATOR_ID
    };
  }

  attachEvidence(record, audits) {
    this.evidence = record;
    this.evidenceAudits = [...audits];
  }

  async read(scope, caseId) {
    if (scope.tenantId !== TENANT || scope.purpose !== PURPOSE || caseId !== ROAD_EVENT_ID) {
      return { contact: null, recommendation: null, evidenceState: 'MISSING', provenance: [], audit: [] };
    }
    const provenance = this.evidence === null ? [] : [{
      evidenceId: this.evidence.id,
      sourceType: 'INFRASTRUCTURE',
      integrity: this.evidence.status === 'PRESERVED' ? 'VERIFIED' : 'UNVERIFIED',
      receivedAt: this.evidence.createdAt.toISOString(),
      status: this.evidence.status === 'QUARANTINED' ? 'QUARANTINED' : 'ACTIVE'
    }];
    const evidenceAudit = this.evidenceAudits.map((entry, index) => ({
      eventId: `evidence-audit-${index + 1}`,
      action: entry.action,
      actorId: entry.actorId,
      actorRole: 'OPERATOR',
      reason: entry.action,
      reasonCode: entry.action,
      traceId: entry.traceId,
      occurredAt: (entry.occurredAt ?? NOW).toISOString(),
      caseVersion: this.contact.version,
      immutable: true
    }));
    return {
      contact: structuredClone(this.contact),
      recommendation: null,
      evidenceState: this.evidence?.status === 'PRESERVED' ? 'TRUSTED' : 'MISSING',
      provenance,
      audit: [...evidenceAudit, ...structuredClone(this.audit)]
    };
  }

  async mutate(input) {
    assert.equal(input.tenantId, TENANT);
    assert.equal(input.caseId, ROAD_EVENT_ID);
    assert.equal(input.expectedContactVersion, this.contact.version);
    let state = this.contact.state;
    let assignedOperatorId = this.contact.assignedOperatorId;
    if (input.action === 'takeover') {
      state = 'OPERATOR_TAKEOVER';
      assignedOperatorId = input.actorId;
    } else if (input.action === 'escalate') {
      state = 'ESCALATED';
    } else {
      assignedOperatorId = input.assigneeId;
    }
    this.contact = {
      ...this.contact,
      state,
      assignedOperatorId,
      activeChannel: state === 'OPERATOR_TAKEOVER' ? 'OPERATOR' : this.contact.activeChannel,
      automationSuppressed: true,
      responseDeadlineAt: null,
      nextActionAt: null,
      version: this.contact.version + 1,
      lastInteractionAt: input.occurredAt,
      updatedAt: input.occurredAt
    };
    this.audit.push(Object.freeze({
      eventId: `human-safety-audit-${this.audit.length + 1}`,
      action: `human_safety.${input.action}`,
      actorId: input.actorId,
      actorRole: input.actorRole,
      reason: input.reason,
      reasonCode: input.reason,
      traceId: input.traceId,
      occurredAt: input.occurredAt,
      caseVersion: this.contact.version,
      immutable: true
    }));
  }
}

class MemoryContactOrchestration {
  constructor(store) {
    this.store = store;
    this.template = structuredClone(store.contact);
    this.store.contact = null;
    this.opens = new Set();
    this.callbacks = new Set();
  }

  async open(input) {
    const key = `${input.tenantId}:${input.caseId}:${input.sessionId}:${input.idempotencyKey}`;
    if (this.opens.has(key)) return 'IDEMPOTENT';
    if (this.store.contact !== null) return 'CONFLICT';
    this.opens.add(key);
    this.store.contact = {
      ...this.template,
      tenantId: input.tenantId,
      caseId: input.caseId,
      sessionId: input.sessionId,
      ownerActorId: input.ownerActorId,
      state: 'CONSENT_PENDING',
      version: 1,
      language: input.language,
      activeChannel: 'IN_APP',
      attemptCount: 1,
      responseDeadlineAt: new Date(Date.parse(input.occurredAt) + 60_000).toISOString(),
      nextActionAt: new Date(Date.parse(input.occurredAt) + 60_000).toISOString(),
      lastInteractionAt: input.occurredAt,
      updatedAt: input.occurredAt
    };
    return 'APPLIED';
  }

  async handleCallback(input) {
    const key = `${input.tenantId}:${input.caseId}:${input.sessionId}:${input.callbackId}`;
    if (this.callbacks.has(key)) return 'IDEMPOTENT';
    const current = this.store.contact;
    if (current === null || current.tenantId !== input.tenantId || current.caseId !== input.caseId || current.sessionId !== input.sessionId) return 'HUMAN_REVIEW';
    this.callbacks.add(key);
    const state = input.kind === 'CONSENT_GRANTED' ? 'LANGUAGE_SELECTION'
      : input.kind === 'LANGUAGE_SELECTED' ? 'CONTACTING'
        : input.kind === 'CONSENT_DECLINED' ? 'HUMAN_REVIEW' : 'HUMAN_REVIEW';
    this.store.contact = {
      ...current,
      state,
      version: current.version + 1,
      ...(input.selectedLanguage === undefined ? {} : { language: input.selectedLanguage }),
      lastInteractionAt: input.occurredAt,
      updatedAt: input.occurredAt,
      automationSuppressed: state === 'HUMAN_REVIEW',
      nextActionAt: state === 'HUMAN_REVIEW' ? null : input.occurredAt,
      responseDeadlineAt: state === 'HUMAN_REVIEW' ? null : current.responseDeadlineAt
    };
    return state === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'APPLIED';
  }
}

class MemoryFieldCompanionStore {
  constructor(store) { this.store = store; }
  async readSession(scope) {
    const current = this.store.contact;
    return current !== null && current.tenantId === scope.tenantId && current.caseId === scope.caseId && current.sessionId === scope.sessionId
      ? structuredClone(current) : null;
  }
  async deliver() { throw new Error('acceptance uses durable contact callbacks for consent and language'); }
}

class MemoryEvidenceRepository {
  records = new Map();
  audits = [];

  async create(record, audit) {
    this.records.set(record.id, structuredClone(record));
    this.audits.push(Object.freeze({ ...audit }));
  }

  async findById(id) { return structuredClone(this.records.get(id)); }

  async appendAccessAudit(record, audit) {
    assert.equal(this.records.get(record.id)?.roadEventId, record.roadEventId);
    this.audits.push(Object.freeze({ ...audit }));
  }

  async markPreserved(id, actualSizeBytes, verifiedChecksumSha256, completedAt, audit) {
    const current = this.records.get(id);
    assert.ok(current);
    const next = { ...current, status: 'PRESERVED', actualSizeBytes, verifiedChecksumSha256, completedAt };
    this.records.set(id, next);
    this.audits.push(Object.freeze({ ...audit }));
    return structuredClone(next);
  }

  async markQuarantined(id, reason, occurredAt, audit) {
    const current = this.records.get(id);
    assert.ok(current);
    const next = { ...current, status: 'QUARANTINED', quarantineReason: reason, completedAt: occurredAt };
    this.records.set(id, next);
    this.audits.push(Object.freeze({ ...audit }));
    return structuredClone(next);
  }
}

class MemoryEvidenceStorage {
  objects = new Map();

  async createUploadRequest(objectKey, _contentType, _sizeBytes, checksumSha256, expiresAt) {
    return { url: `https://evidence.invalid/${objectKey}`, expiresAt, requiredHeaders: { 'x-checksum-sha256': checksumSha256 } };
  }

  async createDownloadRequest(objectKey, expiresAt) {
    return { url: `https://evidence.invalid/${objectKey}?download=1`, expiresAt, requiredHeaders: {} };
  }

  async inspect(objectKey) {
    const object = this.objects.get(objectKey);
    if (object === undefined) return undefined;
    return {
      sizeBytes: object.bytes.byteLength,
      contentType: object.contentType,
      checksumSha256: createHash('sha256').update(object.bytes).digest('hex')
    };
  }

  async quarantine(objectKey, quarantineKey) {
    const object = this.objects.get(objectKey);
    if (object !== undefined) this.objects.set(quarantineKey, object);
  }

  put(objectKey, bytes, contentType) { this.objects.set(objectKey, { bytes: Buffer.from(bytes), contentType }); }
}

function encode(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }

function createTrustFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const issuer = 'https://identity.mvp.invalid';
  const audience = 'ros-api';
  const environment = {
    NODE_ENV: 'production', ROS_AUTH_PROFILE: 'oidc', OIDC_ISSUER: issuer,
    OIDC_JWKS_URL: `${issuer}/.well-known/jwks.json`, OIDC_AUDIENCE: audience,
    OIDC_ALLOWED_BINDINGS: JSON.stringify([
      { clientId: 'ros-mvp-browser', tenantId: TENANT, purpose: PURPOSE, roles: ['FIELD_USER', 'OPERATOR', 'SUPERVISOR', 'AUDITOR'] },
      { clientId: 'ros-mvp-other', tenantId: OTHER_TENANT, purpose: PURPOSE, roles: ['FIELD_USER'] }
    ]),
    OIDC_MAX_TOKEN_AGE_SECONDS: '600', OIDC_MAX_CLOCK_SKEW_SECONDS: '30',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300', OIDC_JWKS_MIN_REFRESH_SECONDS: '0'
  };
  const resolver = createRuntimeActorResolver(environment, {
    jwksFetch: async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'mvp-key-1', alg: 'RS256', use: 'sig', key_ops: ['verify'] }] }), {
      status: 200, headers: { 'content-type': 'application/jwk-set+json' }
    })
  });
  const token = ({ subject, roles, clientId = 'ros-mvp-browser', tenantId = TENANT }) => {
    const epoch = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'mvp-key-1' });
    const payload = encode({ sub: subject, iss: issuer, aud: [audience], azp: clientId, tenant_id: tenantId, purpose: PURPOSE, ros_roles: roles, amr: ['mfa'], iat: epoch - 5, exp: epoch + 300 });
    const input = `${header}.${payload}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input, 'ascii'), privateKey).toString('base64url')}`;
  };
  return { resolver, token };
}

function fetchAdapter(router) {
  let sequence = 0;
  return async (input, init = {}) => {
    const target = new URL(String(input), 'http://localhost');
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const query = Object.fromEntries(target.searchParams.entries());
    const body = typeof init.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : null;
    sequence += 1;
    const response = await router({
      method: init.method ?? 'GET', path: target.pathname, query, headers, body,
      traceId: headers['x-trace-id'] ?? `mvp-acceptance-${sequence}`
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'x-trace-id': `mvp-acceptance-${sequence}` }
    });
  };
}

async function verifyMigrations() {
  const directory = join(process.cwd(), 'database', 'migrations');
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const sequence = names.map((name) => name.slice(0, 4));
  assert.deepEqual(sequence, Array.from({ length: names.length }, (_, index) => String(index + 1).padStart(4, '0')));
  assert.deepEqual(Object.keys(APPLIED_MIGRATIONS), names, 'every migration must have an acceptance-pinned checksum');
  const wrappers = [];
  for (const name of names) {
    const source = await readFile(join(directory, name), 'utf8');
    const pinned = APPLIED_MIGRATIONS[name];
    if (pinned !== undefined) assert.equal(createHash('sha256').update(source).digest('hex'), pinned, `${name} changed after being pinned`);
    const prepared = prepareMigrationSql(name, source);
    if (prepared.strippedOuterTransaction) wrappers.push(name);
  }
  assert.deepEqual(wrappers, [
    '0006_ros_eye_contact_runtime.sql',
    '0007_ros_eye_privacy_security_oversight.sql',
    '0008_ros_eye_break_glass_atomic_proof.sql',
    '0009_ros_eye_safety_fusion_governance.sql'
  ]);
  return { count: names.length, first: names[0], last: names.at(-1), pinnedChecksums: Object.keys(APPLIED_MIGRATIONS).length, strippedOuterTransactions: wrappers.length };
}

async function run() {
  const migrationEvidence = await verifyMigrations();
  const roadEvents = new MemoryRoadEventRepository();
  const idempotency = new MemoryIdempotencyAdapter();
  const application = new RoadEventApplicationService(
    roadEvents,
    new RoleMatrixAuthorizationAdapter(),
    idempotency,
    new MemorySignalAttachmentAdapter(roadEvents),
    roadEvents
  );
  const notificationAudit = new MemoryNotificationAudit();
  const deviceRegistry = new MemoryDeviceRegistry();
  const humanSafetyStore = new MemoryHumanSafetyStore();
  const contactOrchestration = new MemoryContactOrchestration(humanSafetyStore);
  const fieldCompanionStore = new MemoryFieldCompanionStore(humanSafetyStore);
  const { resolver, token } = createTrustFixture();
  const mobileToken = token({ subject: OPERATOR_ID, roles: ['FIELD_USER'] });
  const operatorToken = token({ subject: OPERATOR_ID, roles: ['OPERATOR'] });
  const supervisorToken = token({ subject: SUPERVISOR_ID, roles: ['SUPERVISOR'] });
  const otherTenantToken = token({ subject: ATTACKER_ID, roles: ['FIELD_USER'], clientId: 'ros-mvp-other', tenantId: OTHER_TENANT });

  const roadHandler = createRoadEventHttpHandler(application, resolver, deviceRegistry);
  const mobileHandler = createMobileMvpHttpHandler(roadEvents, fieldCompanionStore, notificationAudit, idempotency, resolver, {
    contactOrchestration,
    devices: deviceRegistry,
    now: () => new Date(NOW)
  });
  const humanHandler = createHumanSafetyHttpHandler(application, humanSafetyStore, idempotency, resolver, () => new Date(NOW));
  const router = async (request) => {
    for (const handler of [mobileHandler, humanHandler]) {
      const response = await handler(request);
      if (response !== undefined) return response;
    }
    return roadHandler(request);
  };
  const fetcher = fetchAdapter(router);
  const mobile = new HttpFieldCompanionGateway({ apiBaseUrl: 'http://localhost', accessToken: () => mobileToken, fetcher });
  const otherTenantMobile = new HttpFieldCompanionGateway({ apiBaseUrl: 'http://localhost', accessToken: () => otherTenantToken, fetcher });
  const operatorSession = { tenantId: TENANT, purpose: PURPOSE, getAccessToken: async () => operatorToken };
  const supervisorSession = { tenantId: TENANT, purpose: PURPOSE, getAccessToken: async () => supervisorToken };
  const roadDashboard = new HttpRoadEventGateway('http://localhost', operatorSession, fetcher);
  const supervisorRoadDashboard = new HttpRoadEventGateway('http://localhost', supervisorSession, fetcher);
  const humanDashboard = new HttpHumanSafetyCommandCenterGateway('http://localhost', operatorSession, fetcher);
  const supervisorHumanDashboard = new HttpHumanSafetyCommandCenterGateway('http://localhost', supervisorSession, fetcher);

  const deviceRegistration = await mobile.registerDevice({
    deviceId: MOBILE_DEVICE_ID,
    platform: 'WEB',
    appVersion: '0.1.0',
    consent: {
      decision: 'GRANTED',
      policyVersion: 'ros-field-companion-device-registration-consent/v1',
      occurredAt: NOW.toISOString()
    }
  }, `mobile-device-registration-${MOBILE_REGISTRATION_OPERATION_ID}`);
  assert.equal(deviceRegistration.disposition, 'REGISTERED');
  const otherDeviceRegistration = await otherTenantMobile.registerDevice({
    deviceId: OTHER_DEVICE_ID,
    platform: 'WEB',
    appVersion: '0.1.0',
    consent: {
      decision: 'GRANTED',
      policyVersion: 'ros-field-companion-device-registration-consent/v1',
      occurredAt: NOW.toISOString()
    }
  }, `mobile-device-registration-${OTHER_REGISTRATION_OPERATION_ID}`);
  assert.equal(otherDeviceRegistration.disposition, 'REGISTERED');

  const created = await mobile.createIncidentReport({
    id: ROAD_EVENT_ID,
    occurredAt: NOW.toISOString(),
    latitude: 24.7136,
    longitude: 46.6753,
    severity: { level: 'S3', score: 82, confidence: 0.94, reasonCodes: ['MVP_CONFIRMED_HAZARD'], requiresHumanReview: true }
  }, 'mvp-road-event-0001');
  const sessionId = '77777777-7777-4777-8777-777777777777';
  const openedContact = await mobile.openContactSession(ROAD_EVENT_ID, {
    sessionId, language: 'UNKNOWN', preferredChannel: 'IN_APP'
  }, 'mvp-contact-open-0001');
  assert.equal(openedContact.disposition, 'APPLIED');
  const operation = (kind, payload, suffix) => ({
    operationId: `mvp-field-operation-${suffix}`,
    idempotencyKey: `mvp-field-idempotency-${suffix}`,
    kind,
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    attemptCount: 0,
    payload
  });
  const consentReceipt = await mobile.deliver({
    tenantId: TENANT, caseId: ROAD_EVENT_ID, sessionId,
    operation: operation('CONSENT', { decision: 'GRANTED', occurredAt: NOW.toISOString() }, 'consent')
  });
  assert.equal(consentReceipt.contactState, 'LANGUAGE_SELECTION');
  const languageReceipt = await mobile.deliver({
    tenantId: TENANT, caseId: ROAD_EVENT_ID, sessionId,
    operation: operation('LANGUAGE_SELECTION', { language: 'ar', occurredAt: NOW.toISOString() }, 'language')
  });
  assert.equal(languageReceipt.contactState, 'CONTACTING');
  const contactVersionAfterLanguage = humanSafetyStore.contact.version;
  const validating = await roadDashboard.transition(ROAD_EVENT_ID, { expectedVersion: created.version, nextStatus: 'VALIDATING', reason: 'MVP deterministic validation' });
  const confirmed = await roadDashboard.transition(ROAD_EVENT_ID, { expectedVersion: validating.version, nextStatus: 'CONFIRMED', reason: 'MVP hazard confirmed' });

  const mobilePrincipal = await resolver.resolve({ authorization: `Bearer ${mobileToken}`, 'x-actor-id': ATTACKER_ID, 'x-ros-roles': 'SUPERVISOR' });
  assert.deepEqual(mobilePrincipal.roles, ['FIELD_USER']);
  const principal = await resolver.resolve({ authorization: `Bearer ${operatorToken}`, 'x-actor-id': ATTACKER_ID, 'x-ros-roles': 'SUPERVISOR' });
  assert.equal(principal.actorId, OPERATOR_ID);
  assert.deepEqual(principal.roles, ['OPERATOR']);
  const evidenceRepository = new MemoryEvidenceRepository();
  const evidenceStorage = new MemoryEvidenceStorage();
  const evidenceService = new EvidenceService(
    evidenceRepository,
    evidenceStorage,
    new SafeLocalMalwareScanner(),
    new ScopedRoadEventEvidenceAuthorization(roadEvents),
    { now: () => new Date(NOW), createId: () => EVIDENCE_ID, uploadTtlMs: 120_000, downloadTtlMs: 60_000 }
  );
  const evidenceBytes = Buffer.from('ROS MVP evidence payload\n', 'utf8');
  const evidenceChecksum = createHash('sha256').update(evidenceBytes).digest('hex');
  const intent = await evidenceService.createUploadIntent({
    roadEventId: ROAD_EVENT_ID,
    principal,
    traceId: 'mvp-evidence-upload-001',
    filename: '../mvp-evidence.json',
    contentType: 'application/json',
    sizeBytes: evidenceBytes.byteLength,
    checksumSha256: evidenceChecksum,
    retention: { retainUntil: new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000), legalHold: false }
  });
  evidenceStorage.put(intent.evidence.objectKey, evidenceBytes, 'application/json');
  const preserved = await evidenceService.completeUpload(EVIDENCE_ID, principal, 'mvp-evidence-complete-001');
  assert.equal(preserved.status, 'PRESERVED');
  assert.equal(preserved.verifiedChecksumSha256, evidenceChecksum);
  const download = await evidenceService.createDownloadRequest(EVIDENCE_ID, principal, 'mvp-evidence-download-001');
  assert.match(download.url, /^https:\/\/evidence\.invalid\//);
  const otherPrincipal = await resolver.resolve({ authorization: `Bearer ${otherTenantToken}` });
  await assert.rejects(
    () => evidenceService.createDownloadRequest(EVIDENCE_ID, otherPrincipal, 'mvp-evidence-cross-tenant-001'),
    { name: 'EvidenceNotFoundError' }
  );
  assert.deepEqual(evidenceRepository.audits.map((entry) => entry.action), [
    'evidence.upload_intent_created',
    'evidence.preserved',
    'evidence.download_intent_created'
  ]);
  humanSafetyStore.attachEvidence(preserved, evidenceRepository.audits);

  const nearbyBefore = await mobile.nearby({ latitude: 24.7140, longitude: 46.6753, radiusMeters: 5_000 });
  assert.deepEqual(nearbyBefore.items.map((item) => item.roadEventId), [ROAD_EVENT_ID]);
  assert.equal(nearbyBefore.items[0].acknowledgedAt, null);
  const crossTenantNearby = await otherTenantMobile.nearby({ latitude: 24.7140, longitude: 46.6753, radiusMeters: 5_000 });
  assert.deepEqual(crossTenantNearby.items, []);
  const acknowledgement = await mobile.acknowledgeNotification(ROAD_EVENT_ID, 'mvp-notification-ack-0001');
  const repeatedAcknowledgement = await mobile.acknowledgeNotification(ROAD_EVENT_ID, 'mvp-notification-ack-0002');
  assert.equal(repeatedAcknowledgement.acknowledgedAt, acknowledgement.acknowledgedAt);
  const nearbyAfter = await mobile.nearby({ latitude: 24.7140, longitude: 46.6753, radiusMeters: 5_000 });
  assert.equal(nearbyAfter.items[0].acknowledgedAt, acknowledgement.acknowledgedAt);
  assert.equal(notificationAudit.entries.length, 1);

  const page = await humanDashboard.list();
  const initialCase = page.items.find((item) => item.safetyCase.id === ROAD_EVENT_ID);
  assert.ok(initialCase);
  assert.equal(initialCase.evidenceState, 'TRUSTED');
  assert.equal(initialCase.provenance[0].evidenceId, EVIDENCE_ID);
  const takeover = await humanDashboard.takeover(ROAD_EVENT_ID, {
    actorId: ATTACKER_ID,
    actorRoles: ['SUPERVISOR'],
    expectedCaseVersion: initialCase.safetyCase.version,
    expectedContactVersion: initialCase.contactSession.version,
    reason: 'Operator assumes manual control',
    traceId: 'mvp-takeover-001',
    occurredAt: NOW.toISOString(),
    idempotencyKey: 'mvp-takeover-0001'
  });
  assert.equal(takeover.contactSession.assignedOperatorId, OPERATOR_ID);
  assert.equal(takeover.contactSession.state, 'OPERATOR_TAKEOVER');
  const reassigned = await supervisorHumanDashboard.reassign(ROAD_EVENT_ID, {
    actorId: ATTACKER_ID,
    actorRoles: ['OPERATOR'],
    expectedCaseVersion: takeover.safetyCase.version,
    expectedContactVersion: takeover.contactSession.version,
    assigneeId: ASSIGNEE_ID,
    reason: 'Supervisor reassigns the active case',
    traceId: 'mvp-assignment-001',
    occurredAt: new Date(NOW.getTime() + 1_000).toISOString(),
    idempotencyKey: 'mvp-assignment-0001'
  });
  assert.equal(reassigned.contactSession.assignedOperatorId, ASSIGNEE_ID);
  assert.equal(reassigned.audit.at(-1).actorId, SUPERVISOR_ID);
  const timeline = await supervisorRoadDashboard.timeline(ROAD_EVENT_ID);
  assert.ok(timeline.length >= 3);

  const checks = [
    {
      requirement: 'Forward-only migration history remains immutable and executable under one runner-owned transaction',
      hazard: 'Changed checksums, migration gaps, or nested transaction controls create partial or untracked schema state',
      test: 'Pinned SHA-256 for 0001-0015, contiguous ordering, source preparation, focused rollback/ledger unit tests',
      evidence: migrationEvidence
    },
    {
      requirement: 'A registered least-privilege mobile principal opens durable consent/contact state and can acknowledge a recipient-scoped nearby RoadEvent notification',
      hazard: 'Unregistered device use, cross-tenant disclosure, self-attested identity, local-only consent, missing contact session, or duplicate acknowledgement',
      test: 'RS256 FIELD_USER bearer -> server-authoritative device registration -> mobile create/signal -> contact open -> durable consent/language callbacks -> dashboard transitions -> tracked nearby delivery -> cross-tenant empty result -> idempotent acknowledgement',
      evidence: {
        roadEventId: confirmed.id,
        status: confirmed.status,
        contactOpenDisposition: openedContact.disposition,
        deviceRegistrationDisposition: deviceRegistration.disposition,
        deviceRegistrationAuditEntries: deviceRegistry.audits.length,
        durableContactState: languageReceipt.contactState,
        durableContactVersion: contactVersionAfterLanguage,
        notificationCount: nearbyAfter.items.length,
        acknowledgementAuditEntries: notificationAudit.entries.length,
        trustedActorId: mobilePrincipal.actorId,
        trustedActorRoles: mobilePrincipal.roles
      }
    },
    {
      requirement: 'Human Safety cases expose evidence and accept operator/supervisor actions only from verified principals',
      hazard: 'Forged body roles/actor identity authorize safety-critical actions or evidence is omitted',
      test: 'Dashboard list -> takeover with forged body authority -> supervisor assignment through public HTTP handlers',
      evidence: { evidenceState: reassigned.evidenceState, provenanceCount: reassigned.provenance.length, finalAssigneeId: reassigned.contactSession.assignedOperatorId, auditActorId: reassigned.audit.at(-1).actorId }
    },
    {
      requirement: 'Evidence metadata, checksum and audit remain bound to the scoped RoadEvent',
      hazard: 'Tampered or cross-tenant evidence is treated as preserved or disclosed',
      test: 'EvidenceService upload intent -> independent byte digest -> preservation -> cross-tenant not-found',
      evidence: { evidenceId: preserved.id, status: preserved.status, checksum: preserved.verifiedChecksumSha256, auditActions: evidenceRepository.audits.map((entry) => entry.action), boundary: 'service seam plus independently tested Evidence HTTP authorization-before-replay adapter' }
    }
  ];

  console.log(JSON.stringify({ status: 'PASS', generatedAt: NOW.toISOString(), checks }, null, 2));
}

await run();
