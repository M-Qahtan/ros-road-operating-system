import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SENSOR_OBSERVATION_SCHEMA,
  type CounterfactualCandidate,
  type EvidenceAssuranceResult,
  type ProtectedOutcomeVector,
  type SensorObservationEnvelope
} from '@ros/contracts';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { IdempotencyConflictError, RoadEventApplicationService } from '../application/road-event-application.js';
import { buildCognitiveRoadState } from '../perception/cognitive-road-state-builder.js';
import { evaluateCounterfactualCandidates } from '../perception/spatial-counterfactual.js';

/**
 * WB-INT-01 / WB-HAZ-01: bounded, synthetic contract rehearsal.
 * This intentionally DOES NOT claim Heart P0, authenticated evidence provenance,
 * production CPAL/EIL, or a continuous Whole-Body E2E runtime path.
 * The human command below is explicit; a counterfactual NEVER authorizes it.
 */
const NOW = '2026-09-11T07:00:00+03:00';
const EVALUATED_AT = '2026-09-11T07:00:00.200+03:00';
const EXPIRES_AT = '2026-09-11T07:00:01.500+03:00';
const EVENT_ID = '97000000-0000-4000-8000-000000000001';
const ACTOR_ID = '97000000-0000-4000-8000-000000000011';
const SUPERVISOR_ID = '97000000-0000-4000-8000-000000000012';
const DIGEST = 'a'.repeat(64);
const TRACE_ID = 'whole-body-advisory-rehearsal-001';

function observation(): SensorObservationEnvelope {
  return {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: 'obs-whole-body-001',
    sourceId: 'synthetic-adapter-001',
    sourceClass: 'EXTERNAL_PERCEPTION_PLATFORM',
    capturedAt: '2026-09-11T06:59:59.500+03:00',
    receivedAt: '2026-09-11T06:59:59.700+03:00',
    sourceSequence: 1,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 200,
      freshnessTtlMs: 2_000,
      timeSource: 'PTP'
    },
    frame: { frameId: 'synthetic-adapter-001', coordinateSystem: 'EPSG:4978', transformDigest: DIGEST },
    calibration: { state: 'VALID', calibrationDigest: DIGEST },
    health: {
      state: 'HEALTHY',
      score: 0.99,
      metrics: [],
      degradationCauses: [],
      assessedAt: '2026-09-11T06:59:59.700+03:00'
    },
    provenance: {
      adapterName: 'synthetic-adapter',
      adapterVersion: '1.0.0',
      rawPayloadSha256: DIGEST,
      normalizedPayloadSha256: DIGEST,
      jurisdiction: 'SA-RIYADH',
      purpose: 'road-safety-response',
      parentObservationIds: []
    },
    payload: {
      kind: 'TRACK_SET',
      tracks: [{
        trackId: 'vehicle-001',
        objectClass: 'VEHICLE',
        state: {
          positionM: [10, 2, 0],
          estimatedVelocityMps: [20, 0, 0],
          covariance: [0.1, 0, 0, 0.1],
          estimator: 'synthetic-estimator-v1'
        },
        laneId: 'L2',
        roadSegmentId: 'RUH-Z41-R1',
        confidence: 0.92,
        supportingObservationIds: ['obs-whole-body-001']
      }]
    }
  };
}

function syntheticAssurance(): EvidenceAssuranceResult {
  // Fixture-only claim: NOT authenticated evidence or proof of source independence.
  return {
    objectBinding: 'vehicle-001',
    claimType: 'OBJECT_STATE',
    decision: 'CORROBORATED',
    effectiveIndependentEvidence: 2,
    rawClaimCount: 2,
    supportingIndependenceClasses: ['a'.repeat(64), 'b'.repeat(64)],
    contradictingIndependenceClasses: [],
    reasonCodes: [],
    authority: 'NONE'
  };
}

function outcomes(humanSafetyRisk: number): ProtectedOutcomeVector {
  return {
    humanSafetyRisk,
    emergencyAccessRisk: 2,
    secondaryIncidentRisk: 2,
    evidenceIntegrityRisk: 1,
    authorityPrivacyRisk: 1,
    criticalNetworkResilienceRisk: 1,
    mobilityCost: 5,
    delayCost: 5,
    efficiencyCost: 5
  };
}

function candidates(stateDigest: string): readonly CounterfactualCandidate[] {
  return [
    {
      candidateId: 'baseline',
      action: 'NO_ACTION',
      stateDigest,
      validUntil: EXPIRES_AT,
      assumptions: [],
      predictedOutcomes: outcomes(10),
      uncertainty: 0.1,
      authority: 'ADVISORY_ONLY',
      directVehicleControl: false,
      requiresVehicleLocalVeto: true
    },
    {
      candidateId: 'operator-warning',
      action: 'WARN_OPERATOR',
      stateDigest,
      validUntil: EXPIRES_AT,
      assumptions: ['synthetic-constant-velocity-v1'],
      predictedOutcomes: outcomes(4),
      uncertainty: 0.1,
      authority: 'ADVISORY_ONLY',
      directVehicleControl: false,
      requiresVehicleLocalVeto: true
    }
  ];
}

function cognitiveFixture() {
  return buildCognitiveRoadState({
    crsId: 'CRS-RUH-WB-001',
    zoneId: 'RUH-Z41',
    stateTime: NOW,
    validUntil: EXPIRES_AT,
    trustedNowEpochMs: Date.parse(NOW),
    observations: [observation()],
    assuranceResults: [syntheticAssurance()]
  });
}

test('WB-INT-01: synthetic observation to CRS to advisory, then separately authorized human RoadEvent and audit read', async () => {
  const built = cognitiveFixture();
  assert.equal(built.authority, 'NONE');
  assert.deepEqual(built.admittedObservationIds, ['obs-whole-body-001']);
  assert.equal(built.state.entities[0]?.epistemicState, 'CORROBORATED');
  const recommendation = evaluateCounterfactualCandidates({
    state: built.state,
    evaluatedAt: EVALUATED_AT,
    candidates: candidates(built.state.stateDigest),
    maxRecommendationUncertainty: 0.3
  });
  assert.equal(recommendation.decision, 'RECOMMEND');
  assert.equal(recommendation.selectedCandidateId, 'operator-warning');
  assert.equal(recommendation.stateDigest, built.state.stateDigest);
  assert.ok(recommendation.candidates.every((candidate) =>
    candidate.authority === 'ADVISORY_ONLY' && candidate.directVehicleControl === false));

  // The application command is made by an explicit human operator, NOT by CRS/advisory.
  const repository = new MemoryRoadEventRepository();
  const service = new RoadEventApplicationService(
    repository, new RoleMatrixAuthorizationAdapter(), new MemoryIdempotencyAdapter(),
    new MemorySignalAttachmentAdapter(repository), repository
  );
  const operator = {
    actorId: ACTOR_ID, roles: ['OPERATOR'] as const,
    tenantId: 'tenant-riyadh', purpose: 'road-safety-response'
  };
  const supervisor = { ...operator, actorId: SUPERVISOR_ID, roles: ['SUPERVISOR'] as const };
  const command = {
    id: EVENT_ID, occurredAt: '2026-09-11T04:00:00.000Z',
    latitude: 24.7136, longitude: 46.6753
  };
  const context = { actor: operator, traceId: TRACE_ID, idempotencyKey: 'wb-human-create-0001' };
  const created = await service.create(command, context);
  const repeated = await service.create(command, context);
  assert.equal(repeated.id, created.id);
  assert.equal(repeated.version, created.version);
  const read = await service.getById(EVENT_ID, supervisor);
  assert.equal(read.id, created.id);
  const timeline = await service.timeline(EVENT_ID, supervisor);
  assert.ok(timeline.some((entry) => entry.action === 'road_event.created'
    && entry.traceId === TRACE_ID && entry.actorId === ACTOR_ID));
  await assert.rejects(
    service.getById(EVENT_ID, { ...supervisor, tenantId: 'another-tenant' })
  );
  await assert.rejects(
    service.getById(EVENT_ID, { ...supervisor, purpose: 'commercial-analytics' })
  );
  // WB-INT-14/15: operations read models and audit timeline must remain scope-bound.
  const page = { limit: 20, offset: 0 };
  const authorizedPage = await service.list(page, supervisor);
  assert.equal(authorizedPage.total, 1);
  assert.deepEqual(authorizedPage.items.map((item) => item.id), [EVENT_ID]);
  for (const foreignSupervisor of [
    { ...supervisor, tenantId: 'another-tenant' },
    { ...supervisor, purpose: 'commercial-analytics' }
  ]) {
    const foreignPage = await service.list(page, foreignSupervisor);
    assert.equal(foreignPage.total, 0);
    assert.deepEqual(foreignPage.items, []);
    await assert.rejects(service.timeline(EVENT_ID, foreignSupervisor));
  }
  assert.deepEqual(await service.timeline(EVENT_ID, supervisor), timeline);
  await assert.rejects(
    service.create({ ...command, longitude: 46.7 }, context),
    IdempotencyConflictError
  );
});

test('WB-INT-01 negative: stale, substituted, or actuation-capable advice cannot pass the counterfactual boundary', () => {
  const state = cognitiveFixture().state;
  const baseline = candidates(state.stateDigest);
  const substituted = evaluateCounterfactualCandidates({
    state,
    evaluatedAt: EVALUATED_AT,
    candidates: baseline.map((candidate) => ({ ...candidate, stateDigest: 'b'.repeat(64) })),
    maxRecommendationUncertainty: 0.3
  });
  assert.equal(substituted.decision, 'ABSTAIN');
  assert.equal(substituted.selectedCandidateId, null);
  assert.ok(substituted.reasonCodes.includes('CANDIDATE_STATE_DIGEST_MISMATCH'));

  const stale = evaluateCounterfactualCandidates({
    state, evaluatedAt: '2026-09-11T07:00:02+03:00',
    candidates: baseline, maxRecommendationUncertainty: 0.3
  });
  assert.equal(stale.decision, 'REQUEST_MORE_EVIDENCE');
  assert.equal(stale.selectedCandidateId, null);
  assert.ok(stale.reasonCodes.includes('COGNITIVE_STATE_EXPIRED'));

  const forged = evaluateCounterfactualCandidates({
    state, evaluatedAt: EVALUATED_AT,
    candidates: [
      baseline[0]!,
      { ...baseline[1]!, directVehicleControl: true } as unknown as CounterfactualCandidate
    ],
    maxRecommendationUncertainty: 0.3
  });
  assert.equal(forged.decision, 'ABSTAIN');
  assert.equal(forged.selectedCandidateId, null);
  assert.ok(forged.reasonCodes.includes('DIRECT_VEHICLE_CONTROL_FORBIDDEN'));
});
