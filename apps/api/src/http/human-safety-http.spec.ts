import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { RoadEventApplicationService } from '../application/road-event-application.js';
import { AuthenticatedActor, IdempotencyPort, IdempotencyRecord } from '../application/ports.js';
import { ActorResolver } from './actor-resolver.js';
import {
  GovernedRecommendationReader,
  HumanSafetyBacking,
  HumanSafetyCaseView,
  HumanSafetyOperationalHealthReader,
  HumanSafetyStore,
  createHumanSafetyHttpHandler
} from './human-safety-http.js';
import type { GovernedRecommendationQueryResult } from '../ros-eye/recommendation-query-postgres.js';
import { HttpRequest } from './road-event-http.js';
import { ContactSessionRecord } from '../ros-eye/contact-orchestration.js';
import { RoadEventStatus } from '@ros/domain';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const TRACE_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-21T00:00:00.000Z');

const OPERATOR: AuthenticatedActor = {
  actorId: ACTOR_ID, roles: ['OPERATOR'], tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION'
};
const SUPERVISOR: AuthenticatedActor = { ...OPERATOR, roles: ['SUPERVISOR'] };

function contact(version = 3): ContactSessionRecord {
  return {
    tenantId: OPERATOR.tenantId, caseId: CASE_ID, sessionId: 'session-human-safety-001',
    ownerActorId: null,
    state: 'NO_RESPONSE', version, protocolVersion: 'ros-eye.contact.v1',
    promptPolicyVersion: 'ros-eye.contact-prompts.v1',
    accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
    language: 'ar', identityConfidence: 'PARTIAL', activeChannel: 'PUSH', attemptCount: 1,
    responseDeadlineAt: '2026-08-20T23:59:00.000Z', lastInteractionAt: '2026-08-20T23:58:00.000Z',
    assignedOperatorId: null,
    accessibility: {
      screenReaderRequired: true, handsFreeRequired: true, largeControlsRequired: true,
      simpleLanguageRequired: true, visualAlternativeRequired: true, audioAlternativeRequired: true
    },
    automationSuppressed: false, nextActionAt: '2026-08-20T23:59:00.000Z', leaseOwner: null,
    leaseExpiresAt: null, updatedAt: '2026-08-20T23:58:00.000Z'
  };
}

class FakeStore implements HumanSafetyStore {
  current = contact();
  mutations = 0;
  reads = 0;
  recommendation: HumanSafetyBacking['recommendation'] = null;
  provenance: HumanSafetyBacking['provenance'] = [];
  audit: HumanSafetyBacking['audit'] = [];
  evidenceState: HumanSafetyBacking['evidenceState'] = 'TRUSTED';

  async read(): Promise<HumanSafetyBacking> {
    this.reads += 1;
    return { contact: this.current, recommendation: this.recommendation, evidenceState: this.evidenceState, provenance: this.provenance, audit: this.audit };
  }

  async mutate(input: Parameters<HumanSafetyStore['mutate']>[0]): Promise<void> {
    this.mutations += 1;
    assert.equal(input.actorId, ACTOR_ID);
    assert.equal(input.actorRole, input.action === 'assignment' ? 'SUPERVISOR' : input.actorRole);
    if (input.expectedContactVersion !== this.current.version) throw new Error('stale');
    this.current = {
      ...this.current,
      version: this.current.version + 1,
      state: input.action === 'takeover' ? 'OPERATOR_TAKEOVER' : input.action === 'escalate' ? 'ESCALATED' : this.current.state,
      assignedOperatorId: input.action === 'assignment' ? input.assigneeId! : input.actorId,
      automationSuppressed: true,
      responseDeadlineAt: null,
      nextActionAt: null,
      updatedAt: input.occurredAt
    };
  }
}

class FakeGovernedRecommendations implements GovernedRecommendationReader {
  reads = 0;
  actor: AuthenticatedActor | null = null;
  constructor(readonly result: GovernedRecommendationQueryResult) {}
  async read(actor: AuthenticatedActor, caseId: string): Promise<GovernedRecommendationQueryResult> {
    this.reads += 1;
    this.actor = actor;
    assert.equal(caseId, CASE_ID);
    return this.result;
  }
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
  put<T>(scope: string, key: string, value: IdempotencyRecord<T>): Promise<void> {
    return this.memory.put(scope, key, value);
  }
}

const HEALTHY_RUNTIME: HumanSafetyOperationalHealthReader = {
  read: async () => ({ connectivity: 'HEALTHY', dependencyHealth: 'HEALTHY' })
};

function currentGovernedReader(): GovernedRecommendationReader {
  const recommendation = { ...fusionRecommendation(), deterministicFingerprint: `sha256:${'c'.repeat(64)}` };
  return new FakeGovernedRecommendations({
    status: 'AVAILABLE',
    snapshot: { status: 'VERIFIED', reason: 'VERIFIED', sourceSnapshotDigest: 'd'.repeat(64) },
    recommendation, humanReviewStatus: 'PENDING', mode: 'SHADOW_ONLY', activationAuthorized: false,
    sourceVersions: { inputVersion: recommendation.inputVersion, sourceSnapshotDigest: 'd'.repeat(64),
      caseRevision: 11, severityRevision: 12, contactRevision: 13, evidenceRevision: 14, indicatorRevision: 15 }
  });
}

async function fixture(
  actor: AuthenticatedActor = OPERATOR,
  governed: GovernedRecommendationReader | null = null,
  health: HumanSafetyOperationalHealthReader | null = HEALTHY_RUNTIME,
  severity: 'S1' | 'S4' = 'S4'
) {
  const repository = new MemoryRoadEventRepository();
  const appIdempotency = new MemoryIdempotencyAdapter();
  const application = new RoadEventApplicationService(
    repository, new RoleMatrixAuthorizationAdapter(), appIdempotency,
    new MemorySignalAttachmentAdapter(repository), repository
  );
  await application.create({
    id: CASE_ID, occurredAt: '2020-08-20T23:50:00.000Z', latitude: 24.7136, longitude: 46.6753,
    severity: { level: severity as never, score: severity === 'S4' ? 95 : 20, confidence: 0.95,
      reasonCodes: ['possible_impact'], requiresHumanReview: severity === 'S4' }
  }, { actor: OPERATOR, traceId: TRACE_ID, idempotencyKey: 'create-human-safety-case-001' });
  const store = new FakeStore();
  const idempotency = new TrackingIdempotency();
  const resolver: ActorResolver = { resolve: async () => actor };
  return {
    application, store, idempotency,
    handler: createHumanSafetyHttpHandler(application, store, idempotency, resolver, () => new Date(NOW), governed, health)
  };
}

function request(
  method: string,
  path: string,
  body: unknown = null,
  headers: Readonly<Record<string, string | undefined>> = {}
): HttpRequest {
  return { method, path, body, headers, query: {}, traceId: TRACE_ID };
}

test('list and detail expose live scoped RoadEvents with durable contact state', async () => {
  const { handler } = await fixture();
  const list = await handler(request('GET', '/api/v1/human-safety/cases'));
  assert.equal(list?.status, 200);
  const page = (list!.body as { data: { items: Array<{ safetyCase: { id: string; state: string } }> } }).data;
  assert.deepEqual(page.items.map((item) => [item.safetyCase.id, item.safetyCase.state]), [[CASE_ID, 'NO_RESPONSE']]);
  const detail = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  assert.equal(detail?.status, 200);
});

function fusionRecommendation(): NonNullable<HumanSafetyBacking['recommendation']> {
  return {
    tenantId: OPERATOR.tenantId, caseId: CASE_ID, inputVersion: 37, evaluatedAt: '2026-08-20T23:59:30.000Z',
    currentSeverity: 'S4', recommendedSeverity: 'S2', score: 45, confidence: 0.6, uncertainty: 0.5,
    reasonCodes: ['FUSION_NO_RESPONSE'], missingEvidenceFlags: ['MISSING_CONTACT_OUTCOME'], contributions: [],
    guardResults: (['DATA_QUALITY', 'DRIFT', 'OUT_OF_DISTRIBUTION', 'ADVERSARIAL_INPUT'] as const).map((kind) => ({
      kind, disposition: 'CLEAR', reasonCode: 'clear', guardVersion: 'test.v1', evaluatedInputVersion: 37
    })),
    requiresHumanReview: true, authority: 'RECOMMENDATION_ONLY', autonomousDowngradePermitted: false,
    autonomousClosurePermitted: false, autonomousDispatchPermitted: false, policyVersion: 'ros-eye.safety-fusion.v1',
    ruleSetVersion: 'ros-eye.rules.baseline.v1', thresholdVersion: 'ros-eye.safety-fusion.thresholds.v1', deterministicFingerprint: 'b'.repeat(64)
  };
}

test('authorized list and detail derive shadow advice without mutation or severity replacement', async () => {
  const { handler, store } = await fixture();
  store.recommendation = fusionRecommendation();
  const list = await handler(request('GET', '/api/v1/human-safety/cases'));
  const page = (list!.body as { data: { items: HumanSafetyCaseView[] } }).data;
  const detail = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (detail!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(list?.status, 200);
  assert.equal(detail?.status, 200);
  assert.deepEqual(item.nextEvidenceAdvice, page.items[0]!.nextEvidenceAdvice);
  assert.equal(item.safetyCase.severity, 'S4');
  assert.equal(item.safetyCase.version, 1);
  assert.equal(item.nextEvidenceAdvice.sourceInputVersion, 37);
  assert.equal(item.nextEvidenceAdvice.status, 'SUGGESTED');
  assert.equal(item.nextEvidenceAdvice.generatedAt, NOW.toISOString());
  assert.equal(item.nextEvidenceAdvice.sourceSnapshotStatus, 'UNVERIFIED');
  assert.equal(item.nextEvidenceAdvice.collectionPermitted, false);
  assert.equal(item.nextEvidenceAdvice.reviewPriority, 'URGENT');
  assert.equal(store.mutations, 0);
  assert.equal(store.current.version, 3);
});

test('current governed recommendation replaces legacy compatibility only for the authorized read', async () => {
  const recommendation = { ...fusionRecommendation(), deterministicFingerprint: `sha256:${'c'.repeat(64)}` };
  const governed = new FakeGovernedRecommendations({
    status: 'AVAILABLE',
    snapshot: { status: 'VERIFIED', reason: 'VERIFIED', sourceSnapshotDigest: 'd'.repeat(64) },
    recommendation, humanReviewStatus: 'PENDING', mode: 'SHADOW_ONLY', activationAuthorized: false,
    sourceVersions: { inputVersion: 37, sourceSnapshotDigest: 'd'.repeat(64), caseRevision: 11,
      severityRevision: 12, contactRevision: 13, evidenceRevision: 14, indicatorRevision: 15 }
  });
  const { handler, store } = await fixture(OPERATOR, governed);
  store.recommendation = fusionRecommendation();
  const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (response!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(response?.status, 200);
  assert.equal(item.recommendation?.deterministicFingerprint, recommendation.deterministicFingerprint);
  assert.deepEqual(item.recommendationState, {
    source: 'GOVERNED_JOURNAL', status: 'CURRENT', humanReviewStatus: 'PENDING',
    snapshotReason: 'VERIFIED', mode: 'SHADOW_ONLY', activationAuthorized: false
  });
  assert.deepEqual(item.sourceVersionState, {
    status: 'VERIFIED', reason: 'VERIFIED', inputVersion: 37, sourceSnapshotDigest: 'd'.repeat(64),
    caseRevision: 11, severityRevision: 12, contactRevision: 13, evidenceRevision: 14, indicatorRevision: 15
  });
  assert.equal(item.safetyCase.severityAssessmentVersion, 12);
  assert.equal(item.safetyCase.evidenceRevision, 14);
  assert.equal(item.safetyCase.indicatorRevision, 15);
  assert.equal(item.nextEvidenceAdvice.status, 'SUGGESTED');
  assert.equal(item.nextEvidenceAdvice.sourceFingerprint, recommendation.deterministicFingerprint);
  assert.equal(governed.actor, OPERATOR);
  assert.equal(store.mutations, 0);
});

test('closed case withholds current recommendation while preserving governed journal history', async () => {
  const governed = currentGovernedReader();
  const current = await fixture(SUPERVISOR, governed, HEALTHY_RUNTIME, 'S1');
  let event = await current.application.getById(CASE_ID, SUPERVISOR);
  for (const nextStatus of [
    RoadEventStatus.Validating,
    RoadEventStatus.Confirmed,
    RoadEventStatus.SafetyAssessment,
    RoadEventStatus.ResponseCoordination,
    RoadEventStatus.RoadClearance,
    RoadEventStatus.Recovery,
    RoadEventStatus.Closed
  ]) {
    event = await current.application.transition({
      roadEventId: CASE_ID, expectedVersion: event.version, nextStatus, reason: `advance to ${nextStatus}`
    }, {
      actor: SUPERVISOR, traceId: TRACE_ID, idempotencyKey: `closed-recommendation-${nextStatus}`
    });
  }

  const response = await current.handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (response!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(response?.status, 200);
  assert.equal(item.safetyCase.state, 'RESOLVED');
  assert.equal(item.recommendation, null);
  assert.deepEqual(item.recommendationState, {
    source: 'GOVERNED_JOURNAL', status: 'WITHHELD', humanReviewStatus: 'PENDING',
    snapshotReason: 'CASE_CLOSED', mode: 'SHADOW_ONLY', activationAuthorized: false
  });
  assert.equal(item.nextEvidenceAdvice.status, 'ABSTAIN');
  assert.equal(item.sourceVersionState.status, 'VERIFIED');
  assert.equal((governed as FakeGovernedRecommendations).reads, 1);
  assert.equal(current.store.mutations, 0);
});

test('withheld governed recommendation suppresses legacy fallback and preserves urgent human review', async () => {
  const governed = new FakeGovernedRecommendations({
    status: 'WITHHELD',
    snapshot: { status: 'INVALIDATED', reason: 'CURRENT_INPUT_CHANGED', sourceSnapshotDigest: 'd'.repeat(64) },
    recommendation: null, humanReviewStatus: 'PENDING', mode: 'SHADOW_ONLY', activationAuthorized: false,
    sourceVersions: null
  });
  const { handler, store } = await fixture(OPERATOR, governed);
  store.recommendation = fusionRecommendation();
  const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (response!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(response?.status, 200);
  assert.equal(item.recommendation, null);
  assert.deepEqual(item.recommendationState, {
    source: 'GOVERNED_JOURNAL', status: 'WITHHELD', humanReviewStatus: 'PENDING',
    snapshotReason: 'CURRENT_INPUT_CHANGED', mode: 'SHADOW_ONLY', activationAuthorized: false
  });
  assert.equal(item.nextEvidenceAdvice.status, 'ABSTAIN');
  assert.equal(item.nextEvidenceAdvice.reviewPriority, 'URGENT');
  assert.equal(item.safetyCase.severity, 'S4');
  assert.deepEqual(item.sourceVersionState, {
    status: 'WITHHELD', reason: 'CURRENT_INPUT_CHANGED', inputVersion: null, sourceSnapshotDigest: null,
    caseRevision: null, severityRevision: null, contactRevision: null, evidenceRevision: null, indicatorRevision: null
  });
  assert.equal(item.safetyCase.severityAssessmentVersion, 0);
  assert.equal(item.safetyCase.evidenceRevision, 0);
  assert.equal(item.safetyCase.indicatorRevision, 0);
  assert.equal(store.mutations, 0);
});

test('missing governed journal retains legacy recommendation only as explicitly unverified compatibility', async () => {
  const governed = new FakeGovernedRecommendations({
    status: 'NOT_FOUND', snapshot: null, recommendation: null,
    humanReviewStatus: null, mode: null, activationAuthorized: false, sourceVersions: null
  });
  const { handler, store } = await fixture(OPERATOR, governed);
  store.recommendation = fusionRecommendation();
  const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (response!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(response?.status, 200);
  assert.equal(item.recommendation?.deterministicFingerprint, fusionRecommendation().deterministicFingerprint);
  assert.deepEqual(item.recommendationState, {
    source: 'LEGACY_COMPATIBILITY', status: 'UNVERIFIED', humanReviewStatus: null,
    snapshotReason: 'LEGACY_UNBOUND', mode: 'SHADOW_ONLY', activationAuthorized: false
  });
  assert.equal(item.sourceVersionState.status, 'UNAVAILABLE');
  assert.equal(item.sourceVersionState.severityRevision, null);
});

test('case reads expose observed degraded health instead of synthesizing healthy dependencies', async () => {
  const health: HumanSafetyOperationalHealthReader = {
    read: async () => ({ connectivity: 'DEGRADED', dependencyHealth: 'UNAVAILABLE' })
  };
  const { handler } = await fixture(OPERATOR, null, health);
  const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
  const item = (response!.body as { data: HumanSafetyCaseView }).data;
  assert.equal(response?.status, 200);
  assert.equal(item.connectivity, 'DEGRADED');
  assert.equal(item.dependencyHealth, 'UNAVAILABLE');
  assert.equal(item.safetyCase.highRiskResolutionAuthorization, null);
});

test('missing or failing health observation fails closed and blocks resolution authorization', async () => {
  for (const health of [
    null,
    { read: async () => { throw new Error('probe unavailable'); } } satisfies HumanSafetyOperationalHealthReader
  ]) {
    const current = await fixture(SUPERVISOR, null, health);
    const response = await current.handler(request(
      'POST', `/api/v1/human-safety/cases/${CASE_ID}/resolution-authorization`,
      { expectedCaseVersion: 1, expectedContactVersion: null, reason: 'verify safe closure', idempotencyKey: 'resolution-health-gate-001' },
      { 'idempotency-key': 'resolution-health-gate-001' }
    ));
    assert.equal(response?.status, 503);
    assert.equal((response!.body as { error: { code: string } }).error.code, 'OPERATIONAL_HEALTH_UNVERIFIED');
    assert.equal((await current.application.getById(CASE_ID, SUPERVISOR)).closureAuthorization, null);
  }
});

test('healthy observed dependencies permit supervisor authorization without closing the road event', async () => {
  const current = await fixture(SUPERVISOR, currentGovernedReader());
  let event = await current.application.getById(CASE_ID, SUPERVISOR);
  for (const nextStatus of [
    RoadEventStatus.Validating,
    RoadEventStatus.Confirmed,
    RoadEventStatus.SafetyAssessment,
    RoadEventStatus.ResponseCoordination,
    RoadEventStatus.RoadClearance,
    RoadEventStatus.Recovery
  ]) {
    event = await current.application.transition({
      roadEventId: CASE_ID, expectedVersion: event.version, nextStatus, reason: `advance to ${nextStatus}`
    }, {
      actor: SUPERVISOR, traceId: TRACE_ID, idempotencyKey: `resolution-health-transition-${nextStatus}`
    });
  }
  const response = await current.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/resolution-authorization`,
    { expectedCaseVersion: event.version, expectedContactVersion: null, reason: 'verified evidence and runtime health', idempotencyKey: 'resolution-health-gate-healthy-001' },
    { 'idempotency-key': 'resolution-health-gate-healthy-001' }
  ));
  assert.equal(response?.status, 200);
  const authorized = await current.application.getById(CASE_ID, SUPERVISOR);
  assert.notEqual(authorized.closureAuthorization, null);
  assert.deepEqual(authorized.closureAuthorization?.sourceSnapshot, {
    inputVersion: 37,
    sourceSnapshotDigest: 'd'.repeat(64)
  });
  assert.notEqual(authorized.status, 'CLOSED');
});

test('high-risk authorization requires a current governed snapshot without blocking human takeover', async () => {
  const current = await fixture(SUPERVISOR);
  const response = await current.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/resolution-authorization`,
    { expectedCaseVersion: 1, expectedContactVersion: null, reason: 'verify source snapshot', idempotencyKey: 'resolution-snapshot-gate-001' },
    { 'idempotency-key': 'resolution-snapshot-gate-001' }
  ));
  assert.equal(response?.status, 409);
  assert.equal((response!.body as { error: { code: string } }).error.code, 'SOURCE_SNAPSHOT_UNVERIFIED');
  assert.equal((await current.application.getById(CASE_ID, SUPERVISOR)).closureAuthorization, null);
  assert.equal(current.store.mutations, 0);

  const takeover = await current.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, reason: 'retain human control', idempotencyKey: 'snapshot-gate-takeover-001' },
    { 'idempotency-key': 'snapshot-gate-takeover-001' }
  ));
  assert.equal(takeover?.status, 200);
  assert.equal(current.store.mutations, 1);
  assert.equal(current.store.current.state, 'OPERATOR_TAKEOVER');
});

test('read advice remains behind role, tenant and purpose authorization', async () => {
  for (const actor of [
    { ...OPERATOR, roles: ['FIELD_USER'] as AuthenticatedActor['roles'] },
    { ...OPERATOR, tenantId: 'other-tenant' }, { ...OPERATOR, purpose: 'other-purpose' }
  ]) {
    const { handler, store } = await fixture(actor);
    store.recommendation = fusionRecommendation();
    const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
    assert.ok(response?.status === 403 || response?.status === 404);
    assert.equal(store.reads, 0);
    assert.equal(store.mutations, 0);
    assert.doesNotMatch(JSON.stringify(response?.body), /nextEvidenceAdvice|bbbbbbbb/);
  }
});

test('absent or incompatible advice preserves the live case and urgent human path', async () => {
  const setups: readonly ((store: FakeStore) => void)[] = [
    () => {},
    (store) => { store.recommendation = { ...fusionRecommendation(), evaluatedAt: '2026-08-20T23:54:00.000Z' }; },
    (store) => { store.recommendation = { ...fusionRecommendation(), evaluatedAt: '2026-08-21T00:01:00.000Z' }; },
    (store) => { store.recommendation = { ...fusionRecommendation(), guardResults: [] }; },
    (store) => { store.recommendation = fusionRecommendation(); store.current = { ...store.current, updatedAt: NOW.toISOString() }; },
    (store) => { store.recommendation = fusionRecommendation(); store.provenance = [{ evidenceId: 'evidence-1', sourceType: 'PHONE', integrity: 'VERIFIED', status: 'ACTIVE', receivedAt: NOW.toISOString() }]; },
    (store) => { store.recommendation = fusionRecommendation(); store.provenance = [{ evidenceId: 'evidence-1', sourceType: 'PHONE', integrity: 'VERIFIED', status: 'REVOKED', receivedAt: '2026-08-20T23:58:00.000Z' }]; },
    (store) => { store.recommendation = fusionRecommendation(); store.audit = [{ eventId: 'audit-1', action: 'contact.updated', actorId: ACTOR_ID, actorRole: 'OPERATOR', reason: 'updated', reasonCode: 'updated', traceId: TRACE_ID, occurredAt: NOW.toISOString(), caseVersion: 1, immutable: true }]; }
  ];
  for (const setup of setups) {
    const { handler, store } = await fixture();
    setup(store);
    const response = await handler(request('GET', `/api/v1/human-safety/cases/${CASE_ID}`));
    assert.equal(response?.status, 200);
    const item = (response!.body as { data: HumanSafetyCaseView }).data;
    assert.equal(item.nextEvidenceAdvice.status, 'ABSTAIN');
    assert.equal(item.nextEvidenceAdvice.reviewPriority, 'URGENT');
    assert.equal(item.safetyCase.severity, 'S4');
    assert.equal(item.safetyCase.state, 'NO_RESPONSE');
    assert.equal(store.mutations, 0);
  }
});

test('takeover uses only the trusted principal and replays without a second mutation', async () => {
  const { handler, store } = await fixture();
  const body = {
    actorId: 'forged-actor', actorRoles: ['SUPERVISOR'], expectedCaseVersion: 1,
    expectedContactVersion: 3, reason: 'no response takeover', idempotencyKey: 'takeover-human-safety-001'
  };
  const headers = { 'idempotency-key': 'takeover-human-safety-001' };
  const first = await handler(request('POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`, body, headers));
  const replay = await handler(request('POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`, body, headers));
  assert.equal(first?.status, 200);
  assert.equal(replay?.status, 200);
  assert.equal(store.mutations, 1);
  assert.equal(store.current.assignedOperatorId, ACTOR_ID);
});

test('resource scope is authorized before idempotency replay lookup', async () => {
  const wrongScope = { ...OPERATOR, actorId: OTHER_ACTOR_ID, tenantId: 'other-tenant' };
  const { handler, idempotency } = await fixture(wrongScope);
  const response = await handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/takeover`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, reason: 'forged replay', idempotencyKey: 'takeover-human-safety-002' },
    { 'idempotency-key': 'takeover-human-safety-002' }
  ));
  assert.equal(response?.status, 404);
  assert.equal(idempotency.gets, 0);
});

test('assignment and high-risk resolution remain supervisor-only', async () => {
  const operator = await fixture();
  const denied = await operator.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: OTHER_ACTOR_ID, reason: 'reassign', idempotencyKey: 'assign-human-safety-001' },
    { 'idempotency-key': 'assign-human-safety-001' }
  ));
  assert.equal(denied?.status, 403);

  const supervisor = await fixture(SUPERVISOR);
  const assigned = await supervisor.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: OTHER_ACTOR_ID, reason: 'supervised reassign', idempotencyKey: 'assign-human-safety-002' },
    { 'idempotency-key': 'assign-human-safety-002' }
  ));
  assert.equal(assigned?.status, 200);
  assert.equal(supervisor.store.current.assignedOperatorId, OTHER_ACTOR_ID);

  const invalidAssignee = await fixture(SUPERVISOR);
  const invalid = await invalidAssignee.handler(request(
    'POST', `/api/v1/human-safety/cases/${CASE_ID}/assignment`,
    { expectedCaseVersion: 1, expectedContactVersion: 3, assigneeId: 'unprovisioned-operator', reason: 'unsafe reassign', idempotencyKey: 'assign-human-safety-003' },
    { 'idempotency-key': 'assign-human-safety-003' }
  ));
  assert.equal(invalid?.status, 400);
  assert.equal(invalidAssignee.store.mutations, 0);
});
