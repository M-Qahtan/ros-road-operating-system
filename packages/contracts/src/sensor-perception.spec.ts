import {
  SENSOR_OBSERVATION_SCHEMA,
  assessSensorObservationAdmission,
  type SensorObservationEnvelope,
} from './sensor-perception.js';

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

console.log(JSON.stringify({
  status: 'PASS',
  cases: 7,
  authorityInvariant: accepted.authority === 'NONE',
  staleExcluded: stale.usableForCurrentState === false,
  degradedRequiresCorroboration: degraded.requiresCorroboration,
}));
