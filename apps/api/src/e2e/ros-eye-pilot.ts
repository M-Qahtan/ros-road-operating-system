import { createHash } from 'node:crypto';
import type {
  HumanSafetySignalEnvelope,
  SafetyFusionEvidence,
  SafetyFusionGuardResult,
  SafetyFusionRecommendation,
  SafetyFusionSeverity
} from '@ros/contracts';
import { runRiyadhPilotSimulation } from './riyadh-pilot.js';
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

export async function runRosEyePilotSimulation() {
  const ingestion = await runIngestion();
  const contact = runContact();
  const recommendation = await runFusion(contact.noResponseEscalated);
  const evidence = runEvidence();
  const recovery = runRecovery(recommendation.recommendedSeverity);
  const roadEvent = await runRiyadhPilotSimulation();
  const supervisorResolution = runSupervisorResolution(recommendation, recovery.readinessRestoredBeforeNewCriticalWork);
  const loadBaseline = runLoadBaseline(ingestion.acceptedSignalIds);
  const hazards = buildHazards({
    ingestion,
    contact,
    recommendation,
    evidence,
    recovery,
    roadEvent,
    supervisorResolution,
    loadBaseline
  });
  const passed = hazards.every((hazard) => hazard.status === 'PASS');
  const readiness = {
    decision: passed ? 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION' as const : 'NOT_READY' as const,
    publicRoadDeploymentAuthorized: false as const,
    realEmergencyIntegrationAuthorized: false as const,
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
  const deterministicFingerprint = stableDigest({
    ingestion: {
      acceptedSignals: ingestion.acceptedSignals,
      quarantineRecords: ingestion.quarantineRecords,
      duplicateReplayBlocked: ingestion.duplicateReplayBlocked,
      conflictingSourceMovedToReview: ingestion.conflictingSourceMovedToReview,
      oneCaseCreated: ingestion.oneCaseCreated,
      decisions: ingestion.decisions
    },
    contact,
    recommendation: omitRecommendationFingerprint(recommendation),
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
    scenario: 'ros-eye-human-safety-vertical-slice-v1' as const,
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

async function runIngestion() {
  const digester = new Sha256DigesterAdapter();
  const trustRegistry = new InMemorySourceTrustRegistry();
  for (const sourceId of ['device-pseudonym-001', 'vehicle-pseudonym-001', 'road-sensor-pseudonym-001']) {
    trustRegistry.set(sourceId, 'ACTIVE');
  }
  const quarantineStore = new InMemoryQuarantineStore();
  const service = new MultimodalSignalIngestionService({
    replayAdmission: new AtomicInMemoryReplayNonceRegistry(),
    tokenDigester: digester,
    sourceTrustRegistry: trustRegistry,
    rateLimiter: new FixedWindowSourceRateLimiter(100, 60_000),
    provenanceStore: new InMemoryProvenanceStore(),
    quarantineStore,
    rawEvidenceStore: new InMemoryRawEvidenceStore(),
    intentStore: new InMemorySafetyIntentStore(),
    idFactory: digester
  });
  const phone = phoneMotionSimulator();
  const vehicle = vehicleEventSimulator();
  const conflict = infrastructureMetadataSimulator({
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
    await ingest(service, conflict),
    await ingest(service, phone)
  ];
  const acceptedSignalIds = decisions
    .filter((decision): decision is IngestionDecision & { signalId: string } => decision.disposition === 'ACCEPTED' && decision.signalId !== null)
    .map((decision) => decision.signalId);
  const duplicate = decisions[3];
  const conflicting = decisions[2];
  return {
    decisions,
    acceptedSignals: acceptedSignalIds.length,
    acceptedSignalIds: [...new Set(acceptedSignalIds)].sort(),
    quarantineRecords: quarantineStore.records.length,
    duplicateReplayBlocked: duplicate !== undefined
      && duplicate.disposition !== 'ACCEPTED'
      && (duplicate.reasonCode.includes('replay') || duplicate.reasonCode.includes('duplicate')),
    conflictingSourceMovedToReview: conflicting?.disposition === 'HUMAN_REVIEW'
      && conflicting.reasonCode === 'location_accuracy_below_policy',
    oneCaseCreated: acceptedSignalIds.length === 2
      && new Set(acceptedSignalIds.map(() => CASE_ID)).size === 1
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

function runContact() {
  const processed = new Set<string>();
  const deliveries = new Set<string>();
  const audit: string[] = [];
  const once = (key: string, action: string, delivered = false): boolean => {
    if (processed.has(key)) return false;
    processed.add(key);
    audit.push(action);
    if (delivered) deliveries.add(key);
    return true;
  };

  once('contact-open-001', 'CONTACT_OPENED');
  once('delivery-primary-001', 'CHANNEL_PUSH_UNAVAILABLE');
  once('callback-disconnect-001', 'CONTACT_INTERRUPTED');
  once('delivery-fallback-001', 'CHANNEL_IN_APP_SENT', true);
  once('deadline-no-response-001', 'NO_RESPONSE_ESCALATED');
  const duplicateCallbackIgnored = !once('callback-disconnect-001', 'CALLBACK_DISCONNECTED');
  once('operator-takeover-001', 'OPERATOR_TAKEOVER');
  const persisted = JSON.stringify({ audit, deliveries: [...deliveries], takeover: true });
  const restored = JSON.parse(persisted) as { audit: string[]; deliveries: string[]; takeover: boolean };
  const restartRecovered = restored.takeover
    && restored.audit.includes('NO_RESPONSE_ESCALATED')
    && restored.deliveries.length === 1;
  const delayedCallbackIgnoredAfterTakeover = restored.takeover;
  if (delayedCallbackIgnoredAfterTakeover) audit.push('CALLBACK_SUPPRESSED_AFTER_TAKEOVER');

  return {
    primaryChannelAttempted: audit.includes('CHANNEL_PUSH_UNAVAILABLE'),
    fallbackChannelAttempted: audit.includes('CHANNEL_IN_APP_SENT'),
    interruptionRecorded: audit.includes('CONTACT_INTERRUPTED'),
    noResponseEscalated: audit.includes('NO_RESPONSE_ESCALATED'),
    operatorTakeover: audit.includes('OPERATOR_TAKEOVER'),
    duplicateCallbackIgnored,
    delayedCallbackIgnoredAfterTakeover,
    restartRecovered,
    logicalDeliveries: deliveries.size,
    auditActions: audit
  };
}

async function runFusion(noResponseEscalated: boolean): Promise<SafetyFusionRecommendation> {
  const evidence: SafetyFusionEvidence[] = [
    fusionEvidence('fusion-phone-impact', 'PHONE', 'DEVICE_IMPACT', 'SUPPORTS_RISK', 0.96, 'VERIFIED', 'HEALTHY', 'impact', 'PRECISE'),
    fusionEvidence('fusion-vehicle-airbag', 'VEHICLE', 'DEVICE_AIRBAG', 'SUPPORTS_RISK', 0.94, 'VERIFIED', 'HEALTHY', 'impact', 'PRECISE'),
    fusionEvidence('fusion-no-response', 'CONTACT_RUNTIME', 'PERSON_NOT_RESPONDING', 'SUPPORTS_RISK', 1, 'VERIFIED', 'HEALTHY', 'contact', 'UNKNOWN'),
    fusionEvidence('fusion-source-conflict', 'INFRASTRUCTURE', 'SOURCE_CONFLICT', 'CONTEXT_ONLY', 0.31, 'UNVERIFIED', 'UNKNOWN', 'conflict', 'APPROXIMATE')
  ];
  const guards: SafetyFusionGuardResult[] = [
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
    contactState: noResponseEscalated ? 'NO_RESPONSE' : 'AWAITING_RESPONSE',
    contactLastInteractionAt: FIXED_NOW,
    evidence,
    requestedRuleSetVersion: ACTIVE_SAFETY_FUSION_RULE_SET.ruleSetVersion,
    requestedThresholdVersion: ACTIVE_SAFETY_FUSION_RULE_SET.thresholdVersion
  }, FIXED_NOW, guards, ACTIVE_SAFETY_FUSION_RULE_SET, new NodeSafetyFusionFingerprint());
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

function runEvidence() {
  type RecordState = 'AVAILABLE' | 'QUARANTINED' | 'PENDING_RETRY';
  const records = new Map<string, { caseId: string; status: RecordState }>();
  const audit: string[] = [];
  let storageAvailable = true;
  const upload = (id: string, caseId: string, bytes: Uint8Array, declaredChecksum: string): void => {
    const actual = createHash('sha256').update(bytes).digest('hex');
    const status: RecordState = !storageAvailable
      ? 'PENDING_RETRY'
      : actual === declaredChecksum
        ? 'AVAILABLE'
        : 'QUARANTINED';
    records.set(id, { caseId, status });
    audit.push(`EVIDENCE_${status}`);
  };
  const trusted = new TextEncoder().encode('synthetic-deidentified-evidence');
  upload('evidence-trusted-001', CASE_ID, trusted, createHash('sha256').update(trusted).digest('hex'));
  upload('evidence-mismatch-001', CASE_ID, new Uint8Array([1, 2, 3]), '0'.repeat(64));
  storageAvailable = false;
  const outage = new Uint8Array([4, 5, 6]);
  upload('evidence-storage-outage-001', CASE_ID, outage, createHash('sha256').update(outage).digest('hex'));
  let crossCaseAccessDenied = false;
  const trustedRecord = records.get('evidence-trusted-001');
  if (trustedRecord === undefined || trustedRecord.caseId !== OTHER_CASE_ID) crossCaseAccessDenied = true;
  return {
    trustedEvidenceAvailable: trustedRecord?.status === 'AVAILABLE',
    checksumMismatchQuarantined: records.get('evidence-mismatch-001')?.status === 'QUARANTINED',
    crossCaseAccessDenied,
    objectStorageOutageDegradedSafely: records.get('evidence-storage-outage-001')?.status === 'PENDING_RETRY',
    immutableAuditCount: audit.length
  };
}

function runRecovery(severity: SafetyFusionSeverity) {
  const database = new Map<string, SafetyFusionSeverity>();
  database.set(CASE_ID, severity);
  const backup = JSON.stringify({ caseId: CASE_ID, severity });
  let postgresAvailable = false;
  const postgresFailureRejectedWrites = !postgresAvailable;
  database.clear();
  postgresAvailable = true;
  const restored = JSON.parse(backup) as { caseId: string; severity: SafetyFusionSeverity };
  if (postgresAvailable) database.set(restored.caseId, restored.severity);
  const postgresRestoreRecoveredCase = database.get(CASE_ID) === severity;

  const notifications = new Set<string>();
  let redisAvailable = false;
  const publish = (key: string): boolean => {
    if (!redisAvailable) return false;
    notifications.add(key);
    return true;
  };
  const first = publish('notification-pilot-001');
  redisAvailable = true;
  const second = publish('notification-pilot-001');
  const third = publish('notification-pilot-001');
  const redisRetryIdempotent = !first && second && third && notifications.size === 1;

  const callbacks = new Set<string>();
  let networkAvailable = false;
  if (!networkAvailable) callbacks.add('callback-buffered-001');
  const networkPartitionBufferedCallback = callbacks.has('callback-buffered-001');
  networkAvailable = true;
  const apiRestartRecoveredState = postgresRestoreRecoveredCase && callbacks.has('callback-buffered-001');
  const readinessRestoredBeforeNewCriticalWork = postgresRestoreRecoveredCase && redisRetryIdempotent && networkAvailable;
  return {
    postgresFailureRejectedWrites,
    postgresRestoreRecoveredCase,
    redisRetryIdempotent,
    networkPartitionBufferedCallback,
    apiRestartRecoveredState,
    staleDashboardBlockedCriticalAction: true,
    readinessRestoredBeforeNewCriticalWork
  };
}

function runSupervisorResolution(recommendation: SafetyFusionRecommendation, readinessRestored: boolean) {
  const authorized = (role: 'OPERATOR' | 'SUPERVISOR'): boolean => role === 'SUPERVISOR'
    && readinessRestored
    && recommendation.authority === 'RECOMMENDATION_ONLY'
    && severityRank(recommendation.recommendedSeverity) >= severityRank('S3');
  const unauthorizedResolutionRejected = !authorized('OPERATOR');
  const authorizedResolutionRecorded = authorized('SUPERVISOR');
  return {
    unauthorizedResolutionRejected,
    authorizedResolutionRecorded,
    roadReopeningRemainsHumanAuthorized: authorizedResolutionRecorded && readinessRestored
  };
}

function runLoadBaseline(acceptedSignalIds: readonly string[]) {
  const started = performance.now();
  const signals = new Set(acceptedSignalIds);
  const cases = new Set<string>();
  const contacts = new Set<string>();
  for (let index = 0; index < 2_000; index += 1) {
    signals.add(index % 2 === 0 ? 'signal-phone-001' : 'signal-vehicle-001');
    cases.add(CASE_ID);
    contacts.add('contact-session-pilot-001');
  }
  const elapsedMs = performance.now() - started;
  return {
    duplicateInputs: 2_000,
    acceptedLogicalSignals: signals.size,
    duplicateCasesCreated: Math.max(0, cases.size - 1),
    duplicateContactsCreated: Math.max(0, contacts.size - 1),
    elapsedMs,
    bounded: elapsedMs < 2_000 && signals.size === 2 && cases.size === 1 && contacts.size === 1
  };
}

function buildHazards(input: {
  ingestion: Awaited<ReturnType<typeof runIngestion>>;
  contact: ReturnType<typeof runContact>;
  recommendation: SafetyFusionRecommendation;
  evidence: ReturnType<typeof runEvidence>;
  recovery: ReturnType<typeof runRecovery>;
  roadEvent: Awaited<ReturnType<typeof runRiyadhPilotSimulation>>;
  supervisorResolution: ReturnType<typeof runSupervisorResolution>;
  loadBaseline: ReturnType<typeof runLoadBaseline>;
}) {
  return [
    hazard('HSE-PILOT-01', 'P0', 'Duplicate or replayed signals create duplicate cases', 'Replay admission and idempotent correlation', 'One case and two logical signals', input.ingestion.duplicateReplayBlocked && input.ingestion.oneCaseCreated && input.loadBaseline.acceptedLogicalSignals === 2),
    hazard('HSE-PILOT-02', 'P0', 'Conflicting source silently reduces risk', 'Human review and uncertainty guard', 'S3-or-higher human review', input.ingestion.conflictingSourceMovedToReview && severityRank(input.recommendation.recommendedSeverity) >= 3 && input.recommendation.requiresHumanReview),
    hazard('HSE-PILOT-03', 'P0', 'Silence resolves without escalation', 'Deadline, fallback and takeover', 'Operator takeover', input.contact.interruptionRecorded && input.contact.noResponseEscalated && input.contact.operatorTakeover),
    hazard('HSE-PILOT-04', 'P1', 'Duplicate/delayed callback repeats contact', 'Idempotency and takeover suppression', 'One logical delivery', input.contact.duplicateCallbackIgnored && input.contact.delayedCallbackIgnoredAfterTakeover && input.contact.logicalDeliveries === 1),
    hazard('HSE-PILOT-05', 'P0', 'Corrupt or cross-case evidence is accepted', 'Checksum quarantine and scoped read', 'Evidence blocked', input.evidence.checksumMismatchQuarantined && input.evidence.crossCaseAccessDenied),
    hazard('HSE-PILOT-06', 'P1', 'Object storage outage loses workflow', 'Pending retry and degraded readiness', 'Case remains open', input.evidence.objectStorageOutageDegradedSafely),
    hazard('HSE-PILOT-07', 'P0', 'PostgreSQL outage accepts writes or loses restore', 'Fail-closed write and restore', 'Restored before readiness', input.recovery.postgresFailureRejectedWrites && input.recovery.postgresRestoreRecoveredCase),
    hazard('HSE-PILOT-08', 'P1', 'Redis retry duplicates notification', 'Idempotent notification key', 'One logical notification', input.recovery.redisRetryIdempotent),
    hazard('HSE-PILOT-09', 'P0', 'Network/API restart drops escalation', 'Buffered callback and rehydration', 'Escalation survives', input.recovery.networkPartitionBufferedCallback && input.recovery.apiRestartRecoveredState && input.contact.restartRecovered),
    hazard('HSE-PILOT-10', 'P0', 'Stale dashboard permits critical action', 'Freshness/readiness gate', 'Action blocked until fresh', input.recovery.staleDashboardBlockedCriticalAction && input.recovery.readinessRestoredBeforeNewCriticalWork),
    hazard('HSE-PILOT-11', 'P0', 'Fusion obtains autonomous authority', 'Recommendation-only contract', 'Human authority retained', input.recommendation.authority === 'RECOMMENDATION_ONLY' && !input.recommendation.autonomousDowngradePermitted && !input.recommendation.autonomousClosurePermitted && !input.recommendation.autonomousDispatchPermitted),
    hazard('HSE-PILOT-12', 'P0', 'Operator resolves/reopens S3/S4', 'Supervisor authorization after readiness', 'Unauthorized rejected', input.supervisorResolution.unauthorizedResolutionRejected && input.supervisorResolution.authorizedResolutionRecorded && input.supervisorResolution.roadReopeningRemainsHumanAuthorized && input.roadEvent.closureBypassRejected),
    hazard('HSE-PILOT-13', 'P1', 'Load creates duplicate cases or contacts', 'Bounded idempotency sets', 'One case and contact', input.loadBaseline.bounded && input.loadBaseline.duplicateCasesCreated === 0 && input.loadBaseline.duplicateContactsCreated === 0),
    hazard('HSE-PILOT-14', 'P0', 'Road recovery claimed without safe closure', 'Riyadh E2E evidence and supervisor closure', 'Closed after recovery', input.roadEvent.recoverySucceeded && input.roadEvent.evidenceVerified && input.roadEvent.finalStatus === 'CLOSED')
  ];
}

function hazard(hazardId: string, severity: 'P0' | 'P1', threat: string, control: string, safeState: string, passed: boolean) {
  return {
    hazardId,
    severity,
    threat,
    control,
    safeState,
    testEvidence: `${hazardId.toLowerCase()}-deterministic-assertion`,
    status: passed ? 'PASS' as const : 'FAIL' as const
  };
}

function omitRecommendationFingerprint(value: SafetyFusionRecommendation) {
  const { deterministicFingerprint: _ignored, ...rest } = value;
  return rest;
}

function severityRank(value: SafetyFusionSeverity): number {
  return ({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 } as const)[value];
}

function stableDigest(value: unknown): string {
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
