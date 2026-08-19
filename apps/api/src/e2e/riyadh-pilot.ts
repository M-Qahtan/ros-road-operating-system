import { performance } from 'node:perf_hooks';
import { RoadEventStatus, SeverityLevel } from '@ros/domain';
import {
  MemoryIdempotencyAdapter,
  MemoryRoadEventRepository,
  MemorySignalAttachmentAdapter,
  RoleMatrixAuthorizationAdapter
} from '../application/local-adapters.js';
import { RoadEventApplicationService } from '../application/road-event-application.js';

const EVENT_ID = '90000000-0000-4000-8000-000000000001';
const OTHER_EVENT_ID = '90000000-0000-4000-8000-000000000002';
const OPERATOR_ID = '90000000-0000-4000-8000-000000000010';
const SUPERVISOR_ID = '90000000-0000-4000-8000-000000000011';
const SIGNAL_A = '90000000-0000-4000-8000-000000000101';
const SIGNAL_B = '90000000-0000-4000-8000-000000000102';
const TENANT_ID = 'riyadh-pilot';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';

interface Notification { readonly key: string; readonly agency: 'AMBULANCE_SIM' | 'TRAFFIC_SIM' | 'TOWING_SIM'; readonly traceId: string; }
interface EvidenceRecord { readonly id: string; readonly roadEventId: string; readonly checksum: string; readonly status: 'AVAILABLE' | 'QUARANTINED'; }

class DeterministicOutbox {
  private readonly delivered = new Map<string, Notification>();
  private failuresRemaining = 1;
  publish(notification: Notification): void {
    if (this.delivered.has(notification.key)) return;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('injected redis outage');
    }
    this.delivered.set(notification.key, notification);
  }
  retry(notification: Notification): void { this.publish(notification); }
  values(): readonly Notification[] { return [...this.delivered.values()]; }
}

class DeterministicEvidenceStore {
  private readonly records = new Map<string, EvidenceRecord>();
  complete(record: EvidenceRecord): void { this.records.set(record.id, record); }
  getForEvent(id: string, roadEventId: string): EvidenceRecord {
    const record = this.records.get(id);
    if (record === undefined || record.roadEventId !== roadEventId) throw new Error('cross-event evidence access denied');
    if (record.status === 'QUARANTINED') throw new Error('evidence quarantined');
    return record;
  }
}

export interface RiyadhPilotResult {
  readonly roadEventId: string;
  readonly finalStatus: RoadEventStatus;
  readonly finalVersion: number;
  readonly attachedSignals: number;
  readonly notifications: number;
  readonly evidenceVerified: boolean;
  readonly closureBypassRejected: boolean;
  readonly duplicateCreateStable: boolean;
  readonly duplicateSignalStable: boolean;
  readonly recoverySucceeded: boolean;
  readonly auditActions: readonly string[];
  readonly dashboard: { readonly status: RoadEventStatus; readonly severity: SeverityLevel; readonly stale: false };
  readonly performanceMs: { readonly create: number; readonly list: number; readonly detail: number };
}

export async function runRiyadhPilotSimulation(): Promise<RiyadhPilotResult> {
  const repository = new MemoryRoadEventRepository();
  const signals = new MemorySignalAttachmentAdapter();
  const service = new RoadEventApplicationService(
    repository,
    new RoleMatrixAuthorizationAdapter(),
    new MemoryIdempotencyAdapter(),
    signals,
    repository
  );
  const operator = { actorId: OPERATOR_ID, roles: ['OPERATOR'] as const, tenantId: TENANT_ID, purpose: PURPOSE };
  const supervisor = { actorId: SUPERVISOR_ID, roles: ['SUPERVISOR'] as const, tenantId: TENANT_ID, purpose: PURPOSE };
  const baseContext = { actor: operator, traceId: 'riyadh-pilot-trace', idempotencyKey: 'pilot-create-0001' };

  const createStarted = performance.now();
  const created = await service.create({
    id: EVENT_ID,
    occurredAt: '2026-07-25T10:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  }, baseContext);
  const createMs = performance.now() - createStarted;
  const duplicate = await service.create({
    id: EVENT_ID,
    occurredAt: '2026-07-25T10:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  }, baseContext);

  for (const [signalId, key] of [[SIGNAL_A, 'pilot-signal-a'], [SIGNAL_B, 'pilot-signal-b'], [SIGNAL_A, 'pilot-signal-a']] as const) {
    await service.attachSignal({ roadEventId: EVENT_ID, signalId, matchScore: 0.96, mergeReasons: ['same_location', 'same_time_window'] }, {
      actor: operator, traceId: 'riyadh-pilot-trace', idempotencyKey: key
    });
  }

  let current = await service.reassessSeverity({
    roadEventId: EVENT_ID,
    expectedVersion: created.version,
    assessment: { level: SeverityLevel.High, score: 78, confidence: 0.94, reasonCodes: ['occupant_unresponsive', 'multi_signal_confirmation'], requiresHumanReview: true },
    reason: 'Human-safety indicators require S3 escalation'
  }, { actor: operator, traceId: 'riyadh-pilot-trace', idempotencyKey: 'pilot-severity-0001' });

  for (const nextStatus of [
    RoadEventStatus.Validating,
    RoadEventStatus.Confirmed,
    RoadEventStatus.SafetyAssessment,
    RoadEventStatus.ResponseCoordination,
    RoadEventStatus.RoadClearance,
    RoadEventStatus.Recovery
  ]) {
    current = await service.transition({ roadEventId: EVENT_ID, expectedVersion: current.version, nextStatus, reason: `Pilot transition to ${nextStatus}` }, {
      actor: operator, traceId: 'riyadh-pilot-trace', idempotencyKey: `pilot-transition-${nextStatus}`
    });
  }

  const outbox = new DeterministicOutbox();
  const notification: Notification = { key: `${EVENT_ID}:S3:agencies`, agency: 'AMBULANCE_SIM', traceId: 'riyadh-pilot-trace' };
  let recoverySucceeded = false;
  try { outbox.publish(notification); } catch { outbox.retry(notification); recoverySucceeded = true; }
  outbox.retry(notification);
  outbox.publish({ key: `${EVENT_ID}:traffic`, agency: 'TRAFFIC_SIM', traceId: 'riyadh-pilot-trace' });
  outbox.publish({ key: `${EVENT_ID}:towing`, agency: 'TOWING_SIM', traceId: 'riyadh-pilot-trace' });

  const evidence = new DeterministicEvidenceStore();
  evidence.complete({ id: 'evidence-001', roadEventId: EVENT_ID, checksum: 'a'.repeat(64), status: 'AVAILABLE' });
  const evidenceVerified = evidence.getForEvent('evidence-001', EVENT_ID).checksum.length === 64;
  let crossEventRejected = false;
  try { evidence.getForEvent('evidence-001', OTHER_EVENT_ID); } catch { crossEventRejected = true; }
  if (!crossEventRejected) throw new Error('cross-event evidence access was not rejected');

  let closureBypassRejected = false;
  try {
    await service.transition({ roadEventId: EVENT_ID, expectedVersion: current.version, nextStatus: RoadEventStatus.Closed, reason: 'unauthorized close attempt' }, {
      actor: operator, traceId: 'riyadh-pilot-trace', idempotencyKey: 'pilot-close-bypass'
    });
  } catch { closureBypassRejected = true; }

  current = await service.authorizeClosure({
    roadEventId: EVENT_ID,
    expectedVersion: current.version,
    reason: 'Supervisor verified people safe, agencies simulated, evidence preserved and road restored',
    authorizedAt: '2026-07-25T10:20:00.000Z'
  }, { actor: supervisor, traceId: 'riyadh-pilot-trace', idempotencyKey: 'pilot-authorize-close' });
  current = await service.transition({ roadEventId: EVENT_ID, expectedVersion: current.version, nextStatus: RoadEventStatus.Closed, reason: 'Pilot scenario safely completed' }, {
    actor: supervisor, traceId: 'riyadh-pilot-trace', idempotencyKey: 'pilot-close-authorized'
  });

  const listStarted = performance.now();
  const page = await service.list({ limit: 20, offset: 0 }, supervisor);
  const listMs = performance.now() - listStarted;
  const detailStarted = performance.now();
  const detail = await service.getById(EVENT_ID, supervisor);
  const detailMs = performance.now() - detailStarted;
  const timeline = await service.timeline(EVENT_ID, supervisor);

  if (page.total !== 1 || detail.status !== RoadEventStatus.Closed) throw new Error('dashboard read model did not reach final state');
  return {
    roadEventId: EVENT_ID,
    finalStatus: current.status as RoadEventStatus,
    finalVersion: current.version,
    attachedSignals: signals.attachments.length,
    notifications: outbox.values().length,
    evidenceVerified,
    closureBypassRejected,
    duplicateCreateStable: duplicate.id === created.id && duplicate.version === created.version,
    duplicateSignalStable: signals.attachments.length === 2,
    recoverySucceeded,
    auditActions: timeline.map((entry) => entry.action),
    dashboard: { status: detail.status as RoadEventStatus, severity: detail.severity.level as SeverityLevel, stale: false },
    performanceMs: { create: createMs, list: listMs, detail: detailMs }
  };
}
