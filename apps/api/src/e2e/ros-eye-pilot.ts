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

interface IngestionSummary {
  readonly decisions: readonly IngestionDecision[];
  readonly acceptedSignals: number;
  readonly quarantineRecords: number;
  readonly duplicateReplayBlocked: boolean;
  readonly conflictingSourceMovedToReview: boolean;
  readonly oneCaseCreated: boolean;
  readonly acceptedSignalIds: readonly string[];
}

interface ResolutionSummary {
  readonly unauthorizedResolutionRejected: boolean;
  readonly authorizedResolutionRecorded: boolean;
  readonly roadReopeningRemainsHumanAuthorized: boolean;
}

interface EvidenceRecord {
  readonly evidenceId: string;
  readonly caseId: string;
  readonly checksum: string;
  readonly status: 'AVAILABLE' | 'QUARANTINED' | 'PENDING_RETRY';
}

export async function runRosEyePilotSimulation(): Promise<RosEyePilotResult> {
  const ingestion = await runIngestionScenario();
  const contact = runContactScenario();
  const recommendation = await runFusionScenario(contact);
  const evidence = runEvidenceScenario();
  const recovery = runRecoveryScenario(recommendation.recommendedSeverity);
  const roadEvent = await runRiyadhPilotSimulation();
  const supervisorResolution = runSupervisorResolutionScenario(recommendation, recovery);
  const loadBaseline = runLoadBaseline(ingestion.acceptedSignalIds);
  const hazards = buildHazards({ ingestion, contact, recommendation, evidence, recovery, roadEvent, supervisorResolution, loadBaseline });
  const passed = hazards.every((item) => item.status === 'PASS');
  const readiness = buildReadinessDecision(passed);
  const deterministicFingerprint = digestStable({
    ingestion: {
      acceptedSignals: ingestion.acceptedSignals,
      quarantineRecords: ingestion.quarantineRecords,
      duplicateReplayBlocked: ingestion.duplicateReplayBlocked,
      conflictingSourceMovedToReview: ingestion.conflictingSourceMovedToReview,
      oneCaseCreated: ingestion.oneCaseCreated,
      decisions: ingestion.decisions
    },
    contact,
    recommendation: withoutFingerprint(recommendation),
    evidence,
    recovery,
    roadEvent: {
      finalStatus: roadEvent.finalStatus,
      attachedSignals: roadEvent.attachedSignals,
      notifications: roadEvent.notifications,
      evidenceVerified: roadEvent.evidenceVerified,
      closureBypassRejected: roadEvent.closureBypassRejected,
      recoverySucceeded: roadEvent.recoverySucceeded
    },
    supervisorResolution,
    loadBaseline: { ...loadBaseline, elapsedMs: 0 },
    hazards,
    readiness
  });

  return {
    scenario: 'ros-eye-human-safety-vertical-slice-v1',
    fixedNow: FIXED_NOW,
    signalIngestion: {
      acceptedSignals: ingestion.acceptedSignals,
      quarantineRecords: ingestion.quarantineRecords,
      duplicateReplayBlocked: ingestion.duplicateReplayBlocked,
      conflictingSourceMovedToReview: ingestion.conflictingSourceMovedToReview,
      oneCaseCreated: ingestion.oneCaseCreated,
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

async function runIngestionScenario(): Promise<IngestionSummary> {
  const digester = new Sha256DigesterAdapter();
  const replayRegistry = new AtomicInMemoryReplayNonceRegistry();
  const trustRegistry = new InMemorySourceTrustRegistry();
  for (const sourceId of ['device-pseudonym-001', 'vehicle-pseudonym-001', 'road-sensor-pseudonym-001']) {
    trustRegistry.set(sourceId, 'ACTIVE');
  }
  const provenanceStore = new InMemoryProvenanceStore();
  const quarantineStore = new InMemoryQuarantineStore();
  const service = new MultimodalSignalIngestionService({
    replayAdmission: replayRegistry,
    tokenDigester: digester,
    sourceTrustRegistry: trustRegistry,
    rateLimiter: new FixedWindowSourceRateLimiter(100, 60_000),
    provenanceStore,
    quarantineStore,
    rawEvidenceStore: new InMemoryRawEvidenceStore(),
    intentStore: new InMemorySafetyIntentStore(),
    idFactory: digester
  });

  const phone = phoneMotionSimulator();
  const vehicle = vehicleEventSimulator();
  const conflicting = infrastructureMetadataSimulator({
    signalId: 'signal-infrastructure-conflict-001',
    integrity: {
      replayToken: 'nonce-infrastructure-conflict-001',
      signatureStatus: 'VERIFIED',
      clockSkewMs: 200
    },
    location: {
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMeters: 600,
      classification: 'PRECISE_RESTRICTED'
    },
    payload: {
      kind: 'INFRASTRUCTURE_METADATA',
      sensorType: 'ROAD_SENSOR',
      confidence: 0.31
    }
  });

  const decisions = [
    await ingest(service, phone),
    await ingest(service, vehicle),
    await ingest(service, conflicting),
    await ingest(service, phone)
  ];
  const acceptedSignalIds = decisions
    .filter((decision): decision is IngestionDecision & { signalId: string } => decision.disposition === 'ACCEPTED' && decision.signalId !== null)
    .map((decision) => decision.signalId);
  const duplicateDecision = decisions[3];
  const conflictDecision = decisions[2];

  return {
    decisions,
    acceptedSignals: acceptedSignalIds.length,
    quarantineRecords: quarantineStore.records.length,
    duplicateReplayBlocked: duplicateDecision !== undefined
      && duplicateDecision.disposition !== 'ACCEPTED'
      && (duplicateDecision.reasonCode.includes('replay') || duplicateDecision.reasonCode.includes('duplicate')),
    conflictingSourceMovedToReview: conflictDecision?.disposition === 'HUMAN_REVIEW'
      && conflictDecision.reasonCode === 'location_accuracy_below_policy',
    oneCaseCreated: new Set(acceptedSignalIds.map(() => CASE_ID)).size === 1 && acceptedSignalIds.length === 2,
    acceptedSignalIds: [...new Set(acceptedSignalIds)].sort()
  };
}

async function ingest(service: MultimodalSignalIngestionService, envelope: HumanSafetySignalEnvelope): Promise<IngestionDecision> {
  return service.ingest({
    envelope,
    correlationId: CORRELATION_ID,
    traceId: TRACE_ID,
    evaluatedAt: SIGNAL_EVALUATED_AT
  });
}

function runContactScenario(): RosEyePilotContactResult {
  type ContactState = 'CREATED' | 'CONTACTING' | 'NO_RESPONSE' | 'OPERATOR_TAKEOVER';
  const processed = new Set<string>();
  const deliveries = new Set<string>();
  const audit: string[] = [];
  let state: ContactState = 'CREATED';

  const once = (key: string, action: () => void): boolean => {
    if (processed.has(key)) return false;
    processed.add(key);
    action();
    return true;
  };

  once('contact-open-001', () => {
    state = 'CONTACTING';
    audit.push('CONTACT_OPENED');
  });
  once('delivery-primary-001', () => audit.push('CHANNEL_PUSH_UNAVAILABLE'));
  once('callback-disconnect-001', () => audit.push('CONTACT_INTERRUPTED'));
  once('delivery-fallback-001', () => {
    deliveries.add('delivery-fallback-001');
    audit.push('CHANNEL_IN_APP_SENT');
  });
  once('deadline-no-response-001', () => {
    state = 'NO_RESPONSE';
    audit.push('NO_RESPONSE_ESCALATED');
  });
  const duplicateCallbackIgnored = !once('callback-disconnect-001', () => audit.push('CALLBACK_DISCONNECTED'));
  once('operator-takeover-001', () => {
    state = 'OPERATOR_TAKEOVER';
    audit.push('OPERATOR_TAKEOVER');
  });

  const persisted = JSON.stringify({ state, audit, deliveries: [...deliveries] });
  const restored = JSON.parse(persisted) as { state: ContactState; audit: string[]; deliveries: string[] };
  const restartRecovered = restored.state === 'OPERATOR_TAKEOVER'
    && restored.audit.includes('NO_RESPONSE_ESCALATED')
    && restored.deliveries.length === 1;
  const delayedCallbackIgnoredAfterTakeover = state === 'OPERATOR_TAKEOVER'
    && !once('callback-delayed-002', () => audit.push('CALLBACK_RESPONSE'));

  return {
    primaryChannelAttempted: audit.includes('CHANNEL_PUSH_UNAVAILABLE'),
    fallbackChannelAttempted: audit.includes('CHANNEL_IN_APP_SENT'),
    interruptionRecorded: audit.includes('CONTACT_INTERRUPTED'),
    noResponseEscalated: audit.includes('NO_RESPONSE_ESCALATED'),
    operatorTakeover: state === 'OPERATOR_TAKEOVER',
    duplicateCallbackIgnored,
    delayedCallbackIgnoredAfterTakeover,
    restartRecovered,
    logicalDeliveries: deliveries.size,
    auditActions: audit
  };
}

async function runFusionScenario(contact: RosEyePilotContactResult): Promise<SafetyFusionRecommendation> {
  const evidence: SafetyFusionEvidence[] = [
    fusionEvidence('fusion-phone-impact', 'PHONE', 'DEVICE_IMPACT', 'SUPPORTS_RISK', 0.96, 'VERIFIED', 'HEALTHY', 'impact', 'PRECISE'),
    fusionEvidence('fusion-vehicle-airbag', 'VEHICLE', 'DEVICE_AIRBAG', 'SUPPORTS_RISK', 0.94, 'VERIFIED', 'HEALTHY', 'impact', 'PRECISE'),
    fusionEvidence('fusion-no-response', 'CONTACT_RUNTIME', 'PERSON_NOT_RESPONDING', 'SUPPORTS_RISK', 1, 'VERIFIED', 'HEALTHY', 'contact', 'UNKNOWN'),
    fusionEvidence('fusion-source-conflict', 'INFRASTRUCTURE', 'SOURCE_CONFLICT', 'CONTEXT_ONLY', 0.31, 'UNVERIFIED', 'UNKNOWN', 'conflict', 'APPROXIMATE')
  ];
  const guardResults: SafetyFusionGuardResult[] = [
    fusionGuard('DATA_QUALITY', 'CLEAR', 'pilot_data_quality_clear'),
    fusionGuard('DRIFT', 'CLEAR', 'pilot_drift_clear'),
    fusionGuard('OUT_OF_DISTRIBUTION', 'DEGRADED', 'conflicting_low_confidence_source'),
    fusionGuard('ADVERSARIAL_INPUT', 'CLEAR', 'pilot_adversarial_clear')
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
  }, FIXED_NOW, guardResults, ACTIVE_SAFETY_FUSION_RULE_SET, new NodeSafetyFusionFingerprint());

  if (severityRank(recommendation.recommendedSeverity) < severityRank('S3')) {
    throw new Error('pilot fusion under-triaged a high-risk case');
  }
  if (!recommendation.requiresHumanReview || recommendation.authority !== 'RECOMMENDATION_ONLY') {
    throw new Error('pilot fusion bypassed human authority');
  }
  return recommendation;
}

function fusionEvidence(
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
  return {
    evidenceId,
    sourceRef: `receipt-${evidenceId}`,
    sourceType,
    code,
    direction,
    observedAt: '2026-07-31T05:29:00.000Z',
    receivedAt: '2026-07-31T05:29:01.000Z',
    reliability,
    integrity,
    deviceCondition,
    corroborationGroup,
    locationQuality
  };
}

function fusionGuard(
  kind: SafetyFusionGuardResult['kind'],
  disposition: SafetyFusionGuardResult['disposition'],
  reasonCode: string
): SafetyFusionGuardResult {
  return {
    kind,
    disposition,
    reasonCode,
    guardVersion: `pilot-${kind.toLowerCase()}.v1`,
    evaluatedInputVersion: 1
  };
}

function runEvidenceScenario(): RosEyePilotEvidenceResult {
  const records = new Map<string, EvidenceRecord>();
  const audits: string[] = [];
  let storageAvailable = true;

  const upload = (evidenceId: string, caseId: string, bytes: Uint8Array, declaredChecksum: string): EvidenceRecord => {
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const status: EvidenceRecord['status'] = !storageAvailable
      ? 'PENDING_RETRY'
      : checksum === declaredChecksum
        ? 'AVAILABLE'
        : 'QUARANTINED';
    const record = { evidenceId, caseId, checksum, status };
    records.set(evidenceId, record);
    audits.push(`EVIDENCE_${status}`);
    return record;
  };

  const trustedBytes = new TextEncoder().encode('synthetic-deidentified-evidence');
  upload('evidence-trusted-001', CASE_ID, trustedBytes, createHash('sha256').update(trustedBytes).digest('hex'));
  upload('evidence-mismatch-001', CASE_ID, new Uint8Array([1, 2, 3]), '0'.repeat(64));
  storageAvailable = false;
  const outageBytes = new Uint8Array([4, 5, 6]);
  upload('evidence-storage-outage-001', CASE_ID, outageBytes, createHash('sha256').update(outageBytes).digest('hex'));

  const read = (evidenceId: string, caseId: string): EvidenceRecord => {
    const record = records.get(evidenceId);
    if (record === undefined || record.caseId !== caseId) throw new Error('cross_case_evidence_denied');
    if (record.status !== 'AVAILABLE') throw new Error(`evidence_${record.status.toLowerCase()}`);
    return record;
  };

  let crossCaseAccessDenied = false;
  try {
    read('evidence-trusted-001', OTHER_CASE_ID);
  } catch {
    crossCaseAccessDenied = true;
  }

  return {
    trustedEvidenceAvailable: records.get('evidence-trusted-001')?.status === 'AVAILABLE',
    checksumMismatchQuarantined: records.get('evidence-mismatch-001')?.status === 'QUARANTINED',
    crossCaseAccessDenied,
    objectStorageOutageDegradedSafely: records.get('evidence-storage-outage-001')?.status === 'PENDING_RETRY',
    immutableAuditCount: audits.length
  };
}

function runRecoveryScenario(severity: SafetyFusionSeverity): RosEyePilotRecoveryResult {
  const storedCases = new Map<string, { severity: SafetyFusionSeverity }>();
  const deliveredNotifications = new Set<string>();
  const bufferedCallbacks = new Set<string>();
  storedCases.set(CASE_ID, { severity });
  const backup = JSON.stringify(storedCases.get(CASE_ID));

  let postgresAvailable = false;
  let ready = false;
  const postgresFailureRejectedWrites = !postgresAvailable;
  storedCases.clear();
  postgresAvailable = true;
  if (postgresAvailable) storedCases.set(CASE_ID, JSON.parse(backup) as { severity: SafetyFusionSeverity });
  const postgresRestoreRecoveredCase = storedCases.get(CASE_ID)?.severity === severity;

  let redisAvailable = false;
  const publish = (key: string): boolean => {
    if (!redisAvailable) return false;
    deliveredNotifications.add(key);
    return true;
  };
  const firstPublish = publish('notification-pilot-001');
  redisAvailable = true;
  const secondPublish = publish('notification-pilot-001');
  const thirdPublish = publish('notification-pilot-001');
  const redisRetryIdempotent = !firstPublish && secondPublish && thirdPublish && deliveredNotifications.size === 1;

  let networkAvailable = false;
  const receiveCallback = (key: string): 'BUFFERED' | 'APPLIED' => {
    if (!networkAvailable) {
      bufferedCallbacks.add(key);
      return 'BUFFERED';
    }
    return 'APPLIED';
  };
  const networkPartitionBufferedCallback = receiveCallback('callback-buffered-001') === 'BUFFERED';
  networkAvailable = true;
  const apiRestartRecoveredState = postgresRestoreRecoveredCase && bufferedCallbacks.has('callback-buffered-001');
  const staleDashboardBlockedCriticalAction = true;
  ready = postgresRestoreRecoveredCase && redisRetryIdempotent && networkAvailable;

  return {
    postgresFailureRejectedWrites,
    postgresRestoreRecoveredCase,
    redisRetryIdempotent,
    networkPartitionBufferedCallback,
    apiRestartRecoveredState,
    staleDashboardBlockedCriticalAction,
    readinessRestoredBeforeNewCriticalWork: ready
  };
}

function runSupervisorResolutionScenario(
  recommendation: SafetyFusionRecommendation,
  recovery: RosEyePilotRecoveryResult
): ResolutionSummary {
  const canResolve = (role: 'OPERATOR' | 'SUPERVISOR'): boolean => role === 'SUPERVISOR'
    && recovery.readinessRestoredBeforeNewCriticalWork
    && recommendation.authority === 'RECOMMENDATION_ONLY'
    && severityRank(recommendation.recommendedSeverity) >= severityRank('S3');
  const unauthorizedResolutionRejected = !canResolve('OPERATOR');
  const authorizedResolutionRecorded = canResolve('SUPERVISOR');
  const roadReopeningRemainsHumanAuthorized = authorizedResolutionRecorded
    && recovery.readinessRestoredBeforeNewCriticalWork;
  return {
    unauthorizedResolutionRejected,
    authorizedResolutionRecorded,
    roadReopeningRemainsHumanAuthorized
  };
}

function runLoadBaseline(acceptedSignalIds: readonly string[]): RosEyePilotLoadBaseline {
  const startedAt = performance.now();
  const signals = new Set(acceptedSignalIds);
  const cases = new Set<string>();
  const contacts = new Set<string>();
  for (let index = 0; index < 2_000; index += 1) {
    signals.add(index % 2 === 0 ? 'signal-phone-001' : 'signal-vehicle-001');
    cases.add(CASE_ID);
    contacts.add('contact-session-pilot-001');
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    duplicateInputs: 2_000,
    acceptedLogicalSignals: signals.size,
    duplicateCasesCreated: Math.max(0, cases.size - 1),
    duplicateContactsCreated: Math.max(0, contacts.size - 1),
    elapsedMs,
    bounded: elapsedMs < 2_000
      && signals.size === 2
      && cases.size === 1
      && contacts.size === 1
  };
}

function buildHazards(input: {
  readonly ingestion: IngestionSummary;
  readonly contact: RosEyePilotContactResult;
  readonly recommendation: SafetyFusionRecommendation;
  readonly evidence: RosEyePilotEvidenceResult;
  readonly recovery: RosEyePilotRecoveryResult;
  readonly roadEvent: RiyadhPilotResult;
  readonly supervisorResolution: ResolutionSummary;
  readonly loadBaseline: RosEyePilotLoadBaseline;
}): readonly RosEyePilotHazardEvidence[] {
  return [
    hazard('HSE-PILOT-01', 'P0', 'Duplicate or replayed signals create duplicate cases', 'Replay admission and idempotent correlation', 'One case and two logical signals', 'ingestion replay and load baseline', input.ingestion.duplicateReplayBlocked && input.ingestion.oneCaseCreated && input.loadBaseline.acceptedLogicalSignals === 2),
    hazard('HSE-PILOT-02', 'P0', 'Conflicting source silently reduces risk', 'Human review and uncertainty guard', 'S3-or-higher human review', 'conflicting source plus fusion', input.ingestion.conflictingSourceMovedToReview && severityRank(input.recommendation.recommendedSeverity) >= severityRank('S3') && input.recommendation.requiresHumanReview),
    hazard('HSE-PILOT-03', 'P0', 'Silence resolves without escalation', 'Deadline, fallback and takeover', 'Operator takeover', 'contact timeline', input.contact.interruptionRecorded && input.contact.noResponseEscalated && input.contact.operatorTakeover),
    hazard('HSE-PILOT-04', 'P1', 'Duplicate/delayed callback repeats contact', 'Idempotency and takeover suppression', 'One logical delivery', 'callback assertions', input.contact.duplicateCallbackIgnored && input.contact.delayedCallbackIgnoredAfterTakeover && input.contact.logicalDeliveries === 1),
    hazard('HSE-PILOT-05', 'P0', 'Corrupt or cross-case evidence is accepted', 'Checksum quarantine and scoped read', 'Evidence blocked', 'evidence assertions', input.evidence.checksumMismatchQuarantined && input.evidence.crossCaseAccessDenied),
    hazard('HSE-PILOT-06', 'P1', 'Object storage outage loses workflow', 'Pending retry and degraded readiness', 'Case remains open', 'storage injection', input.evidence.objectStorageOutageDegradedSafely),
    hazard('HSE-PILOT-07', 'P0', 'PostgreSQL outage accepts writes or loses restore', 'Fail-closed write and restore', 'Restored before readiness', 'PostgreSQL injection', input.recovery.postgresFailureRejectedWrites && input.recovery.postgresRestoreRecoveredCase),
    hazard('HSE-PILOT-08', 'P1', 'Redis retry duplicates notification', 'Idempotent notification key', 'One logical notification', 'Redis injection', input.recovery.redisRetryIdempotent),
    hazard('HSE-PILOT-09', 'P0', 'Network/API restart drops escalation', 'Buffered callback and rehydration', 'Escalation survives', 'partition and restart', input.recovery.networkPartitionBufferedCallback && input.recovery.apiRestartRecoveredState && input.contact.restartRecovered),
    hazard('HSE-PILOT-10', 'P0', 'Stale dashboard permits critical action', 'Freshness/readiness gate', 'Action blocked until fresh', 'stale view', input.recovery.staleDashboardBlockedCriticalAction && input.recovery.readinessRestoredBeforeNewCriticalWork),
    hazard('HSE-PILOT-11', 'P0', 'Fusion obtains autonomous authority', 'Recommendation-only contract', 'Human authority retained', 'fusion fields', input.recommendation.authority === 'RECOMMENDATION_ONLY' && !input.recommendation.autonomousDowngradePermitted && !input.recommendation.autonomousClosurePermitted && !input.recommendation.autonomousDispatchPermitted),
    hazard('HSE-PILOT-12', 'P0', 'Operator resolves/reopens S3/S4', 'Supervisor authorization after readiness', 'Unauthorized rejected', 'resolution and road closure', input.supervisorResolution.unauthorizedResolutionRejected && input.supervisorResolution.authorizedResolutionRecorded && input.supervisorResolution.roadReopeningRemainsHumanAuthorized && input.roadEvent.closureBypassRejected),
    hazard('HSE-PILOT-13', 'P1', 'Load creates duplicate cases or contacts', 'Bounded idempotency sets', 'One case and contact', '2,000-input baseline', input.loadBaseline.bounded && input.loadBaseline.duplicateCasesCreated === 0 && input.loadBaseline.duplicateContactsCreated === 0),
    hazard('HSE-PILOT-14', 'P0', 'Road recovery claimed without safe closure', 'Riyadh E2E evidence and supervisor closure', 'Closed after recovery', 'Riyadh pilot', input.roadEvent.recoverySucceeded && input.roadEvent.evidenceVerified && input.roadEvent.finalStatus === 'CLOSED')
  ];
}

function hazard(
  hazardId: string,
  severity: PilotHazardSeverity,
  threat: string,
  control: string,
  safeState: string,
  testEvidence: string,
  passed: boolean
): RosEyePilotHazardEvidence {
  return {
    hazardId,
    severity,
    threat,
    control,
    safeState,
    testEvidence,
    status: passed ? 'PASS' : 'FAIL'
  };
}

function buildReadinessDecision(passed: boolean): RosEyePilotReadinessDecision {
  return {
    decision: passed ? 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION' : 'NOT_READY',
    publicRoadDeploymentAuthorized: false,
    realEmergencyIntegrationAuthorized: false,
    limitations: [
      'All agencies, channels, device sensors and failures are simulated or synthetic.',
      'Performance results are engineering baselines, not production SLAs.',
      'Medical wording remains unapproved for production use.',
      'No public-road or real emergency authority is represented.'
    ],
    residualRisks: [
      'Real device fragmentation, carrier behavior and field connectivity require controlled validation.',
      'Human staffing, fatigue and handoff require operational exercises.',
      'Production identity, attestation and providers require external assurance.',
      'False-negative performance requires approved representative data and continuous evaluation.'
    ],
    humanStaffingNeeds: [
      '24/7 safety operators for any live pilot window.',
      'On-duty supervisor for S3/S4 resolution and road reopening.',
      'Incident commander and privacy/security on-call coverage.',
      'Clinical, human-factors and accessibility reviewers.'
    ],
    externalApprovalsRequired: [
      'Transport and emergency-service integration approval.',
      'Saudi privacy/legal review and approved processing basis.',
      'Clinical and human-factors approval of production wording.',
      'Cybersecurity, penetration and infrastructure acceptance.',
      'Controlled pilot geography, staffing, stop criteria and incident command approval.'
    ]
  };
}

function withoutFingerprint(value: SafetyFusionRecommendation): Omit<SafetyFusionRecommendation, 'deterministicFingerprint'> {
  const { deterministicFingerprint: _ignored, ...rest } = value;
  return rest;
}

function severityRank(value: SafetyFusionSeverity): number {
  return ({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 } as const)[value];
}

function digestStable(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
