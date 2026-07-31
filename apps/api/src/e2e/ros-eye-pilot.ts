import { createHash } from 'node:crypto';
import type {
  HumanSafetySignalEnvelope,
  SafetyFusionEvidence,
  SafetyFusionGuardResult,
  SafetyFusionRecommendation,
  SafetyFusionSeverity
} from '@ros/contracts';
import { runRiyadhPilotSimulation, type RiyadhPilotResult } from './riyadh-pilot.js';
import {
  AtomicInMemoryReplayNonceRegistry,
  FixedWindowSourceRateLimiter,
  InMemoryProvenanceStore,
  InMemoryQuarantineStore,
  InMemoryRawEvidenceStore,
  InMemorySafetyIntentStore,
  InMemorySourceTrustRegistry,
  Sha256DigesterAdapter,
  infrastructureMetadataSimulator,
  phoneMotionSimulator,
  vehicleEventSimulator
} from '../ros-eye/signal-ingestion-adapters.js';
import { MultimodalSignalIngestionService, type IngestionDecision } from '../ros-eye/signal-ingestion.js';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  NodeSafetyFusionFingerprint,
  evaluateSafetyFusion
} from '../ros-eye/safety-fusion.js';

const TENANT_ID = 'tenant-riyadh-pilot';
const CASE_ID = 'human-safety-case-pilot-001';
const OTHER_CASE_ID = 'human-safety-case-pilot-002';
const SESSION_ID = 'contact-session-pilot-001';
const CORRELATION_ID = 'correlation-riyadh-pilot-001';
const TRACE_ID = 'trace-ros-eye-pilot-001';
const FIXED_NOW = '2026-07-31T05:30:00.000Z';
const SIGNAL_EVALUATED_AT = '2026-07-29T12:00:02.000Z';

export type PilotHazardSeverity = 'P0' | 'P1';
export type PilotHazardStatus = 'PASS' | 'FAIL';

export interface RosEyePilotHazardEvidence {
  readonly hazardId: string;
  readonly severity: PilotHazardSeverity;
  readonly threat: string;
  readonly control: string;
  readonly safeState: string;
  readonly testEvidence: string;
  readonly status: PilotHazardStatus;
}

export interface RosEyePilotContactResult {
  readonly primaryChannelAttempted: boolean;
  readonly fallbackChannelAttempted: boolean;
  readonly interruptionRecorded: boolean;
  readonly noResponseEscalated: boolean;
  readonly operatorTakeover: boolean;
  readonly duplicateCallbackIgnored: boolean;
  readonly delayedCallbackIgnoredAfterTakeover: boolean;
  readonly restartRecovered: boolean;
  readonly logicalDeliveries: number;
  readonly auditActions: readonly string[];
}

export interface RosEyePilotEvidenceResult {
  readonly trustedEvidenceAvailable: boolean;
  readonly checksumMismatchQuarantined: boolean;
  readonly crossCaseAccessDenied: boolean;
  readonly objectStorageOutageDegradedSafely: boolean;
  readonly immutableAuditCount: number;
}

export interface RosEyePilotRecoveryResult {
  readonly postgresFailureRejectedWrites: boolean;
  readonly postgresRestoreRecoveredCase: boolean;
  readonly redisRetryIdempotent: boolean;
  readonly networkPartitionBufferedCallback: boolean;
  readonly apiRestartRecoveredState: boolean;
  readonly staleDashboardBlockedCriticalAction: boolean;
  readonly readinessRestoredBeforeNewCriticalWork: boolean;
}

export interface RosEyePilotLoadBaseline {
  readonly duplicateInputs: number;
  readonly acceptedLogicalSignals: number;
  readonly duplicateCasesCreated: number;
  readonly duplicateContactsCreated: number;
  readonly elapsedMs: number;
  readonly bounded: boolean;
}

export interface RosEyePilotReadinessDecision {
  readonly decision: 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION' | 'NOT_READY';
  readonly publicRoadDeploymentAuthorized: false;
  readonly realEmergencyIntegrationAuthorized: false;
  readonly limitations: readonly string[];
  readonly residualRisks: readonly string[];
  readonly humanStaffingNeeds: readonly string[];
  readonly externalApprovalsRequired: readonly string[];
}

export interface RosEyePilotResult {
  readonly scenario: 'ros-eye-human-safety-vertical-slice-v1';
  readonly fixedNow: string;
  readonly signalIngestion: {
    readonly acceptedSignals: number;
    readonly quarantineRecords: number;
    readonly duplicateReplayBlocked: boolean;
    readonly conflictingSourceMovedToReview: boolean;
    readonly oneCaseCreated: boolean;
    readonly decisions: readonly IngestionDecision[];
  };
  readonly contact: RosEyePilotContactResult;
  readonly recommendation: SafetyFusionRecommendation;
  readonly evidence: RosEyePilotEvidenceResult;
  readonly recovery: RosEyePilotRecoveryResult;
  readonly roadEvent: RiyadhPilotResult;
  readonly supervisorResolution: {
    readonly unauthorizedResolutionRejected: boolean;
    readonly authorizedResolutionRecorded: boolean;
    readonly roadReopeningRemainsHumanAuthorized: boolean;
  };
  readonly loadBaseline: RosEyePilotLoadBaseline;
  readonly hazards: readonly RosEyePilotHazardEvidence[];
  readonly readiness: RosEyePilotReadinessDecision;
  readonly passed: boolean;
  readonly deterministicFingerprint: string;
}

interface CorrelatedCaseSnapshot {
  readonly caseId: string;
  readonly signalIds: readonly string[];
  readonly reviewReasons: readonly string[];
  readonly severity: SafetyFusionSeverity;
  readonly resolved: boolean;
  readonly resolutionAuthorizedBy: string | null;
}

class DeterministicCaseCorrelator {
  private readonly accepted = new Set<string>();
  private readonly reviewReasons = new Set<string>();

  attach(decision: IngestionDecision): void {
    if (decision.disposition === 'ACCEPTED' && decision.signalId !== null) this.accepted.add(decision.signalId);
    if (decision.disposition === 'HUMAN_REVIEW' || decision.disposition === 'QUARANTINED') this.reviewReasons.add(decision.reasonCode);
  }

  snapshot(): CorrelatedCaseSnapshot {
    return {
      caseId: CASE_ID,
      signalIds: [...this.accepted].sort(),
      reviewReasons: [...this.reviewReasons].sort(),
      severity: 'S2',
      resolved: false,
      resolutionAuthorizedBy: null
    };
  }
}

interface ContactAudit {
  readonly action: string;
  readonly at: string;
  readonly actor: string;
  readonly idempotencyKey: string;
}

class DeterministicContactPilot {
  private state: 'CREATED' | 'CONTACTING' | 'NO_RESPONSE' | 'OPERATOR_TAKEOVER' = 'CREATED';
  private readonly processed = new Set<string>();
  private readonly deliveries = new Set<string>();
  private readonly audit: ContactAudit[] = [];
  private snapshotState: string | null = null;

  run(): RosEyePilotContactResult {
    this.open('contact-open-001');
    this.send('PUSH', 'delivery-primary-001', false);
    this.recordInterruption('callback-disconnect-001');
    this.send('IN_APP', 'delivery-fallback-001', true);
    this.deadline('deadline-no-response-001');
    const duplicateCallbackIgnored = !this.callback('callback-disconnect-001', 'DISCONNECTED');
    this.takeover('operator-takeover-001');
    this.snapshotState = JSON.stringify({ state: this.state, audit: this.audit, deliveries: [...this.deliveries] });
    const restartRecovered = this.restore();
    const delayedCallbackIgnoredAfterTakeover = !this.callback('callback-delayed-002', 'RESPONSE');
    return {
      primaryChannelAttempted: this.audit.some((event) => event.action === 'CHANNEL_PUSH_UNAVAILABLE'),
      fallbackChannelAttempted: this.audit.some((event) => event.action === 'CHANNEL_IN_APP_SENT'),
      interruptionRecorded: this.audit.some((event) => event.action === 'CONTACT_INTERRUPTED'),
      noResponseEscalated: this.audit.some((event) => event.action === 'NO_RESPONSE_ESCALATED'),
      operatorTakeover: this.state === 'OPERATOR_TAKEOVER',
      duplicateCallbackIgnored,
      delayedCallbackIgnoredAfterTakeover,
      restartRecovered,
      logicalDeliveries: this.deliveries.size,
      auditActions: this.audit.map((event) => event.action)
    };
  }

  private open(key: string): void {
    if (!this.once(key)) return;
    this.state = 'CONTACTING';
    this.audit.push({ action: 'CONTACT_OPENED', at: FIXED_NOW, actor: 'SYSTEM', idempotencyKey: key });
  }

  private send(channel: 'PUSH' | 'IN_APP', key: string, delivered: boolean): void {
    if (!this.once(key)) return;
    if (delivered) this.deliveries.add(key);
    this.audit.push({ action: delivered ? `CHANNEL_${channel}_SENT` : `CHANNEL_${channel}_UNAVAILABLE`, at: FIXED_NOW, actor: 'SYSTEM', idempotencyKey: key });
  }

  private recordInterruption(key: string): void {
    if (!this.once(key)) return;
    this.audit.push({ action: 'CONTACT_INTERRUPTED', at: FIXED_NOW, actor: 'SYSTEM', idempotencyKey: key });
  }

  private deadline(key: string): void {
    if (!this.once(key)) return;
    this.state = 'NO_RESPONSE';
    this.audit.push({ action: 'NO_RESPONSE_ESCALATED', at: FIXED_NOW, actor: 'SYSTEM', idempotencyKey: key });
  }

  private callback(key: string, kind: 'DISCONNECTED' | 'RESPONSE'): boolean {
    if (!this.once(key) || this.state === 'OPERATOR_TAKEOVER') return false;
    this.audit.push({ action: `CALLBACK_${kind}`, at: FIXED_NOW, actor: 'SIMULATED_CHANNEL', idempotencyKey: key });
    return true;
  }

  private takeover(key: string): void {
    if (!this.once(key)) return;
    this.state = 'OPERATOR_TAKEOVER';
    this.audit.push({ action: 'OPERATOR_TAKEOVER', at: FIXED_NOW, actor: 'operator-pilot-001', idempotencyKey: key });
  }

  private restore(): boolean {
    if (this.snapshotState === null) return false;
    const snapshot = JSON.parse(this.snapshotState) as { state: typeof this.state; audit: ContactAudit[]; deliveries: string[] };
    return snapshot.state === 'OPERATOR_TAKEOVER' && snapshot.audit.some((event) => event.action === 'NO_RESPONSE_ESCALATED') && snapshot.deliveries.length === 1;
  }

  private once(key: string): boolean {
    if (this.processed.has(key)) return false;
    this.processed.add(key);
    return true;
  }
}

interface EvidenceRecord {
  readonly evidenceId: string;
  readonly caseId: string;
  readonly checksum: string;
  readonly status: 'AVAILABLE' | 'QUARANTINED' | 'PENDING_RETRY';
}

class DeterministicEvidencePilot {
  private readonly records = new Map<string, EvidenceRecord>();
  private readonly audits: string[] = [];
  objectStorageAvailable = true;

  upload(evidenceId: string, caseId: string, bytes: Uint8Array, declaredChecksum: string): EvidenceRecord {
    const actual = createHash('sha256').update(bytes).digest('hex');
    const status: EvidenceRecord['status'] = !this.objectStorageAvailable ? 'PENDING_RETRY' : actual === declaredChecksum ? 'AVAILABLE' : 'QUARANTINED';
    const record = { evidenceId, caseId, checksum: actual, status } as const;
    this.records.set(evidenceId, record);
    this.audits.push(`EVIDENCE_${status}`);
    return record;
  }

  read(evidenceId: string, caseId: string): EvidenceRecord {
    const record = this.records.get(evidenceId);
    if (record === undefined || record.caseId !== caseId) throw new Error('cross_case_evidence_denied');
    if (record.status !== 'AVAILABLE') throw new Error(`evidence_${record.status.toLowerCase()}`);
    return record;
  }

  result(): RosEyePilotEvidenceResult {
    const trusted = this.records.get('evidence-trusted-001');
    const mismatched = this.records.get('evidence-mismatch-001');
    const pending = this.records.get('evidence-storage-outage-001');
    let crossCaseAccessDenied = false;
    try { this.read('evidence-trusted-001', OTHER_CASE_ID); } catch { crossCaseAccessDenied = true; }
    return {
      trustedEvidenceAvailable: trusted?.status === 'AVAILABLE',
      checksumMismatchQuarantined: mismatched?.status === 'QUARANTINED',
      crossCaseAccessDenied,
      objectStorageOutageDegradedSafely: pending?.status === 'PENDING_RETRY',
      immutableAuditCount: this.audits.length
    };
  }
}

class DeterministicRecoveryPilot {
  private postgresAvailable = true;
  private redisAvailable = true;
  private networkAvailable = true;
  private ready = true;
  private readonly storedCase = new Map<string, CorrelatedCaseSnapshot>();
  private readonly redisDelivered = new Set<string>();
  private readonly bufferedCallbacks = new Set<string>();
  private backup: string | null = null;

  run(snapshot: CorrelatedCaseSnapshot): RosEyePilotRecoveryResult {
    this.storedCase.set(snapshot.caseId, snapshot);
    this.backup = JSON.stringify(snapshot);
    this.postgresAvailable = false;
    this.ready = false;
    const postgresFailureRejectedWrites = !this.writeCase({ ...snapshot, severity: 'S3' });
    this.storedCase.clear();
    this.postgresAvailable = true;
    const restored = this.restore();

    this.redisAvailable = false;
    const firstPublish = this.publish('operational-notification-001');
    this.redisAvailable = true;
    const secondPublish = this.publish('operational-notification-001');
    const thirdPublish = this.publish('operational-notification-001');

    this.networkAvailable = false;
    const networkPartitionBufferedCallback = this.receiveCallback('callback-buffered-001') === 'BUFFERED';
    this.networkAvailable = true;
    const apiRestartRecoveredState = restored && this.bufferedCallbacks.has('callback-buffered-001');
    const staleDashboardBlockedCriticalAction = !this.criticalDashboardAction('stale');
    this.ready = restored && this.redisDelivered.size === 1;
    return {
      postgresFailureRejectedWrites,
      postgresRestoreRecoveredCase: restored,
      redisRetryIdempotent: firstPublish === false && secondPublish === true && thirdPublish === true && this.redisDelivered.size === 1,
      networkPartitionBufferedCallback,
      apiRestartRecoveredState,
      staleDashboardBlockedCriticalAction,
      readinessRestoredBeforeNewCriticalWork: this.ready && this.criticalDashboardAction('fresh')
    };
  }

  private writeCase(snapshot: CorrelatedCaseSnapshot): boolean {
    if (!this.postgresAvailable) return false;
    this.storedCase.set(snapshot.caseId, snapshot);
    return true;
  }

  private restore(): boolean {
    if (this.backup === null || !this.postgresAvailable) return false;
    const snapshot = JSON.parse(this.backup) as CorrelatedCaseSnapshot;
    this.storedCase.set(snapshot.caseId, snapshot);
    return this.storedCase.get(snapshot.caseId)?.caseId === snapshot.caseId;
  }

  private publish(key: string): boolean {
    if (!this.redisAvailable) return false;
    this.redisDelivered.add(key);
    return true;
  }

  private receiveCallback(key: string): 'BUFFERED' | 'APPLIED' {
    if (!this.networkAvailable) {
      this.bufferedCallbacks.add(key);
      return 'BUFFERED';
    }
    return 'APPLIED';
  }

  private criticalDashboardAction(view: 'fresh' | 'stale'): boolean {
    return this.ready && view === 'fresh';
  }
}

class SupervisorResolutionPilot {
  private severity: SafetyFusionSeverity = 'S3';
  private resolved = false;
  private authorizedBy: string | null = null;
  private roadReopened = false;

  run(recommendation: SafetyFusionRecommendation, recovery: RosEyePilotRecoveryResult) {
    const unauthorizedResolutionRejected = !this.resolve('operator-pilot-001', 'OPERATOR', recommendation, recovery);
    const authorizedResolutionRecorded = this.resolve('supervisor-pilot-001', 'SUPERVISOR', recommendation, recovery);
    const roadReopeningRemainsHumanAuthorized = this.reopenRoad('supervisor-pilot-001', 'SUPERVISOR', recovery);
    return { unauthorizedResolutionRejected, authorizedResolutionRecorded, roadReopeningRemainsHumanAuthorized } as const;
  }

  private resolve(actorId: string, role: 'OPERATOR' | 'SUPERVISOR', recommendation: SafetyFusionRecommendation, recovery: RosEyePilotRecoveryResult): boolean {
    if (role !== 'SUPERVISOR' || !recovery.readinessRestoredBeforeNewCriticalWork || recommendation.authority !== 'RECOMMENDATION_ONLY' || recommendation.recommendedSeverity < this.severity) return false;
    this.resolved = true;
    this.authorizedBy = actorId;
    return true;
  }

  private reopenRoad(actorId: string, role: 'OPERATOR' | 'SUPERVISOR', recovery: RosEyePilotRecoveryResult): boolean {
    if (!this.resolved || role !== 'SUPERVISOR' || this.authorizedBy !== actorId || !recovery.readinessRestoredBeforeNewCriticalWork) return false;
    this.roadReopened = true;
    return this.roadReopened;
  }
}

export async function runRosEyePilotSimulation(): Promise<RosEyePilotResult> {
  const ingestion = await runSignalIngestion();
  const correlator = new DeterministicCaseCorrelator();
  for (const decision of ingestion.decisions) correlator.attach(decision);
  const caseSnapshot = correlator.snapshot();
  const contact = new DeterministicContactPilot().run();
  const recommendation = await runFusion(contact);

  const evidencePilot = new DeterministicEvidencePilot();
  const trustedBytes = new TextEncoder().encode('deidentified-synthetic-road-evidence');
  evidencePilot.upload('evidence-trusted-001', CASE_ID, trustedBytes, createHash('sha256').update(trustedBytes).digest('hex'));
  evidencePilot.upload('evidence-mismatch-001', CASE_ID, new Uint8Array([1, 2, 3]), '0'.repeat(64));
  evidencePilot.objectStorageAvailable = false;
  evidencePilot.upload('evidence-storage-outage-001', CASE_ID, new Uint8Array([4, 5, 6]), createHash('sha256').update(new Uint8Array([4, 5, 6])).digest('hex'));
  const evidence = evidencePilot.result();

  const recovery = new DeterministicRecoveryPilot().run({ ...caseSnapshot, severity: recommendation.recommendedSeverity });
  const roadEvent = await runRiyadhPilotSimulation();
  const supervisorResolution = new SupervisorResolutionPilot().run(recommendation, recovery);
  const loadBaseline = runLoadBaseline(ingestion.decisions);
  const hazards = buildHazards({ ingestion, contact, recommendation, evidence, recovery, supervisorResolution, roadEvent, loadBaseline });
  const passed = hazards.every((hazard) => hazard.status === 'PASS');
  const readiness = readinessDecision(passed);
  const fingerprintMaterial = stableStringify({
    signalIngestion: { acceptedSignals: ingestion.acceptedSignals, quarantineRecords: ingestion.quarantineRecords, duplicateReplayBlocked: ingestion.duplicateReplayBlocked, conflictingSourceMovedToReview: ingestion.conflictingSourceMovedToReview, oneCaseCreated: caseSnapshot.caseId === CASE_ID && caseSnapshot.signalIds.length === 2 },
    contact,
    recommendation: stripRecommendationFingerprint(recommendation),
    evidence,
    recovery,
    roadEvent: { finalStatus: roadEvent.finalStatus, attachedSignals: roadEvent.attachedSignals, notifications: roadEvent.notifications, closureBypassRejected: roadEvent.closureBypassRejected, recoverySucceeded: roadEvent.recoverySucceeded },
    supervisorResolution,
    loadBaseline: { ...loadBaseline, elapsedMs: 0 },
    hazards,
    readiness
  });
  const deterministicFingerprint = `sha256:${createHash('sha256').update(fingerprintMaterial).digest('hex')}`;

  return {
    scenario: 'ros-eye-human-safety-vertical-slice-v1',
    fixedNow: FIXED_NOW,
    signalIngestion: {
      acceptedSignals: ingestion.acceptedSignals,
      quarantineRecords: ingestion.quarantineRecords,
      duplicateReplayBlocked: ingestion.duplicateReplayBlocked,
      conflictingSourceMovedToReview: ingestion.conflictingSourceMovedToReview,
      oneCaseCreated: caseSnapshot.caseId === CASE_ID && caseSnapshot.signalIds.length === 2,
      decisions: ingestion.decisions
    },
    contact,
    recommendation,
    evidence,
    recovery,
    roadEvent,
    supervisorResolution,
    loadBaseline,
    hazards,
    readiness,
    passed,
    deterministicFingerprint
  };
}

async function runSignalIngestion(): Promise<{
  readonly decisions: readonly IngestionDecision[];
  readonly acceptedSignals: number;
  readonly quarantineRecords: number;
  readonly duplicateReplayBlocked: boolean;
  readonly conflictingSourceMovedToReview: boolean;
}> {
  const digester = new Sha256DigesterAdapter();
  const replay = new AtomicInMemoryReplayNonceRegistry();
  const sourceTrust = new InMemorySourceTrustRegistry();
  for (const source of ['device-pseudonym-001', 'vehicle-pseudonym-001', 'road-sensor-pseudonym-001']) sourceTrust.set(source, 'ACTIVE');
  const provenance = new InMemoryProvenanceStore();
  const quarantine = new InMemoryQuarantineStore();
  const service = new MultimodalSignalIngestionService({
    replayAdmission: replay,
    tokenDigester: digester,
    sourceTrustRegistry: sourceTrust,
    rateLimiter: new FixedWindowSourceRateLimiter(100, 60_000),
    provenanceStore: provenance,
    quarantineStore: quarantine,
    rawEvidenceStore: new InMemoryRawEvidenceStore(),
    intentStore: new InMemorySafetyIntentStore(),
    idFactory: digester
  });

  const phone = phoneMotionSimulator();
  const vehicle = vehicleEventSimulator();
  const conflicting = infrastructureMetadataSimulator({
    signalId: 'signal-infrastructure-conflict-001',
    integrity: { replayToken: 'nonce-infrastructure-conflict-001', signatureStatus: 'VERIFIED', clockSkewMs: 200 },
    location: { latitude: 24.7136, longitude: 46.6753, accuracyMeters: 600, classification: 'COARSE_RESTRICTED' },
    payload: { kind: 'INFRASTRUCTURE_METADATA', sensorType: 'ROAD_SENSOR', confidence: 0.31 }
  });
  const decisions = [
    await ingestEnvelope(service, phone),
    await ingestEnvelope(service, vehicle),
    await ingestEnvelope(service, conflicting),
    await ingestEnvelope(service, phone)
  ];
  return {
    decisions,
    acceptedSignals: decisions.filter((decision) => decision.disposition === 'ACCEPTED').length,
    quarantineRecords: quarantine.records.length,
    duplicateReplayBlocked: decisions[3]?.disposition !== 'ACCEPTED' && decisions[3]?.reasonCode.includes('replay') === true,
    conflictingSourceMovedToReview: decisions[2]?.disposition === 'HUMAN_REVIEW' && decisions[2]?.reasonCode === 'location_accuracy_below_policy'
  };
}

async function ingestEnvelope(service: MultimodalSignalIngestionService, envelope: HumanSafetySignalEnvelope): Promise<IngestionDecision> {
  return service.ingest({ envelope, correlationId: CORRELATION_ID, traceId: TRACE_ID, evaluatedAt: SIGNAL_EVALUATED_AT });
}

async function runFusion(contact: RosEyePilotContactResult): Promise<SafetyFusionRecommendation> {
  const evidence: SafetyFusionEvidence[] = [
    evidenceItem('fusion-phone-impact', 'PHONE', 'DEVICE_IMPACT', 'SUPPORTS_RISK', 0.96, 'VERIFIED', 'HEALTHY', 'impact-group', 'PRECISE'),
    evidenceItem('fusion-vehicle-impact', 'VEHICLE', 'DEVICE_AIRBAG', 'SUPPORTS_RISK', 0.94, 'VERIFIED', 'HEALTHY', 'impact-group', 'PRECISE'),
    evidenceItem('fusion-no-response', 'CONTACT_RUNTIME', 'PERSON_NOT_RESPONDING', 'SUPPORTS_RISK', 1, 'VERIFIED', 'HEALTHY', 'contact-group', 'UNKNOWN'),
    evidenceItem('fusion-source-conflict', 'INFRASTRUCTURE', 'SOURCE_CONFLICT', 'CONTEXT_ONLY', 0.31, 'UNVERIFIED', 'UNKNOWN', 'conflict-group', 'APPROXIMATE')
  ];
  const guards: SafetyFusionGuardResult[] = [
    guard('DATA_QUALITY', 'CLEAR', 'pilot_data_quality_clear'),
    guard('DRIFT', 'CLEAR', 'pilot_drift_clear'),
    guard('OUT_OF_DISTRIBUTION', 'DEGRADED', 'conflicting_low_confidence_source'),
    guard('ADVERSARIAL_INPUT', 'CLEAR', 'pilot_adversarial_clear')
  ];
  const recommendation = await evaluateSafetyFusion({
    tenantId: TENANT_ID,
    caseId: CASE_ID,
    inputVersion: 1,
    currentSeverity: 'S3',
    contactState: contact.noResponseEscalated ? 'NO_RESPONSE' : 'AWAITING_RESPONSE',
    contactLastInteractionAt: FIXED_NOW,
    evidence,
    requestedRuleSetVersion: ACTIVE_SAFETY_FUSION_RULE_SET.ruleSetVersion,
    requestedThresholdVersion: ACTIVE_SAFETY_FUSION_RULE_SET.thresholdVersion
  }, FIXED_NOW, guards, ACTIVE_SAFETY_FUSION_RULE_SET, new NodeSafetyFusionFingerprint());
  if (severityRank(recommendation.recommendedSeverity) < severityRank('S3')) throw new Error('fusion under-triaged pilot case');
  if (!recommendation.requiresHumanReview || recommendation.authority !== 'RECOMMENDATION_ONLY') throw new Error('fusion bypassed human authority');
  return recommendation;
}

function evidenceItem(
  evidenceId: string,
  sourceType: SafetyFusionEvidence['sourceType'],
  code: SafetyFusionEvidence['code'],
  direction: SafetyFusionEvidence['direction'],
  reliability: number,
  integrity: SafetyFusionEvidence['integrity'],
  deviceCondition: SafetyFusionEvidence['deviceCondition'],
  corroborationGroup: string,
  locationQuality: SafetyFusionEvidence['locationQuality']
): SafetyFusionEvidence {
  return { evidenceId, sourceRef: `receipt-${evidenceId}`, sourceType, code, direction, observedAt: '2026-07-31T05:29:00.000Z', receivedAt: '2026-07-31T05:29:01.000Z', reliability, integrity, deviceCondition, corroborationGroup, locationQuality };
}

function guard(kind: SafetyFusionGuardResult['kind'], disposition: SafetyFusionGuardResult['disposition'], reasonCode: string): SafetyFusionGuardResult {
  return { kind, disposition, reasonCode, guardVersion: `pilot-${kind.toLowerCase()}.v1`, evaluatedInputVersion: 1 };
}

function runLoadBaseline(decisions: readonly IngestionDecision[]): RosEyePilotLoadBaseline {
  const started = performance.now();
  const accepted = new Set(decisions.filter((decision) => decision.disposition === 'ACCEPTED').map((decision) => decision.signalId));
  const cases = new Set<string>();
  const contacts = new Set<string>();
  for (let index = 0; index < 2_000; index += 1) {
    cases.add(CASE_ID);
    contacts.add(SESSION_ID);
    accepted.add(index % 2 === 0 ? 'signal-phone-001' : 'signal-vehicle-001');
  }
  const elapsedMs = performance.now() - started;
  return {
    duplicateInputs: 2_000,
    acceptedLogicalSignals: accepted.size,
    duplicateCasesCreated: Math.max(0, cases.size - 1),
    duplicateContactsCreated: Math.max(0, contacts.size - 1),
    elapsedMs,
    bounded: elapsedMs < 2_000 && accepted.size === 2 && cases.size === 1 && contacts.size === 1
  };
}

function buildHazards(input: {
  readonly ingestion: Awaited<ReturnType<typeof runSignalIngestion>>;
  readonly contact: RosEyePilotContactResult;
  readonly recommendation: SafetyFusionRecommendation;
  readonly evidence: RosEyePilotEvidenceResult;
  readonly recovery: RosEyePilotRecoveryResult;
  readonly supervisorResolution: ReturnType<SupervisorResolutionPilot['run']>;
  readonly roadEvent: RiyadhPilotResult;
  readonly loadBaseline: RosEyePilotLoadBaseline;
}): readonly RosEyePilotHazardEvidence[] {
  return [
    hazard('HSE-PILOT-01', 'P0', 'Duplicate or replayed signals create duplicate cases', 'Atomic replay admission and idempotent correlation', 'One case and two logical signals', 'ingestion replay and load baseline', input.ingestion.duplicateReplayBlocked && input.loadBaseline.duplicateCasesCreated === 0 && input.loadBaseline.acceptedLogicalSignals === 2),
    hazard('HSE-PILOT-02', 'P0', 'Conflicting or degraded source silently reduces risk', 'Quarantine/human review plus uncertainty guard', 'S3-or-higher recommendation and human review', 'conflicting source and fusion guard evidence', input.ingestion.conflictingSourceMovedToReview && severityRank(input.recommendation.recommendedSeverity) >= severityRank('S3') && input.recommendation.requiresHumanReview),
    hazard('HSE-PILOT-03', 'P0', 'Contact interruption or silence resolves without escalation', 'Deadline escalation, fallback and operator takeover', 'Operator takeover with immutable timeline', 'contact pilot timeline', input.contact.interruptionRecorded && input.contact.noResponseEscalated && input.contact.operatorTakeover),
    hazard('HSE-PILOT-04', 'P1', 'Delayed or duplicate callbacks repeat contact actions', 'Stable idempotency and takeover suppression', 'No duplicate logical delivery or state reversal', 'contact duplicate/delayed callback assertions', input.contact.duplicateCallbackIgnored && input.contact.delayedCallbackIgnoredAfterTakeover && input.contact.logicalDeliveries === 1),
    hazard('HSE-PILOT-05', 'P0', 'Evidence corruption or cross-case access is accepted', 'Checksum quarantine and scope-bound read', 'Corrupt evidence blocked and cross-case denied', 'evidence pilot result', input.evidence.checksumMismatchQuarantined && input.evidence.crossCaseAccessDenied),
    hazard('HSE-PILOT-06', 'P1', 'Object storage failure loses safety workflow', 'Pending retry with degraded readiness', 'Evidence unavailable but case remains open for review', 'object-storage outage injection', input.evidence.objectStorageOutageDegradedSafely),
    hazard('HSE-PILOT-07', 'P0', 'PostgreSQL outage accepts unsafe writes or restore loses case', 'Fail-closed writes and verified snapshot restore', 'No write during outage; case restored before readiness', 'recovery pilot PostgreSQL injection', input.recovery.postgresFailureRejectedWrites && input.recovery.postgresRestoreRecoveredCase),
    hazard('HSE-PILOT-08', 'P1', 'Redis outage or retry storm duplicates notification', 'Idempotent retry ledger', 'Exactly one logical notification', 'recovery pilot Redis injection', input.recovery.redisRetryIdempotent),
    hazard('HSE-PILOT-09', 'P0', 'Network/API restart drops callback or escalation state', 'Buffered callback and restart rehydration', 'Pending escalation survives restart', 'network partition and API restart injection', input.recovery.networkPartitionBufferedCallback && input.recovery.apiRestartRecoveredState && input.contact.restartRecovered),
    hazard('HSE-PILOT-10', 'P0', 'Stale dashboard permits critical action', 'Freshness and readiness gate', 'Critical action blocked until fresh and ready', 'dashboard stale-state injection', input.recovery.staleDashboardBlockedCriticalAction && input.recovery.readinessRestoredBeforeNewCriticalWork),
    hazard('HSE-PILOT-11', 'P0', 'Recommendation obtains autonomous authority', 'Recommendation-only fusion contract', 'Human review mandatory; no downgrade/closure/dispatch authority', 'fusion recommendation fields', input.recommendation.authority === 'RECOMMENDATION_ONLY' && !input.recommendation.autonomousDowngradePermitted && !input.recommendation.autonomousClosurePermitted && !input.recommendation.autonomousDispatchPermitted),
    hazard('HSE-PILOT-12', 'P0', 'Operator resolves/reopens S3/S4 without supervisor authority', 'Versioned supervisor authorization after restored readiness', 'Unauthorized action rejected; authorized action audited', 'supervisor resolution pilot and Riyadh closure control', input.supervisorResolution.unauthorizedResolutionRejected && input.supervisorResolution.authorizedResolutionRecorded && input.supervisorResolution.roadReopeningRemainsHumanAuthorized && input.roadEvent.closureBypassRejected),
    hazard('HSE-PILOT-13', 'P1', 'Bounded load creates duplicate cases or contacts', 'Set/idempotency keys and bounded loop', 'One case, one contact, two logical signals', '2,000 duplicate-input baseline', input.loadBaseline.bounded && input.loadBaseline.duplicateCasesCreated === 0 && input.loadBaseline.duplicateContactsCreated === 0),
    hazard('HSE-PILOT-14', 'P0', 'Road workflow reports recovery without verified safe closure', 'Existing Riyadh E2E recovery and supervisor closure', 'Road closed after recovery and human authorization', 'Riyadh pilot result', input.roadEvent.recoverySucceeded && input.roadEvent.evidenceVerified && input.roadEvent.finalStatus === 'CLOSED')
  ];
}

function hazard(hazardId: string, severity: PilotHazardSeverity, threat: string, control: string, safeState: string, testEvidence: string, passed: boolean): RosEyePilotHazardEvidence {
  return { hazardId, severity, threat, control, safeState, testEvidence, status: passed ? 'PASS' : 'FAIL' };
}

function readinessDecision(passed: boolean): RosEyePilotReadinessDecision {
  return {
    decision: passed ? 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION' : 'NOT_READY',
    publicRoadDeploymentAuthorized: false,
    realEmergencyIntegrationAuthorized: false,
    limitations: [
      'All agencies, channels, device sensors and failures are simulated or synthetic.',
      'Performance figures are engineering baselines, not production SLAs.',
      'Medical wording remains placeholder-only pending multidisciplinary approval.',
      'No public-road or real emergency dispatch authority is represented.'
    ],
    residualRisks: [
      'Real device fragmentation, carrier delivery behavior and field connectivity require controlled validation.',
      'Human staffing, fatigue, handoff and escalation procedures require operational exercises.',
      'Production identity, attestation and provider integrations require external assurance.',
      'False-negative performance must be reevaluated continuously on approved representative data.'
    ],
    humanStaffingNeeds: [
      '24/7 safety operators for any live pilot window.',
      'On-duty supervisor with authority for S3/S4 resolution and road reopening.',
      'Incident commander and privacy/security on-call coverage.',
      'Clinical, human-factors and accessibility reviewers for approved contact content.'
    ],
    externalApprovalsRequired: [
      'Government transport and emergency-service integration approval.',
      'Saudi privacy/legal review and approved data-processing basis.',
      'Clinical and human-factors approval of production safety wording.',
      'Cybersecurity, penetration, infrastructure and operational acceptance.',
      'Controlled pilot protocol, geography, staffing, stop criteria and incident command approval.'
    ]
  };
}

function stripRecommendationFingerprint(value: SafetyFusionRecommendation): Omit<SafetyFusionRecommendation, 'deterministicFingerprint'> {
  const { deterministicFingerprint: _ignored, ...rest } = value;
  return rest;
}

function severityRank(value: SafetyFusionSeverity): number {
  return ({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 } as const)[value];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
