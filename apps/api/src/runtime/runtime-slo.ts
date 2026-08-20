export interface RuntimeSliSnapshot {
  readonly outboxBacklog: number;
  readonly oldestOutboxAgeSeconds: number;
  readonly deadLetterCount: number;
  readonly strandedIdempotencyReservations: number;
  readonly postgresPoolUtilization: number;
  readonly postgresReady: boolean;
  readonly redisReady: boolean;
}

export interface RuntimeSloThresholds {
  readonly maximumOutboxBacklog: number;
  readonly maximumOldestOutboxAgeSeconds: number;
  readonly maximumPostgresPoolUtilization: number;
}

export type RuntimeAlertSeverity = 'warning' | 'page';

export interface RuntimeAlert {
  readonly severity: RuntimeAlertSeverity;
  readonly code:
    | 'dependency_not_ready'
    | 'dead_letter_present'
    | 'idempotency_reconciliation_required'
    | 'outbox_backlog_high'
    | 'outbox_age_high'
    | 'postgres_pool_pressure';
  readonly observed: number | boolean;
  readonly threshold?: number;
}

/**
 * Engineering defaults for controlled staging/pilot preparation only.
 * They are intentionally not labelled as approved production policy.
 */
export const proposedRuntimeSloThresholds: RuntimeSloThresholds = Object.freeze({
  maximumOutboxBacklog: 1_000,
  maximumOldestOutboxAgeSeconds: 60,
  maximumPostgresPoolUtilization: 0.8
});

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer`);
  return value;
}

function nonNegativeFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${field} must be a non-negative finite number`);
  return value;
}

function utilization(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('postgresPoolUtilization must be between 0 and 1');
  }
  return value;
}

export function evaluateRuntimeSlo(
  snapshot: RuntimeSliSnapshot,
  thresholds: RuntimeSloThresholds = proposedRuntimeSloThresholds
): readonly RuntimeAlert[] {
  const outboxBacklog = nonNegativeInteger(snapshot.outboxBacklog, 'outboxBacklog');
  const oldestOutboxAgeSeconds = nonNegativeFinite(snapshot.oldestOutboxAgeSeconds, 'oldestOutboxAgeSeconds');
  const deadLetterCount = nonNegativeInteger(snapshot.deadLetterCount, 'deadLetterCount');
  const strandedReservations = nonNegativeInteger(
    snapshot.strandedIdempotencyReservations,
    'strandedIdempotencyReservations'
  );
  const poolUtilization = utilization(snapshot.postgresPoolUtilization);
  const maximumOutboxBacklog = nonNegativeInteger(thresholds.maximumOutboxBacklog, 'maximumOutboxBacklog');
  const maximumOldestOutboxAgeSeconds = nonNegativeFinite(
    thresholds.maximumOldestOutboxAgeSeconds,
    'maximumOldestOutboxAgeSeconds'
  );
  const maximumPostgresPoolUtilization = utilization(thresholds.maximumPostgresPoolUtilization);

  const alerts: RuntimeAlert[] = [];
  if (!snapshot.postgresReady || !snapshot.redisReady) {
    alerts.push({ severity: 'page', code: 'dependency_not_ready', observed: false });
  }
  if (deadLetterCount > 0) {
    alerts.push({ severity: 'page', code: 'dead_letter_present', observed: deadLetterCount, threshold: 0 });
  }
  if (strandedReservations > 0) {
    alerts.push({
      severity: 'page',
      code: 'idempotency_reconciliation_required',
      observed: strandedReservations,
      threshold: 0
    });
  }
  if (outboxBacklog > maximumOutboxBacklog) {
    alerts.push({
      severity: 'warning',
      code: 'outbox_backlog_high',
      observed: outboxBacklog,
      threshold: maximumOutboxBacklog
    });
  }
  if (oldestOutboxAgeSeconds > maximumOldestOutboxAgeSeconds) {
    alerts.push({
      severity: 'warning',
      code: 'outbox_age_high',
      observed: oldestOutboxAgeSeconds,
      threshold: maximumOldestOutboxAgeSeconds
    });
  }
  if (poolUtilization > maximumPostgresPoolUtilization) {
    alerts.push({
      severity: 'warning',
      code: 'postgres_pool_pressure',
      observed: poolUtilization,
      threshold: maximumPostgresPoolUtilization
    });
  }
  return alerts;
}
