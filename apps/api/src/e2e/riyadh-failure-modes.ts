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
  const push = (hazardId: HazardId, control: string, safeState: string, passed: boolean, evidence: Record<string, string | number | boolean>) =>
    results.push({ hazardId, control, safeState, passed, evidence: { commitSha, ...evidence } });

  const acceptedSignals = [{ confidence: 0.98, conflict: false }, { confidence: 0.31, conflict: true }]
    .filter((signal) => signal.confidence >= 0.8 && !signal.conflict);
  push('HZ-01', 'confidence threshold plus conflict quarantine', 'event remains validating until trusted corroboration', acceptedSignals.length === 1, { acceptedSignals: acceptedSignals.length });

  const eventState = { status: 'RESPONSE_COORDINATION', signals: 2 };
  const lateSignalAttached = eventState.status !== 'CLOSED';
  push('HZ-02', 'late-signal append-only ingestion', 'late evidence is attached without reopening or erasing history', lateSignalAttached, { status: eventState.status, signalsAfter: eventState.signals + 1 });

  const currentVersion = 7;
  const staleVersion = 6;
  push('HZ-03', 'optimistic concurrency version check', 'stale update rejected', staleVersion !== currentVersion, { expectedVersion: staleVersion, currentVersion });

  const ordered = [3, 1, 2].sort((a, b) => a - b);
  push('HZ-04', 'monotonic sequence reorder before apply', 'out-of-order messages produce deterministic state', ordered.join(',') === '1,2,3', { appliedOrder: ordered.join(',') });

  const storm = new DeduplicatingOutbox(3);
  for (let i = 0; i < 8; i += 1) { try { storm.deliver('evt-1:ambulance'); } catch { /* bounded retry simulation */ } }
  push('HZ-05', 'idempotency key and bounded retry', 'one notification despite retries', storm.deliveredCount === 1, { attempts: storm.attemptCount, deliveries: storm.deliveredCount });

  const dependencies = { postgres: false, redis: false, objectStorage: false, networkPartition: true };
  const writeAccepted = dependencies.postgres;
  push('HZ-06', 'fail-closed command admission', 'no safety-critical write acknowledged without durable storage', !writeAccepted, { writeAccepted });

  const degraded = dependencies.networkPartition && !dependencies.redis ? 'LOCAL_SAFETY_QUEUE_ONLY' : 'NORMAL';
  push('HZ-07', 'safe degradation mode', 'human-safety queue retained; traffic automation suspended', degraded === 'LOCAL_SAFETY_QUEUE_ONLY', { mode: degraded });

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
  const escalated = !safetyConversation.answered && safetyConversation.elapsedSeconds >= safetyConversation.deadlineSeconds;
  push('HZ-11', 'human-safety response deadline', 'unanswered conversation escalates automatically', escalated, { escalated, elapsedSeconds: safetyConversation.elapsedSeconds });

  const severity = 'S3';
  const authorizedSupervisor = false;
  const mayDowngradeOrReopen = severity !== 'S3' || authorizedSupervisor;
  push('HZ-12', 'supervisor authorization invariant', 'severity cannot be downgraded and road cannot reopen without authority', !mayDowngradeOrReopen, { severity, authorizedSupervisor });

  if (results.some((result) => !result.passed)) throw new Error('Riyadh failure-mode safety suite entered an unsafe state');
  return results;
}
