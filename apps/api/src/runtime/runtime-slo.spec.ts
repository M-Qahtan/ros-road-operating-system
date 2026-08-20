import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRuntimeSlo, proposedRuntimeSloThresholds } from './runtime-slo.js';

const healthy = {
  outboxBacklog: 0,
  oldestOutboxAgeSeconds: 0,
  deadLetterCount: 0,
  strandedIdempotencyReservations: 0,
  postgresPoolUtilization: 0.25,
  postgresReady: true,
  redisReady: true
} as const;

test('healthy runtime snapshot emits no alerts', () => {
  assert.deepEqual(evaluateRuntimeSlo(healthy), []);
});

test('safety-relevant dependency, dead-letter and reconciliation conditions page immediately', () => {
  const alerts = evaluateRuntimeSlo({
    ...healthy,
    postgresReady: false,
    deadLetterCount: 1,
    strandedIdempotencyReservations: 2
  });
  assert.deepEqual(alerts.map((alert) => [alert.severity, alert.code]), [
    ['page', 'dependency_not_ready'],
    ['page', 'dead_letter_present'],
    ['page', 'idempotency_reconciliation_required']
  ]);
});

test('capacity and latency pressure use warning thresholds', () => {
  const alerts = evaluateRuntimeSlo({
    ...healthy,
    outboxBacklog: proposedRuntimeSloThresholds.maximumOutboxBacklog + 1,
    oldestOutboxAgeSeconds: proposedRuntimeSloThresholds.maximumOldestOutboxAgeSeconds + 1,
    postgresPoolUtilization: 0.81
  });
  assert.deepEqual(alerts.map((alert) => [alert.severity, alert.code]), [
    ['warning', 'outbox_backlog_high'],
    ['warning', 'outbox_age_high'],
    ['warning', 'postgres_pool_pressure']
  ]);
});

test('invalid telemetry is rejected rather than normalized into a misleading healthy state', () => {
  assert.throws(() => evaluateRuntimeSlo({ ...healthy, outboxBacklog: -1 }), /non-negative/);
  assert.throws(() => evaluateRuntimeSlo({ ...healthy, postgresPoolUtilization: 1.1 }), /between 0 and 1/);
});
