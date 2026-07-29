import { createHash } from 'node:crypto';
import {
  type HumanSafetySignalEnvelope,
  type ReplayNonceConsumeRequest,
  type ReplayNonceRegistryPort,
  type ReplayTokenDigesterPort
} from '@ros/contracts';
import {
  type AcceptedSignalProvenance,
  type IdFactoryPort,
  type ProvenanceStorePort,
  type QuarantineStorePort,
  type RawEvidenceStorePort,
  type SafetyIntentRecord,
  type SafetyIntentStorePort,
  type SignalQuarantineRecord,
  type SourceRateLimitPort,
  type SourceTrustRegistryPort,
  type SourceTrustState
} from './signal-ingestion.js';

export class Sha256DigesterAdapter implements ReplayTokenDigesterPort, IdFactoryPort {
  async digest(value: string): Promise<string> {
    return createHash('sha256').update(value).digest('hex');
  }

  async create(namespace: string, material: string): Promise<string> {
    return `${namespace}-${(await this.digest(`${namespace}|${material}`)).slice(0, 32)}`;
  }
}

export class AtomicInMemoryReplayNonceRegistry implements ReplayNonceRegistryPort {
  private readonly consumed = new Map<string, { readonly scopeDigest: string; readonly expiresAtMs: number }>();
  unavailable = false;

  async consume(request: ReplayNonceConsumeRequest) {
    if (this.unavailable) return 'UNAVAILABLE' as const;
    const expiresAtMs = Date.parse(request.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return 'EXPIRED' as const;
    const existing = this.consumed.get(request.nonceDigest);
    if (existing !== undefined) return 'DUPLICATE' as const;
    this.consumed.set(request.nonceDigest, { scopeDigest: request.scopeDigest, expiresAtMs });
    return 'CONSUMED' as const;
  }

  snapshot(): ReadonlyArray<{ readonly nonceDigest: string; readonly scopeDigest: string; readonly expiresAtMs: number }> {
    return [...this.consumed.entries()].map(([nonceDigest, value]) => ({ nonceDigest, ...value }));
  }
}

export class InMemorySourceTrustRegistry implements SourceTrustRegistryPort {
  private readonly states = new Map<string, SourceTrustState>();
  unavailable = false;

  set(sourceId: string, state: SourceTrustState): void { this.states.set(sourceId, state); }

  async getTrustState(sourceId: string): Promise<SourceTrustState> {
    if (this.unavailable) throw new Error('source registry unavailable');
    return this.states.get(sourceId) ?? 'UNKNOWN';
  }
}

export class FixedWindowSourceRateLimiter implements SourceRateLimitPort {
  private readonly counters = new Map<string, { window: number; count: number }>();
  unavailable = false;

  constructor(private readonly maximumPerWindow: number, private readonly windowMs: number) {
    if (!Number.isInteger(maximumPerWindow) || maximumPerWindow < 1) throw new Error('maximumPerWindow must be positive');
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error('windowMs must be positive');
  }

  async consume(sourceId: string, evaluatedAt: string) {
    if (this.unavailable) return 'UNAVAILABLE' as const;
    const timestamp = Date.parse(evaluatedAt);
    if (!Number.isFinite(timestamp)) return 'UNAVAILABLE' as const;
    const window = Math.floor(timestamp / this.windowMs);
    const current = this.counters.get(sourceId);
    if (current === undefined || current.window !== window) {
      this.counters.set(sourceId, { window, count: 1 });
      return 'ALLOWED' as const;
    }
    if (current.count >= this.maximumPerWindow) return 'LIMITED' as const;
    current.count += 1;
    return 'ALLOWED' as const;
  }
}

export class InMemoryProvenanceStore implements ProvenanceStorePort {
  readonly records: AcceptedSignalProvenance[] = [];
  unavailable = false;
  async append(record: AcceptedSignalProvenance): Promise<void> {
    if (this.unavailable) throw new Error('provenance store unavailable');
    this.records.push(record);
  }
}

export class InMemoryQuarantineStore implements QuarantineStorePort {
  readonly records: SignalQuarantineRecord[] = [];
  unavailable = false;
  async append(record: SignalQuarantineRecord): Promise<void> {
    if (this.unavailable) throw new Error('quarantine store unavailable');
    this.records.push(record);
  }
}

export class InMemoryRawEvidenceStore implements RawEvidenceStorePort {
  readonly objects = new Map<string, { readonly mediaType: string; readonly size: number }>();
  unavailable = false;
  async put(input: { readonly signalId: string; readonly mediaType: string; readonly bytes: Uint8Array }): Promise<string> {
    if (this.unavailable) throw new Error('raw evidence store unavailable');
    const digest = createHash('sha256').update(input.bytes).digest('hex');
    const ref = `raw-evidence/${input.signalId}/${digest}`;
    this.objects.set(ref, { mediaType: input.mediaType, size: input.bytes.byteLength });
    return ref;
  }
}

export class InMemorySafetyIntentStore implements SafetyIntentStorePort {
  readonly records = new Map<string, SafetyIntentRecord>();
  async createIfAbsent(record: SafetyIntentRecord): Promise<'CREATED' | 'ALREADY_EXISTS'> {
    if (this.records.has(record.signalId)) return 'ALREADY_EXISTS';
    this.records.set(record.signalId, record);
    return 'CREATED';
  }
}

export function phoneMotionSimulator(overrides: Partial<HumanSafetySignalEnvelope> = {}): HumanSafetySignalEnvelope {
  return {
    signalId: 'signal-phone-001',
    schemaVersion: 'ros-eye.signal.v1',
    purposePolicyVersion: 'ros-eye.purpose.v1',
    dataClassification: 'SENSITIVE_RESTRICTED',
    retentionClass: 'SHORT_LIVED_SIGNAL_METADATA',
    sourceType: 'PHONE',
    sourceId: 'device-pseudonym-001',
    occurredAt: '2026-07-29T12:00:00.000Z',
    receivedAt: '2026-07-29T12:00:01.000Z',
    consentBasis: 'EXPLICIT',
    integrity: { replayToken: 'nonce-phone-001', signatureStatus: 'VERIFIED', clockSkewMs: 1000 },
    location: { latitude: 24.7136, longitude: 46.6753, accuracyMeters: 20, classification: 'PRECISE_RESTRICTED' },
    payload: { kind: 'PHONE_MOTION', accelerationMagnitude: 18.4, impactDetected: true },
    ...overrides
  };
}

export function vehicleEventSimulator(overrides: Partial<HumanSafetySignalEnvelope> = {}): HumanSafetySignalEnvelope {
  return {
    ...phoneMotionSimulator(),
    signalId: 'signal-vehicle-001',
    sourceType: 'VEHICLE',
    sourceId: 'vehicle-pseudonym-001',
    integrity: { replayToken: 'nonce-vehicle-001', signatureStatus: 'VERIFIED', clockSkewMs: 500 },
    payload: { kind: 'VEHICLE_EVENT', eventCode: 'IMPACT', confidence: 0.91 },
    ...overrides
  };
}

export function personReportSimulator(overrides: Partial<HumanSafetySignalEnvelope> = {}): HumanSafetySignalEnvelope {
  return {
    ...phoneMotionSimulator(),
    signalId: 'signal-person-001',
    sourceType: 'PERSON',
    sourceId: 'person-pseudonym-001',
    integrity: { replayToken: 'nonce-person-001', signatureStatus: 'VERIFIED', clockSkewMs: 0 },
    location: null,
    payload: { kind: 'PERSON_REPORT', indicatorCodes: ['HELP_REQUESTED'] },
    ...overrides
  };
}

export function operatorObservationSimulator(overrides: Partial<HumanSafetySignalEnvelope> = {}): HumanSafetySignalEnvelope {
  return {
    ...phoneMotionSimulator(),
    signalId: 'signal-operator-001',
    sourceType: 'OPERATOR',
    sourceId: 'operator-pseudonym-001',
    consentBasis: 'OPERATOR_ENTERED',
    integrity: { replayToken: 'nonce-operator-001', signatureStatus: 'VERIFIED', clockSkewMs: 0 },
    location: null,
    payload: { kind: 'OPERATOR_OBSERVATION', indicatorCodes: ['COMMUNICATION_INTERRUPTED'] },
    ...overrides
  };
}

export function infrastructureMetadataSimulator(overrides: Partial<HumanSafetySignalEnvelope> = {}): HumanSafetySignalEnvelope {
  return {
    ...phoneMotionSimulator(),
    signalId: 'signal-infrastructure-001',
    sourceType: 'INFRASTRUCTURE',
    sourceId: 'road-sensor-pseudonym-001',
    integrity: { replayToken: 'nonce-infrastructure-001', signatureStatus: 'VERIFIED', clockSkewMs: 200 },
    payload: { kind: 'INFRASTRUCTURE_METADATA', sensorType: 'ROAD_SENSOR', confidence: 0.78 },
    ...overrides
  };
}

export function unsupportedWearableSimulator(): unknown {
  return {
    ...phoneMotionSimulator(),
    signalId: 'signal-wearable-future-001',
    sourceType: 'WEARABLE',
    sourceId: 'wearable-pseudonym-001',
    integrity: { replayToken: 'nonce-wearable-001', signatureStatus: 'VERIFIED', clockSkewMs: 0 },
    payload: { kind: 'WEARABLE_EVENT', confidence: 0.5 }
  };
}
