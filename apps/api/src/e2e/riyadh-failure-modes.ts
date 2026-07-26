import { createHash } from 'node:crypto';

export type Dependency = 'POSTGRESQL' | 'REDIS' | 'OBJECT_STORAGE' | 'NETWORK';
export type SafeState = 'HUMAN_REVIEW_REQUIRED' | 'ESCALATED' | 'QUARANTINED' | 'RETRY_PENDING' | 'BLOCKED';

export interface SignalCandidate {
  readonly id: string;
  readonly confidence: number;
  readonly occurredAtMs: number;
  readonly direction: 'INCIDENT' | 'NO_INCIDENT';
}

export interface SignalDecision {
  readonly accepted: readonly SignalCandidate[];
  readonly rejected: readonly SignalCandidate[];
  readonly state: SafeState;
  readonly reason: string;
}

export class DeterministicSignalFusionGate {
  constructor(
    private readonly minimumConfidence = 0.75,
    private readonly maximumLatenessMs = 120_000
  ) {}

  evaluate(signals: readonly SignalCandidate[], nowMs: number): SignalDecision {
    const late = signals.filter((signal) => nowMs - signal.occurredAtMs > this.maximumLatenessMs);
    const current = signals.filter((signal) => nowMs - signal.occurredAtMs <= this.maximumLatenessMs);
    const lowConfidence = current.filter((signal) => signal.confidence < this.minimumConfidence);
    const eligible = current.filter((signal) => signal.confidence >= this.minimumConfidence);
    const directions = new Set(eligible.map((signal) => signal.direction));

    if (directions.size > 1) {
      return {
        accepted: [],
        rejected: [...signals],
        state: 'HUMAN_REVIEW_REQUIRED',
        reason: 'conflicting_high_confidence_signals'
      };
    }

    if (eligible.length === 0) {
      return {
        accepted: [],
        rejected: [...signals],
        state: 'HUMAN_REVIEW_REQUIRED',
        reason: late.length > 0 ? 'late_or_low_confidence_signals' : 'low_confidence_signals'
      };
    }

    return {
      accepted: eligible,
      rejected: [...lowConfidence, ...late],
      state: late.length > 0 ? 'HUMAN_REVIEW_REQUIRED' : 'ESCALATED',
      reason: late.length > 0 ? 'late_signal_requires_revalidation' : 'corroborated_signal'
    };
  }
}

export interface Delivery {
  readonly key: string;
  readonly sequence: number;
  readonly payload: string;
}

export class DeterministicDeliveryGuard {
  private readonly delivered = new Map<string, Delivery>();
  private readonly attempts = new Map<string, number>();

  deliver(delivery: Delivery): 'DELIVERED' | 'DUPLICATE_IGNORED' | 'OUT_OF_ORDER_BLOCKED' {
    const attempts = (this.attempts.get(delivery.key) ?? 0) + 1;
    this.attempts.set(delivery.key, attempts);
    const previous = this.delivered.get(delivery.key);
    if (previous !== undefined) {
      if (previous.payload === delivery.payload && previous.sequence === delivery.sequence) return 'DUPLICATE_IGNORED';
      if (delivery.sequence <= previous.sequence) return 'OUT_OF_ORDER_BLOCKED';
    }
    this.delivered.set(delivery.key, delivery);
    return 'DELIVERED';
  }

  attemptCount(key: string): number { return this.attempts.get(key) ?? 0; }
  deliveredCount(): number { return this.delivered.size; }
}

export class DependencySafetyGate {
  private readonly unavailable = new Set<Dependency>();

  fail(dependency: Dependency): void { this.unavailable.add(dependency); }
  recover(dependency: Dependency): void { this.unavailable.delete(dependency); }

  assertSafeFor(operation: 'CREATE_EVENT' | 'PUBLISH_NOTIFICATION' | 'COMPLETE_EVIDENCE' | 'CLOSE_EVENT'): void {
    const required: Readonly<Record<typeof operation, readonly Dependency[]>> = {
      CREATE_EVENT: ['POSTGRESQL'],
      PUBLISH_NOTIFICATION: ['REDIS', 'NETWORK'],
      COMPLETE_EVIDENCE: ['OBJECT_STORAGE', 'NETWORK'],
      CLOSE_EVENT: ['POSTGRESQL', 'REDIS', 'OBJECT_STORAGE', 'NETWORK']
    };
    const missing = required[operation].filter((dependency) => this.unavailable.has(dependency));
    if (missing.length > 0) throw new Error(`safe degradation blocked ${operation}: ${missing.join(',')}`);
  }
}

export interface EvidenceArtifact {
  readonly id: string;
  readonly roadEventId: string;
  readonly expectedChecksum: string;
  readonly content: string;
  readonly scan: 'CLEAN' | 'MALICIOUS' | 'SCANNER_ERROR';
}

export class DeterministicEvidenceGuard {
  private readonly records = new Map<string, EvidenceArtifact & { readonly status: 'AVAILABLE' | 'QUARANTINED' }>();

  complete(artifact: EvidenceArtifact): 'AVAILABLE' | 'QUARANTINED' {
    const actual = createHash('sha256').update(artifact.content).digest('hex');
    const status = actual === artifact.expectedChecksum && artifact.scan === 'CLEAN' ? 'AVAILABLE' : 'QUARANTINED';
    this.records.set(artifact.id, { ...artifact, status });
    return status;
  }

  read(id: string, roadEventId: string): EvidenceArtifact {
    const record = this.records.get(id);
    if (record === undefined) throw new Error('evidence missing');
    if (record.roadEventId !== roadEventId) throw new Error('cross-event evidence access denied');
    if (record.status === 'QUARANTINED') throw new Error('evidence quarantined');
    return record;
  }
}

export class HumanSafetyDeadline {
  private acknowledgedAtMs?: number;

  constructor(
    private readonly detectedAtMs: number,
    private readonly escalationDeadlineMs: number
  ) {}

  acknowledge(atMs: number): void { this.acknowledgedAtMs = atMs; }

  state(nowMs: number): 'WAITING' | 'ACKNOWLEDGED' | 'ESCALATED' {
    if (this.acknowledgedAtMs !== undefined && this.acknowledgedAtMs <= this.detectedAtMs + this.escalationDeadlineMs) {
      return 'ACKNOWLEDGED';
    }
    return nowMs >= this.detectedAtMs + this.escalationDeadlineMs ? 'ESCALATED' : 'WAITING';
  }
}

export interface SafetyEvidence {
  readonly humanSafetyResolved: boolean;
  readonly severity: 'S1' | 'S2' | 'S3' | 'S4';
  readonly supervisorAuthorized: boolean;
  readonly dependenciesHealthy: boolean;
  readonly evidencePreserved: boolean;
}

export function assertRoadMayClose(evidence: SafetyEvidence): void {
  if (!evidence.humanSafetyResolved) throw new Error('human safety unresolved');
  if ((evidence.severity === 'S3' || evidence.severity === 'S4') && !evidence.supervisorAuthorized) {
    throw new Error('supervisor authorization required');
  }
  if (!evidence.dependenciesHealthy) throw new Error('critical dependency unavailable');
  if (!evidence.evidencePreserved) throw new Error('evidence not preserved');
}

export function assertSeverityChangeAllowed(current: 'S1' | 'S2' | 'S3' | 'S4', next: 'S1' | 'S2' | 'S3' | 'S4', humanApproved: boolean): void {
  const rank = { S1: 1, S2: 2, S3: 3, S4: 4 } as const;
  if (rank[next] < rank[current] && !humanApproved) throw new Error('unauthorized severity downgrade');
}
