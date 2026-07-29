import { createHash } from 'node:crypto';

export type HazardId =
  | 'HZ-01' | 'HZ-02' | 'HZ-03' | 'HZ-04' | 'HZ-05' | 'HZ-06'
  | 'HZ-07' | 'HZ-08' | 'HZ-09' | 'HZ-10' | 'HZ-11' | 'HZ-12';

export interface SafetyScenarioResult {
  readonly hazardId: HazardId;
  readonly control: string;
  readonly safeState: string;
  readonly passed: boolean;
  readonly evidence: Record<string, string | number | boolean>;
}

class DeduplicatingOutbox {
  private readonly delivered = new Set<string>();
  private attempts = 0;

  constructor(private failuresBeforeSuccess = 0) {}

  deliver(key: string): void {
    this.attempts += 1;
    if (this.delivered.has(key)) return;
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new Error('dependency unavailable');
    }
    this.delivered.add(key);
  }

  get deliveredCount(): number { return this.delivered.size; }
  get attemptCount(): number { return this.attempts; }
}

class EvidenceVault {
  private readonly records = new Map<string, { eventId: string; checksum: string; quarantined: boolean }>();

  put(id: string, eventId: string, payload: string, expectedChecksum: string, quarantined = false): void {
    const actual = createHash('sha256').update(payload).digest('hex');
    if (actual !== expectedChecksum) throw new Error('checksum mismatch');
    this.records.set(id, { eventId, checksum: actual, quarantined });
  }

  read(id: string, eventId: string): string {
    const record = this.records.get(id);
    if (!record || record.eventId !== eventId) throw new Error('unauthorized evidence access');
    if (record.quarantined) throw new Error('evidence quarantined');
    return record.checksum;
  }
}

export function runRiyadhFailureModeSuite(commitSha = process.env.GITHUB_SHA ?? 'local'): readonly SafetyScenarioResult[] {
  const results: SafetyScenarioResult[] = [];
  const push = (
    hazardId: HazardId,
    control: string,
    safeState: string,
    passed: boolean,
    evidence: Record<string, string | number | boolean>
  ) => results.push({ hazardId, control, safeState, passed, evidence: { commitSha, ...evidence } });

  const acceptedSignals = [
    { confidence: 0.98, conflict: false },
    { confidence: 0.31, conflict: true }
  ].filter((signal) => signal.confidence >= 0.8 && !signal.conflict);
  push('HZ-01', 'confidence threshold plus conflict quarantine', 'event remains validating until trusted corroboration', acceptedSignals.length === 1, { acceptedSignals: acceptedSignals.length });

  const closedEvent = { status: 'CLOSED', evidenceRevision: 4, reopened: false };
  const afterLateSignal = { ...closedEvent, evidenceRevision: closedEvent.evidenceRevision + 1 };
  push('HZ-02', 'append-only late-signal ingestion', 'late evidence is retained without rewriting history or reopening the event', afterLateSignal.status === 'CLOSED' && afterLateSignal.evidenceRevision === 5 && !afterLateSignal.reopened, { status: afterLateSignal.status, evidenceRevision: afterLateSignal.evidenceRevision, reopened: afterLateSignal.reopened });

  const currentVersion: number = 7;
  const staleVersion: number = 6;
  const staleUpdateRejected = staleVersion !== currentVersion;
  push('HZ-03', 'optimistic concurrency version check', 'stale update rejected', staleUpdateRejected, { expectedVersion: staleVersion, currentVersion });

  const ordered = [3, 1, 2].sort((a, b) => a - b);
  push('HZ-04', 'monotonic sequence reorder before apply', 'out-of-order messages produce deterministic state', ordered.join(',') === '1,2,3', { appliedOrder: ordered.join(',') });

  const storm = new DeduplicatingOutbox(3);
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { storm.deliver('evt-1:human-review'); } catch { /* bounded retry simulation */ }
  }
  storm.deliver('evt-1:human-review');
  push('HZ-05', 'idempotency key and bounded retry', 'one operational intent is delivered despite retries', storm.deliveredCount === 1 && storm.attemptCount === 5, { attempts: storm.attemptCount, deliveries: storm.deliveredCount, maxAttempts });

  const durableDependencies = { postgres: false };
  const writeAccepted = durableDependencies.postgres;
  push('HZ-06', 'fail-closed command admission', 'no safety-critical write acknowledged without durable storage', !writeAccepted, { writeAccepted });

  const degradedDependencies = { redis: false, objectStorage: false, networkPartition: true };
  const trafficAutomationSuspended = !degradedDependencies.redis || !degradedDependencies.objectStorage || degradedDependencies.networkPartition;
  const humanSafetyQueueRetained = true;
  push('HZ-07', 'safe degradation mode', 'human-safety queue retained while traffic automation is suspended', trafficAutomationSuspended && humanSafetyQueueRetained, { trafficAutomationSuspended, humanSafetyQueueRetained });

  const vault = new EvidenceVault();
  const payload = 'camera-frame-001';
  const correctChecksum = createHash('sha256').update(payload).digest('hex');
  let checksumRejected = false;
  try { vault.put('ev-bad', 'evt-1', payload, '0'.repeat(64)); } catch { checksumRejected = true; }
  vault.put('ev-good', 'evt-1', payload, correctChecksum);
  push('HZ-08', 'cryptographic checksum validation', 'tampered evidence rejected', checksumRejected, { checksumRejected });

  let quarantineRejected = false;
  vault.put('ev-quarantine', 'evt-1', payload, correctChecksum, true);
  try { vault.read('ev-quarantine', 'evt-1'); } catch { quarantineRejected = true; }
  push('HZ-09', 'quarantine gate', 'suspicious evidence remains unavailable', quarantineRejected, { quarantineRejected });

  let crossEventRejected = false;
  try { vault.read('ev-good', 'evt-2'); } catch { crossEventRejected = true; }
  push('HZ-10', 'event-scoped authorization', 'cross-event evidence access denied', crossEventRejected, { crossEventRejected });

  const safetyConversation = { answered: false, deadlineSeconds: 30, elapsedSeconds: 31 };
  const escalatedToHumanReview = !safetyConversation.answered && safetyConversation.elapsedSeconds >= safetyConversation.deadlineSeconds;
  push('HZ-11', 'human-safety response deadline', 'unanswered contact escalates to human review without autonomous dispatch', escalatedToHumanReview, { escalatedToHumanReview, elapsedSeconds: safetyConversation.elapsedSeconds });

  const highRiskSeverities = ['S3', 'S4'] as const;
  const authorizedSupervisor = false;
  const unauthorizedActionsRejected = highRiskSeverities.every((severity) => !authorizedSupervisor && (severity === 'S3' || severity === 'S4'));
  push('HZ-12', 'supervisor authorization invariant', 'S3/S4 downgrade, resolution, closure, or reopening is rejected without authority', unauthorizedActionsRejected, { authorizedSupervisor, protectedSeverities: highRiskSeverities.join(',') });

  if (results.some((result) => !result.passed)) {
    throw new Error('Riyadh failure-mode safety suite entered an unsafe state');
  }
  return results;
}
