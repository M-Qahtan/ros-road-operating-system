import {
  HUMAN_SAFETY_REPLAY_POLICY_VERSION,
  HUMAN_SAFETY_TEMPORAL_POLICY_VERSION,
  acceptHumanSafetySignalEnvelope,
  validateHumanSafetySignalEnvelope,
  type HumanSafetySignalEnvelope,
  type ReplayNonceConsumeRequest,
  type ReplayNonceConsumeResult,
  type ReplayTokenDigesterPort
} from '@ros/contracts';

export const ROS_EYE_INGESTION_POLICY_VERSION = 'ros-eye.ingestion.v2' as const;

export type SignalDisposition = 'ACCEPTED' | 'QUARANTINED' | 'HUMAN_REVIEW' | 'BACKPRESSURE';
export type SourceTrustState = 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
export type IngestionReadiness = 'READY' | 'DEGRADED';

export interface MultimodalSignalIngestionRequest {
  readonly envelope: unknown;
  readonly correlationId: string;
  readonly traceId: string;
  readonly evaluatedAt: string;
  readonly rawEvidence?: {
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  };
}

export interface AcceptedSignalProvenance {
  readonly provenanceId: string;
  readonly signalId: string;
  readonly sourceId: string;
  readonly sourceType: HumanSafetySignalEnvelope['sourceType'];
  readonly correlationId: string;
  readonly traceId: string;
  readonly evaluatedAt: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly schemaVersion: HumanSafetySignalEnvelope['schemaVersion'];
  readonly purposePolicyVersion: HumanSafetySignalEnvelope['purposePolicyVersion'];
  readonly replayPolicyVersion: typeof HUMAN_SAFETY_REPLAY_POLICY_VERSION;
  readonly temporalPolicyVersion: typeof HUMAN_SAFETY_TEMPORAL_POLICY_VERSION;
  readonly ingestionPolicyVersion: typeof ROS_EYE_INGESTION_POLICY_VERSION;
  readonly replayScopeDigest: string;
  readonly sourceTrustState: 'ACTIVE';
  readonly confidenceInputs: Readonly<Record<string, number | boolean | string>>;
  readonly locationQuality: { readonly present: boolean; readonly accuracyBand: 'NONE' | 'PRECISE' | 'COARSE' | 'POOR' };
  readonly rawEvidenceRef: string | null;
  readonly auditOutcome: 'ACCEPTED';
}

export interface SignalQuarantineRecord {
  readonly quarantineId: string;
  readonly signalId: string | null;
  readonly sourceId: string | null;
  readonly correlationId: string;
  readonly traceId: string;
  readonly evaluatedAt: string;
  readonly disposition: Exclude<SignalDisposition, 'ACCEPTED'>;
  readonly reasonCode: string;
  readonly ingestionPolicyVersion: typeof ROS_EYE_INGESTION_POLICY_VERSION;
  readonly replayPolicyVersion: typeof HUMAN_SAFETY_REPLAY_POLICY_VERSION;
  readonly temporalPolicyVersion: typeof HUMAN_SAFETY_TEMPORAL_POLICY_VERSION;
}

export interface SafetyIntentRecord {
  readonly intentId: string;
  readonly signalId: string;
  readonly correlationId: string;
  readonly provenanceId: string;
  readonly kind: HumanSafetySignalEnvelope['payload']['kind'];
  readonly createdAt: string;
}

export interface IngestionDecision {
  readonly disposition: SignalDisposition;
  readonly reasonCode: string;
  readonly signalId: string | null;
  readonly provenanceId: string | null;
  readonly intentId: string | null;
  readonly readiness: IngestionReadiness;
  readonly ingestionPolicyVersion: typeof ROS_EYE_INGESTION_POLICY_VERSION;
}

export interface SourceTrustRegistryPort {
  getTrustState(sourceId: string, evaluatedAt: string): Promise<SourceTrustState>;
}

export interface SourceRateLimitPort {
  consume(sourceId: string, evaluatedAt: string): Promise<'ALLOWED' | 'LIMITED' | 'UNAVAILABLE'>;
}

export interface ProvenanceStorePort {
  putIfAbsent(record: AcceptedSignalProvenance): Promise<'CREATED' | 'ALREADY_EXISTS'>;
}

export interface QuarantineStorePort {
  append(record: SignalQuarantineRecord): Promise<void>;
}

export interface RawEvidenceStorePort {
  putIfAbsent(input: { readonly signalId: string; readonly mediaType: string; readonly bytes: Uint8Array }): Promise<string>;
}

export interface SafetyIntentStorePort {
  createIfAbsent(record: SafetyIntentRecord): Promise<'CREATED' | 'ALREADY_EXISTS'>;
}

export interface IdFactoryPort {
  create(namespace: string, material: string): Promise<string>;
}

/**
 * A reservation is globally exclusive by nonceDigest. Reusing the same
 * admissionId+scope resumes an interrupted attempt; a different scope or
 * admissionId is a duplicate. No external ACCEPT is returned until commit.
 */
export interface RecoverableReplayAdmissionPort {
  reserve(request: ReplayNonceConsumeRequest, admissionId: string): Promise<ReplayNonceConsumeResult>;
  commit(input: { readonly admissionId: string; readonly nonceDigest: string; readonly scopeDigest: string }): Promise<'COMMITTED' | 'ALREADY_COMMITTED' | 'UNAVAILABLE'>;
  abort(input: { readonly admissionId: string; readonly nonceDigest: string; readonly scopeDigest: string }): Promise<'ABORTED' | 'NOT_FOUND' | 'UNAVAILABLE'>;
}

export interface MultimodalSignalIngestionPorts {
  readonly replayAdmission: RecoverableReplayAdmissionPort;
  readonly tokenDigester: ReplayTokenDigesterPort;
  readonly sourceTrustRegistry: SourceTrustRegistryPort;
  readonly rateLimiter: SourceRateLimitPort;
  readonly provenanceStore: ProvenanceStorePort;
  readonly quarantineStore: QuarantineStorePort;
  readonly rawEvidenceStore: RawEvidenceStorePort;
  readonly intentStore: SafetyIntentStorePort;
  readonly idFactory: IdFactoryPort;
}

export interface MultimodalSignalIngestionOptions {
  readonly maxQueueDepth: number;
  readonly maximumAcceptedLocationAccuracyMeters: number;
}

const DEFAULT_OPTIONS: MultimodalSignalIngestionOptions = Object.freeze({
  maxQueueDepth: 128,
  maximumAcceptedLocationAccuracyMeters: 250
});

interface QueueEntry {
  readonly request: MultimodalSignalIngestionRequest;
  readonly resolve: (decision: IngestionDecision) => void;
}

export class MultimodalSignalIngestionService {
  private readonly queue: QueueEntry[] = [];
  private processing = false;
  private degraded = false;

  constructor(
    private readonly ports: MultimodalSignalIngestionPorts,
    private readonly options: MultimodalSignalIngestionOptions = DEFAULT_OPTIONS
  ) {
    if (!Number.isInteger(options.maxQueueDepth) || options.maxQueueDepth < 1) throw new Error('maxQueueDepth must be a positive integer');
    if (!Number.isFinite(options.maximumAcceptedLocationAccuracyMeters) || options.maximumAcceptedLocationAccuracyMeters <= 0) throw new Error('maximumAcceptedLocationAccuracyMeters must be positive');
  }

  getReadiness(): IngestionReadiness {
    return this.degraded ? 'DEGRADED' : 'READY';
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  async enqueue(request: MultimodalSignalIngestionRequest): Promise<IngestionDecision> {
    const outstanding = this.queue.length + (this.processing ? 1 : 0);
    if (outstanding >= this.options.maxQueueDepth) {
      this.degraded = true;
      return this.quarantine(request, 'BACKPRESSURE', 'queue_capacity_exceeded');
    }

    return new Promise<IngestionDecision>((resolve) => {
      this.queue.push({ request, resolve });
      void this.drainQueue();
    });
  }

  async ingest(request: MultimodalSignalIngestionRequest): Promise<IngestionDecision> {
    if (!validOpaqueId(request.correlationId) || !validOpaqueId(request.traceId) || !validTimestamp(request.evaluatedAt)) {
      return this.quarantine(request, 'QUARANTINED', 'invalid_ingestion_context');
    }

    const structural = validateHumanSafetySignalEnvelope(request.envelope);
    if (structural.reasonCode !== 'structurally_valid_replay_check_required' || !isEnvelope(request.envelope)) {
      return this.quarantine(
        request,
        structural.disposition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'QUARANTINED',
        structural.reasonCode
      );
    }

    const envelope = request.envelope;
    const trustState = await safeSourceTrust(this.ports.sourceTrustRegistry, envelope.sourceId, request.evaluatedAt);
    if (trustState !== 'ACTIVE') {
      return this.quarantine(request, trustState === 'REVOKED' ? 'QUARANTINED' : 'HUMAN_REVIEW', trustState === 'REVOKED' ? 'source_revoked' : 'source_trust_unavailable');
    }

    const rateDecision = await safeRateConsume(this.ports.rateLimiter, envelope.sourceId, request.evaluatedAt);
    if (rateDecision !== 'ALLOWED') {
      this.degraded = true;
      return this.quarantine(request, rateDecision === 'LIMITED' ? 'BACKPRESSURE' : 'HUMAN_REVIEW', rateDecision === 'LIMITED' ? 'source_rate_limited' : 'rate_limiter_unavailable');
    }

    if (envelope.location !== null && envelope.location.accuracyMeters > this.options.maximumAcceptedLocationAccuracyMeters) {
      return this.quarantine(request, 'HUMAN_REVIEW', 'location_accuracy_below_policy');
    }

    let nonceDigest: string;
    try {
      nonceDigest = await this.ports.tokenDigester.digest(envelope.integrity.replayToken);
    } catch {
      return this.quarantine(request, 'HUMAN_REVIEW', 'replay_registry_unavailable');
    }
    if (!validDigest(nonceDigest)) return this.quarantine(request, 'QUARANTINED', 'invalid_replay_token_digest');

    const admissionId = await this.ports.idFactory.create('admission', `${envelope.sourceId}|${envelope.signalId}|${nonceDigest}`);
    let reservation: ReplayNonceConsumeRequest | null = null;
    const acceptance = await acceptHumanSafetySignalEnvelope(
      request.envelope,
      {
        tokenDigester: this.ports.tokenDigester,
        replayRegistry: {
          consume: async (replayRequest) => {
            reservation = replayRequest;
            return this.ports.replayAdmission.reserve(replayRequest, admissionId);
          }
        }
      },
      request.evaluatedAt
    );

    if (!acceptance.accepted || acceptance.disposition !== 'ACCEPT' || acceptance.replayScopeDigest === null || reservation === null) {
      return this.quarantine(
        request,
        acceptance.disposition === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'QUARANTINED',
        acceptance.reasonCode
      );
    }

    const reserved = reservation as ReplayNonceConsumeRequest;
    const provenanceId = await this.ports.idFactory.create('provenance', `${envelope.signalId}|${acceptance.replayScopeDigest}`);
    const intentId = await this.ports.idFactory.create('intent', envelope.signalId);

    try {
      let rawEvidenceRef: string | null = null;
      if (request.rawEvidence !== undefined) {
        rawEvidenceRef = await this.ports.rawEvidenceStore.putIfAbsent({
          signalId: envelope.signalId,
          mediaType: request.rawEvidence.mediaType,
          bytes: request.rawEvidence.bytes
        });
      }

      const provenance: AcceptedSignalProvenance = {
        provenanceId,
        signalId: envelope.signalId,
        sourceId: envelope.sourceId,
        sourceType: envelope.sourceType,
        correlationId: request.correlationId,
        traceId: request.traceId,
        evaluatedAt: request.evaluatedAt,
        occurredAt: envelope.occurredAt,
        receivedAt: envelope.receivedAt,
        schemaVersion: envelope.schemaVersion,
        purposePolicyVersion: envelope.purposePolicyVersion,
        replayPolicyVersion: HUMAN_SAFETY_REPLAY_POLICY_VERSION,
        temporalPolicyVersion: HUMAN_SAFETY_TEMPORAL_POLICY_VERSION,
        ingestionPolicyVersion: ROS_EYE_INGESTION_POLICY_VERSION,
        replayScopeDigest: acceptance.replayScopeDigest,
        sourceTrustState: 'ACTIVE',
        confidenceInputs: confidenceInputs(envelope),
        locationQuality: locationQuality(envelope),
        rawEvidenceRef,
        auditOutcome: 'ACCEPTED'
      };

      await this.ports.provenanceStore.putIfAbsent(provenance);
      await this.ports.intentStore.createIfAbsent({
        intentId,
        signalId: envelope.signalId,
        correlationId: request.correlationId,
        provenanceId,
        kind: envelope.payload.kind,
        createdAt: request.evaluatedAt
      });

      const committed = await this.ports.replayAdmission.commit({
        admissionId,
        nonceDigest: reserved.nonceDigest,
        scopeDigest: reserved.scopeDigest
      });
      if (committed === 'UNAVAILABLE') {
        this.degraded = true;
        return this.quarantine(request, 'HUMAN_REVIEW', 'replay_commit_unavailable');
      }
    } catch {
      this.degraded = true;
      await safeAbort(this.ports.replayAdmission, {
        admissionId,
        nonceDigest: reserved.nonceDigest,
        scopeDigest: reserved.scopeDigest
      });
      return this.quarantine(request, 'HUMAN_REVIEW', 'accepted_signal_persistence_unavailable');
    }

    this.degraded = false;
    return {
      disposition: 'ACCEPTED',
      reasonCode: 'accepted_with_recoverable_provenance',
      signalId: envelope.signalId,
      provenanceId,
      intentId,
      readiness: this.getReadiness(),
      ingestionPolicyVersion: ROS_EYE_INGESTION_POLICY_VERSION
    };
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const entry = this.queue.shift();
        if (entry === undefined) break;
        const decision = await this.ingest(entry.request);
        entry.resolve(decision);
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) void this.drainQueue();
    }
  }

  private async quarantine(request: MultimodalSignalIngestionRequest, disposition: Exclude<SignalDisposition, 'ACCEPTED'>, reasonCode: string): Promise<IngestionDecision> {
    const signalId = isEnvelope(request.envelope) ? request.envelope.signalId : null;
    const sourceId = isEnvelope(request.envelope) ? request.envelope.sourceId : null;
    const quarantineId = await this.ports.idFactory.create('quarantine', `${request.traceId}|${signalId ?? 'unknown'}|${reasonCode}`);
    const record: SignalQuarantineRecord = {
      quarantineId,
      signalId,
      sourceId,
      correlationId: request.correlationId,
      traceId: request.traceId,
      evaluatedAt: request.evaluatedAt,
      disposition,
      reasonCode,
      ingestionPolicyVersion: ROS_EYE_INGESTION_POLICY_VERSION,
      replayPolicyVersion: HUMAN_SAFETY_REPLAY_POLICY_VERSION,
      temporalPolicyVersion: HUMAN_SAFETY_TEMPORAL_POLICY_VERSION
    };
    try {
      await this.ports.quarantineStore.append(record);
    } catch {
      this.degraded = true;
    }
    return {
      disposition,
      reasonCode,
      signalId,
      provenanceId: null,
      intentId: null,
      readiness: this.getReadiness(),
      ingestionPolicyVersion: ROS_EYE_INGESTION_POLICY_VERSION
    };
  }
}

async function safeAbort(
  port: RecoverableReplayAdmissionPort,
  input: { readonly admissionId: string; readonly nonceDigest: string; readonly scopeDigest: string }
): Promise<void> {
  try { await port.abort(input); } catch { /* fail closed; retry uses same admission identity */ }
}

async function safeSourceTrust(port: SourceTrustRegistryPort, sourceId: string, evaluatedAt: string): Promise<SourceTrustState> {
  try { return await port.getTrustState(sourceId, evaluatedAt); } catch { return 'UNKNOWN'; }
}

async function safeRateConsume(port: SourceRateLimitPort, sourceId: string, evaluatedAt: string): Promise<'ALLOWED' | 'LIMITED' | 'UNAVAILABLE'> {
  try { return await port.consume(sourceId, evaluatedAt); } catch { return 'UNAVAILABLE'; }
}

function confidenceInputs(envelope: HumanSafetySignalEnvelope): Readonly<Record<string, number | boolean | string>> {
  switch (envelope.payload.kind) {
    case 'PHONE_MOTION': return { impactDetected: envelope.payload.impactDetected, accelerationMagnitude: envelope.payload.accelerationMagnitude };
    case 'VEHICLE_EVENT': return { eventCode: envelope.payload.eventCode, confidence: envelope.payload.confidence };
    case 'INFRASTRUCTURE_METADATA': return { sensorType: envelope.payload.sensorType, confidence: envelope.payload.confidence };
    case 'PERSON_REPORT':
    case 'OPERATOR_OBSERVATION': return { indicatorCount: envelope.payload.indicatorCodes.length };
    case 'SIMULATION_FIXTURE': return { simulation: true };
  }
}

function locationQuality(envelope: HumanSafetySignalEnvelope): AcceptedSignalProvenance['locationQuality'] {
  if (envelope.location === null) return { present: false, accuracyBand: 'NONE' };
  if (envelope.location.accuracyMeters <= 25) return { present: true, accuracyBand: 'PRECISE' };
  if (envelope.location.accuracyMeters <= 100) return { present: true, accuracyBand: 'COARSE' };
  return { present: true, accuracyBand: 'POOR' };
}

function isEnvelope(value: unknown): value is HumanSafetySignalEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<HumanSafetySignalEnvelope>;
  return typeof candidate.signalId === 'string' && typeof candidate.sourceId === 'string' && typeof candidate.receivedAt === 'string' && typeof candidate.occurredAt === 'string' && typeof candidate.payload === 'object' && candidate.payload !== null;
}

function validOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
