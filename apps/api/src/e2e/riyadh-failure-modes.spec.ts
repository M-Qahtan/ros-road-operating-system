import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventStatus, SeverityLevel } from '@ros/domain';
import {
  ApplicationConflictError,
  RoadEventApplicationService
} from '../application/road-event-application.js';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import {
  DependencySafetyGate,
  DeterministicDeliveryGuard,
  DeterministicEvidenceGuard,
  DeterministicSignalFusionGate,
  HumanSafetyDeadline,
  assertRoadMayClose,
  assertSeverityChangeAllowed
} from './riyadh-failure-modes.js';

const EVENT_ID = '91000000-0000-4000-8000-000000000001';
const OPERATOR_ID = '91000000-0000-4000-8000-000000000010';
const SUPERVISOR_ID = '91000000-0000-4000-8000-000000000011';
const NOW = Date.parse('2026-07-25T10:10:00.000Z');

function createService() {
  const repository = new MemoryRoadEventRepository();
  return {
    repository,
    service: new RoadEventApplicationService(
      repository,
      new RoleMatrixAuthorizationAdapter(),
      new MemoryIdempotencyAdapter(),
      new MemorySignalAttachmentAdapter(),
      repository
    )
  };
}

const operator = { actorId: OPERATOR_ID, roles: ['OPERATOR'] as const };
const supervisor = { actorId: SUPERVISOR_ID, roles: ['SUPERVISOR'] as const };

async function createHighSeverityEvent() {
  const { service } = createService();
  const created = await service.create({
    id: EVENT_ID,
    occurredAt: '2026-07-25T10:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  }, { actor: operator, traceId: 'failure-mode-create', idempotencyKey: 'failure-create-0001' });
  const high = await service.reassessSeverity({
    roadEventId: EVENT_ID,
    expectedVersion: created.version,
    assessment: {
      level: SeverityLevel.High,
      score: 82,
      confidence: 0.92,
      reasonCodes: ['human_safety_risk'],
      requiresHumanReview: true
    },
    reason: 'Deterministic failure-mode fixture'
  }, { actor: operator, traceId: 'failure-mode-severity', idempotencyKey: 'failure-severity-0001' });
  return { service, high };
}

test('conflicting high-confidence signals fail safe to human review', () => {
  const gate = new DeterministicSignalFusionGate();
  const decision = gate.evaluate([
    { id: 'signal-a', confidence: 0.93, occurredAtMs: NOW - 5_000, direction: 'INCIDENT' },
    { id: 'signal-b', confidence: 0.91, occurredAtMs: NOW - 4_000, direction: 'NO_INCIDENT' }
  ], NOW);
  assert.equal(decision.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(decision.accepted.length, 0);
  assert.equal(decision.reason, 'conflicting_high_confidence_signals');
});

test('low-confidence and late signals cannot silently create authority', () => {
  const gate = new DeterministicSignalFusionGate(0.8, 60_000);
  const decision = gate.evaluate([
    { id: 'low', confidence: 0.42, occurredAtMs: NOW - 10_000, direction: 'INCIDENT' },
    { id: 'late', confidence: 0.95, occurredAtMs: NOW - 90_000, direction: 'INCIDENT' }
  ], NOW);
  assert.equal(decision.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(decision.accepted.length, 0);
  assert.equal(decision.rejected.length, 2);
});

test('late corroborating evidence forces revalidation instead of unsafe automatic progression', () => {
  const gate = new DeterministicSignalFusionGate(0.75, 60_000);
  const decision = gate.evaluate([
    { id: 'current', confidence: 0.96, occurredAtMs: NOW - 2_000, direction: 'INCIDENT' },
    { id: 'late', confidence: 0.97, occurredAtMs: NOW - 120_000, direction: 'INCIDENT' }
  ], NOW);
  assert.equal(decision.state, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(decision.accepted.length, 1);
  assert.equal(decision.reason, 'late_signal_requires_revalidation');
});

test('concurrent stale updates are rejected deterministically', async () => {
  const { service, high } = await createHighSeverityEvent();
  const first = await service.transition({
    roadEventId: EVENT_ID,
    expectedVersion: high.version,
    nextStatus: RoadEventStatus.Validating,
    reason: 'First concurrent writer wins'
  }, { actor: operator, traceId: 'concurrency-a', idempotencyKey: 'concurrency-update-a' });
  assert.equal(first.status, RoadEventStatus.Validating);
  await assert.rejects(
    service.transition({
      roadEventId: EVENT_ID,
      expectedVersion: high.version,
      nextStatus: RoadEventStatus.Validating,
      reason: 'Stale concurrent writer must fail'
    }, { actor: operator, traceId: 'concurrency-b', idempotencyKey: 'concurrency-update-b' }),
    ApplicationConflictError
  );
});

test('duplicate, retry-storm and out-of-order notifications remain idempotent', () => {
  const guard = new DeterministicDeliveryGuard();
  const message = { key: `${EVENT_ID}:ambulance`, sequence: 2, payload: 'ESCALATE_S3' };
  assert.equal(guard.deliver(message), 'DELIVERED');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assert.equal(guard.deliver(message), 'DUPLICATE_IGNORED');
  }
  assert.equal(guard.deliver({ ...message, sequence: 1, payload: 'OLD_ESCALATION' }), 'OUT_OF_ORDER_BLOCKED');
  assert.equal(guard.deliveredCount(), 1);
  assert.equal(guard.attemptCount(message.key), 52);
});

test('critical dependency failures degrade safely and block unsafe closure', () => {
  for (const dependency of ['POSTGRESQL', 'REDIS', 'OBJECT_STORAGE', 'NETWORK'] as const) {
    const gate = new DependencySafetyGate();
    gate.fail(dependency);
    assert.throws(() => gate.assertSafeFor('CLOSE_EVENT'), /safe degradation blocked CLOSE_EVENT/);
    gate.recover(dependency);
    assert.doesNotThrow(() => gate.assertSafeFor('CLOSE_EVENT'));
  }
});

test('evidence checksum mismatch, scanner failure, missing evidence and cross-event access fail closed', () => {
  const guard = new DeterministicEvidenceGuard();
  const cleanContent = 'verified-riyadh-evidence';
  const expected = '0'.repeat(64);
  assert.equal(guard.complete({
    id: 'evidence-tampered',
    roadEventId: EVENT_ID,
    expectedChecksum: expected,
    content: cleanContent,
    scan: 'CLEAN'
  }), 'QUARANTINED');
  assert.throws(() => guard.read('evidence-tampered', EVENT_ID), /quarantined/);
  assert.equal(guard.complete({
    id: 'evidence-scan-error',
    roadEventId: EVENT_ID,
    expectedChecksum: expected,
    content: cleanContent,
    scan: 'SCANNER_ERROR'
  }), 'QUARANTINED');
  assert.throws(() => guard.read('missing', EVENT_ID), /missing/);
  assert.throws(() => guard.read('evidence-tampered', '91000000-0000-4000-8000-000000000099'), /cross-event/);
});

test('unanswered human-safety conversation escalates exactly at its deadline', () => {
  const deadline = new HumanSafetyDeadline(NOW, 30_000);
  assert.equal(deadline.state(NOW + 29_999), 'WAITING');
  assert.equal(deadline.state(NOW + 30_000), 'ESCALATED');
  const acknowledged = new HumanSafetyDeadline(NOW, 30_000);
  acknowledged.acknowledge(NOW + 10_000);
  assert.equal(acknowledged.state(NOW + 60_000), 'ACKNOWLEDGED');
});

test('severity cannot be downgraded without explicit human approval', () => {
  assert.throws(() => assertSeverityChangeAllowed('S4', 'S2', false), /unauthorized severity downgrade/);
  assert.doesNotThrow(() => assertSeverityChangeAllowed('S4', 'S2', true));
  assert.doesNotThrow(() => assertSeverityChangeAllowed('S2', 'S3', false));
});

test('road reopening requires human safety resolution, supervisor authorization and preserved evidence', () => {
  assert.throws(() => assertRoadMayClose({
    humanSafetyResolved: false,
    severity: 'S3',
    supervisorAuthorized: true,
    dependenciesHealthy: true,
    evidencePreserved: true
  }), /human safety unresolved/);
  assert.throws(() => assertRoadMayClose({
    humanSafetyResolved: true,
    severity: 'S3',
    supervisorAuthorized: false,
    dependenciesHealthy: true,
    evidencePreserved: true
  }), /supervisor authorization required/);
  assert.throws(() => assertRoadMayClose({
    humanSafetyResolved: true,
    severity: 'S3',
    supervisorAuthorized: true,
    dependenciesHealthy: false,
    evidencePreserved: true
  }), /critical dependency unavailable/);
  assert.throws(() => assertRoadMayClose({
    humanSafetyResolved: true,
    severity: 'S3',
    supervisorAuthorized: true,
    dependenciesHealthy: true,
    evidencePreserved: false
  }), /evidence not preserved/);
  assert.doesNotThrow(() => assertRoadMayClose({
    humanSafetyResolved: true,
    severity: 'S3',
    supervisorAuthorized: true,
    dependenciesHealthy: true,
    evidencePreserved: true
  }));
});
