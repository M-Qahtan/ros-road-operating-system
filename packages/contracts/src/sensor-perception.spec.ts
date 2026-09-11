import {
  SENSOR_OBSERVATION_SCHEMA,
  assessSensorObservationAdmission,
  type SensorObservationEnvelope,
} from './sensor-perception.js';
import {
  compareProtectedOutcomesLexicographically,
  cognitiveStateRequiresAbstention,
  COGNITIVE_ROAD_STATE_SCHEMA,
  type CognitiveRoadState,
  type ProtectedOutcomeVector,
} from './cognitive-road-state.js';
import {
  SAUDI_ROAD_SAFETY_PROFILE,
  validateSaudiExportRecord,
  type SaudiCrashExportRecord,
} from './saudi-road-safety.js';
import {
  EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
  comparePerceptionBenchmarks,
  type PerceptionBenchmarkCase,
} from './perception-benchmark.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const NOW = Date.parse('2026-09-11T06:30:00+03:00');
const digest = 'a'.repeat(64);

function makeObservation(overrides: Partial<SensorObservationEnvelope> = {}): SensorObservationEnvelope {
  const base: SensorObservationEnvelope = {
    schema: SENSOR_OBSERVATION_SCHEMA,
    observationId: 'obs-001',
    sourceId: 'RUH-Z41-LIDAR-01',
    sourceClass: 'LIDAR_4D',
    capturedAt: '2026-09-11T06:29:59.800+03:00',
    receivedAt: '2026-09-11T06:29:59.900+03:00',
    sourceSequence: 42,
    timing: {
      estimatedClockErrorMs: 5,
      transportLatencyMs: 100,
      freshnessTtlMs: 2_000,
      timeSource: 'PTP',
    },
    frame: {
      frameId: 'RUH-Z41-LIDAR-01',
      coordinateSystem: 'EPSG:4978',
      transformDigest: digest,
    },
    calibration: {
      state: 'VALID',
      calibrationId: 'cal-001',
      calibrationDigest: digest,
      calibratedAt: '2026-09-01T00:00:00Z',
    },
    health: {
      state: 'HEALTHY',
      score: 0.99,
      metrics: [],
      degradationCauses: [],
      assessedAt: '2026-09-11T06:29:59.900+03:00',
    },
    provenance: {
      manufacturer: 'TEST',
      deviceModel: 'SIM-4D',
      adapterName: 'ros-test-adapter',
      adapterVersion: '1.0.0',
      rawPayloadSha256: digest,
      normalizedPayloadSha256: digest,
      jurisdiction: 'SA-RIYADH',
      purpose: 'road-safety-response',
      parentObservationIds: [],
    },
    payload: {
      kind: 'LIDAR_4D_FRAME',
      pointCloud: {
        uri: 'object://test/point-cloud-001',
        sha256: digest,
        byteLength: 1_024,
        encoding: 'pointcloud2',
      },
      pointCount: 128,
      measuredRadialVelocityAvailable: true,
      measuredVelocityReferenceFrame: 'sensor',
    },
  };

  return { ...base, ...overrides } as SensorObservationEnvelope;
}

const accepted = assessSensorObservationAdmission(makeObservation(), NOW);
assert(accepted.disposition === 'ACCEPT', 'healthy fresh observation must be accepted');
assert(accepted.authority === 'NONE', 'sensor observations must never carry operational authority');

const stale = assessSensorObservationAdmission(
  makeObservation({ capturedAt: '2026-09-11T06:29:50+03:00' }),
  NOW,
);
assert(stale.disposition === 'CONTEXT_ONLY', 'stale observation must not update current state');
assert(stale.usableForCurrentState === false, 'stale observation must be excluded from current state');

const degraded = assessSensorObservationAdmission(
  makeObservation({
    health: {
      state: 'DEGRADED',
      score: 0.63,
      metrics: [{ name: 'occlusion_ratio', value: 0.31 }],
      degradationCauses: ['PARTIAL_OCCLUSION'],
      assessedAt: '2026-09-11T06:29:59.900+03:00',
    },
  }),
  NOW,
);
assert(degraded.disposition === 'DEGRADED_USABLE', 'degraded sensor should not crash or silently pass as healthy');
assert(degraded.requiresCorroboration, 'degraded sensor must request corroboration');

const invalidCalibration = assessSensorObservationAdmission(
  makeObservation({ calibration: { state: 'INVALID' } }),
  NOW,
);
assert(invalidCalibration.disposition === 'QUARANTINE', 'invalid calibration must fail closed');

const forgedFuture = assessSensorObservationAdmission(
  makeObservation({ capturedAt: '2026-09-11T06:31:00+03:00' }),
  NOW,
);
assert(forgedFuture.disposition === 'QUARANTINE', 'material future timestamp must fail closed');

const missingProvenance = assessSensorObservationAdmission(
  makeObservation({
    provenance: {
      adapterName: '',
      adapterVersion: '',
      rawPayloadSha256: 'bad',
      normalizedPayloadSha256: digest,
      jurisdiction: '',
      purpose: '',
      parentObservationIds: [],
    },
  }),
  NOW,
);
assert(missingProvenance.disposition === 'QUARANTINE', 'missing/invalid provenance must fail closed');

const unavailable = assessSensorObservationAdmission(
  makeObservation({
    health: {
      state: 'UNAVAILABLE',
      score: 0,
      metrics: [],
      degradationCauses: ['POWER_DEGRADATION'],
      assessedAt: '2026-09-11T06:29:59.900+03:00',
    },
  }),
  NOW,
);
assert(unavailable.disposition === 'QUARANTINE', 'unavailable sensor must be quarantined from current cognition');

const safe: ProtectedOutcomeVector = {
  humanSafetyRisk: 1,
  emergencyAccessRisk: 1,
  secondaryIncidentRisk: 1,
  evidenceIntegrityRisk: 0,
  authorityPrivacyRisk: 0,
  criticalNetworkResilienceRisk: 1,
  mobilityCost: 9,
  delayCost: 10,
  efficiencyCost: 10,
};
const fastButLessSafe: ProtectedOutcomeVector = {
  ...safe,
  humanSafetyRisk: 2,
  mobilityCost: 1,
  delayCost: 1,
  efficiencyCost: 1,
};
assert(
  compareProtectedOutcomesLexicographically(safe, fastButLessSafe) === -1,
  'mobility gains must not compensate for worse human safety',
);

const contradictoryState: CognitiveRoadState = {
  schema: COGNITIVE_ROAD_STATE_SCHEMA,
  crsId: 'crs-001',
  zoneId: 'RUH-Z41',
  stateTime: '2026-09-11T06:30:00+03:00',
  validUntil: '2026-09-11T06:30:02+03:00',
  stateDigest: digest,
  sensorHealthDigest: digest,
  entities: [],
  hazards: [],
  trafficState: {},
  environment: {},
  signalState: {},
  infrastructureState: {},
  evidenceObservationIds: ['obs-001', 'obs-002'],
  contradictions: [{
    contradictionId: 'con-001',
    observationIds: ['obs-001', 'obs-002'],
    material: true,
    reason: 'RADAR_LIDAR_DISAGREEMENT',
  }],
  epistemicSummary: { known: [], uncertain: ['hazard-presence'], unknown: [] },
};
assert(cognitiveStateRequiresAbstention(contradictoryState), 'material CRS contradiction must require abstention');

const saCrash: SaudiCrashExportRecord = {
  profile: SAUDI_ROAD_SAFETY_PROFILE,
  recordType: 'CRASH_EVENT',
  eventId: 'INC-RUH-001',
  occurredAt: '2026-09-11T06:29:00+03:00',
  location: { latitude: 24.7136, longitude: 46.6753, laneContext: ['L2'] },
  classification: {
    rosType: 'COLLISION',
    localAuthorityCode: null,
    severity: 'S3',
    confidence: 0.9,
    legalViolationConfirmed: false,
  },
  environment: {},
  participants: { vehicles: 2, pedestrians: 0, vulnerableRoadUsers: 0 },
  evidenceSummary: { independentSources: 3, contradictions: 0, manifestId: 'EVM-001' },
  lifecycle: { detectedAt: '2026-09-11T06:29:01+03:00' },
  privacy: {
    purpose: 'road-safety-analysis',
    legalBasis: 'APPROVED_BASIS_REFERENCE',
    dataClassification: 'RESTRICTED',
    retentionPolicy: 'SAFETY_EVENT_POLICY',
    jurisdiction: 'SA',
    controller: 'ROS-TEST-CONTROLLER',
    allowedRecipients: [],
    crossBorderStatus: 'LOCAL_ONLY',
  },
};
assert(validateSaudiExportRecord(saCrash).length === 0, 'valid Saudi canonical export must pass');

const benchmarkBase: PerceptionBenchmarkCase = {
  schema: EXTREME_ENVIRONMENT_BENCHMARK_SCHEMA,
  scenarioId: 'EEPB-E04-RGB',
  stack: 'RGB_ONLY',
  environment: { stressConditions: ['SANDSTORM'], odd: {} },
  groundTruth: { source: 'independent-test-rig', independentOfSystemUnderTest: true, evidenceManifestId: 'GT-001' },
  metrics: {
    detectionPrecision: 0.8,
    detectionRecall: 0.7,
    positionRmseM: 1.2,
    velocityRmseMps: 1.0,
    trackContinuity: 0.7,
    falseTrackRate: 0.1,
    latencyP95Ms: 80,
    confidenceCalibrationError: 0.1,
    falseHazardAcceptanceRate: 0.02,
    missedHazardRate: 0.1,
    unsafeConfidenceRate: 0.01,
    authorityViolationCount: 0,
    evidenceCompleteness: 0.8,
  },
  protectedInvariantViolations: [],
  evidenceManifestId: 'R-001',
};
const fasterButUnsafe: PerceptionBenchmarkCase = {
  ...benchmarkBase,
  scenarioId: 'EEPB-E04-FUSION',
  stack: 'MULTIMODAL_FUSION',
  metrics: {
    ...benchmarkBase.metrics,
    latencyP95Ms: 20,
    falseHazardAcceptanceRate: 0.03,
  },
};
const comparison = comparePerceptionBenchmarks(benchmarkBase, fasterButUnsafe);
assert(comparison.protectedRegression, 'faster fusion must fail if protected safety metric regresses');

console.log(JSON.stringify({
  status: 'PASS',
  cases: 11,
  authorityInvariant: accepted.authority === 'NONE',
  staleExcluded: stale.usableForCurrentState === false,
  degradedRequiresCorroboration: degraded.requiresCorroboration,
  nonCompensableSafetyVerified: true,
  contradictionAbstentionVerified: true,
  saProfileValidated: true,
  protectedBenchmarkGateVerified: comparison.protectedRegression,
}));
