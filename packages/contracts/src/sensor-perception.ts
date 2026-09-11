export const SENSOR_OBSERVATION_SCHEMA = 'ros.sensor-observation/v1' as const;

export type SensorSourceClass =
  | 'RGB_CAMERA'
  | 'THERMAL_CAMERA'
  | 'RADAR'
  | 'LIDAR_3D'
  | 'LIDAR_4D'
  | 'MAGNETIC_SENSOR'
  | 'VEHICLE'
  | 'RSU'
  | 'WEATHER'
  | 'EXTERNAL_PERCEPTION_PLATFORM';

export type SensorHealthState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'QUARANTINED'
  | 'UNAVAILABLE';

export type CalibrationState =
  | 'VALID'
  | 'STALE'
  | 'UNKNOWN'
  | 'INVALID';

export type SensorDegradationCause =
  | 'GLARE'
  | 'LOW_LIGHT'
  | 'THERMAL_HAZE'
  | 'DUST'
  | 'SANDSTORM'
  | 'SMOKE'
  | 'FIRE_SATURATION'
  | 'PARTIAL_OCCLUSION'
  | 'DIRTY_APERTURE'
  | 'SIGNAL_NOISE'
  | 'CLOCK_DRIFT'
  | 'CALIBRATION_DRIFT'
  | 'PACKET_LOSS'
  | 'FRAME_DROP'
  | 'NETWORK_LATENCY'
  | 'POWER_DEGRADATION'
  | 'UNKNOWN';

export interface PayloadRef {
  readonly uri: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly encoding: string;
  readonly compression?: string;
  readonly contentType?: string;
}

export interface TimingQuality {
  readonly estimatedClockErrorMs: number;
  readonly transportLatencyMs: number;
  readonly freshnessTtlMs: number;
  readonly timeSource: string;
}

export interface SpatialFrame {
  readonly frameId: string;
  readonly coordinateSystem: string;
  readonly transformDigest: string;
  readonly covariance?: readonly number[];
}

export interface CalibrationReference {
  readonly state: CalibrationState;
  readonly calibrationId?: string;
  readonly calibrationDigest?: string;
  readonly calibratedAt?: string;
  readonly validUntil?: string;
}

export interface SensorHealthMetric {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
}

export interface SensorHealth {
  readonly state: SensorHealthState;
  readonly score: number;
  readonly metrics: readonly SensorHealthMetric[];
  readonly degradationCauses: readonly SensorDegradationCause[];
  readonly assessedAt: string;
}

export interface SourceProvenance {
  readonly manufacturer?: string;
  readonly deviceModel?: string;
  readonly firmwareVersion?: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly rawPayloadSha256: string;
  readonly normalizedPayloadSha256: string;
  readonly deviceIdentityDigest?: string;
  readonly signerKeyId?: string;
  readonly jurisdiction: string;
  readonly purpose: string;
  readonly parentObservationIds: readonly string[];
}

export interface CameraFrameObservation {
  readonly kind: 'CAMERA_FRAME';
  readonly image: PayloadRef;
  readonly width: number;
  readonly height: number;
  readonly exposureUs?: number;
  readonly frameRateHz?: number;
}

export interface ThermalFrameObservation {
  readonly kind: 'THERMAL_FRAME';
  readonly image: PayloadRef;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly radiometric: boolean;
  readonly minTemperatureC?: number;
  readonly maxTemperatureC?: number;
  readonly pairedVisualObservationId?: string;
  readonly thermalCalibrationDigest?: string;
}

export interface RadarDetection {
  readonly detectionId: string;
  readonly rangeM: number;
  readonly azimuthRad: number;
  readonly elevationRad?: number;
  readonly measuredRadialVelocityMps: number;
  readonly signalToNoiseDb?: number;
  readonly covariance?: readonly number[];
}

export interface RadarFrameObservation {
  readonly kind: 'RADAR_FRAME';
  readonly detections: readonly RadarDetection[];
}

export interface MagneticObservation {
  readonly kind: 'MAGNETIC_PRESENCE';
  readonly laneId: string;
  readonly presence: boolean;
  readonly occupancySeconds?: number;
  readonly roadTemperatureC?: number;
  readonly detectionConfidence: number;
}

export interface Lidar4DObservation {
  readonly kind: 'LIDAR_4D_FRAME';
  readonly pointCloud: PayloadRef;
  readonly pointCount: number;
  readonly horizontalFovDeg?: number;
  readonly verticalFovDeg?: number;
  /**
   * True only when the sensor directly measures a per-return radial velocity.
   * A full object velocity vector belongs in TrackObservation and remains an estimate.
   */
  readonly measuredRadialVelocityAvailable: boolean;
  readonly measuredVelocityReferenceFrame?: string;
}

export interface EstimatedKinematicState {
  readonly positionM: readonly [number, number, number];
  readonly estimatedVelocityMps: readonly [number, number, number];
  readonly estimatedAccelerationMps2?: readonly [number, number, number];
  readonly covariance: readonly number[];
  readonly estimator: string;
}

export interface TrackObservation {
  readonly kind: 'TRACK_SET';
  readonly tracks: readonly {
    readonly trackId: string;
    readonly objectClass: string;
    readonly state: EstimatedKinematicState;
    readonly laneId?: string;
    readonly roadSegmentId?: string;
    readonly confidence: number;
    readonly supportingObservationIds: readonly string[];
  }[];
}

export type V2XMessageType = 'BSM' | 'SPAT' | 'MAP' | 'CPM' | 'CAM' | 'DENM' | 'SENSOR_SHARING';

export interface V2XObservation {
  readonly kind: 'V2X_MESSAGE';
  readonly standardsFamily: string;
  readonly standardsVersion: string;
  readonly messageType: V2XMessageType;
  readonly originalPayload: PayloadRef;
  readonly originalPayloadSha256: string;
  readonly certificateDigest?: string;
  readonly securityValidationStatus: 'VALID' | 'INVALID' | 'UNKNOWN';
  readonly canonicalDecoded: Readonly<Record<string, unknown>>;
}

export interface EnvironmentalObservation {
  readonly kind: 'ENVIRONMENT';
  readonly visibilityMeters?: number;
  readonly ambientTemperatureC?: number;
  readonly relativeHumidityPct?: number;
  readonly windSpeedMps?: number;
  readonly precipitationMmPerHour?: number;
  readonly dustConcentrationUgM3?: number;
  readonly roadSurfaceTemperatureC?: number;
}

export type SensorObservationPayload =
  | CameraFrameObservation
  | ThermalFrameObservation
  | RadarFrameObservation
  | MagneticObservation
  | Lidar4DObservation
  | TrackObservation
  | V2XObservation
  | EnvironmentalObservation;

export interface SensorObservationEnvelope {
  readonly schema: typeof SENSOR_OBSERVATION_SCHEMA;
  readonly observationId: string;
  readonly sourceId: string;
  readonly sourceClass: SensorSourceClass;
  readonly capturedAt: string;
  readonly receivedAt: string;
  readonly sourceSequence: number;
  readonly timing: TimingQuality;
  readonly frame: SpatialFrame;
  readonly calibration: CalibrationReference;
  readonly health: SensorHealth;
  readonly provenance: SourceProvenance;
  readonly payload: SensorObservationPayload;
}

export type ObservationAdmissionDisposition =
  | 'ACCEPT'
  | 'DEGRADED_USABLE'
  | 'CONTEXT_ONLY'
  | 'QUARANTINE';

export interface ObservationAdmissionAssessment {
  readonly disposition: ObservationAdmissionDisposition;
  readonly reasonCodes: readonly string[];
  readonly authority: 'NONE';
  readonly requiresCorroboration: boolean;
  readonly usableForCurrentState: boolean;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function hasValidDigest(value: string | undefined): boolean {
  return value !== undefined && SHA256_HEX.test(value);
}

/**
 * Fail-closed admission gate for normalized sensor observations.
 *
 * This gate does not decide whether the observation is true and never grants
 * operational authority. CPAL/evidence-assurance performs independence,
 * contradiction and corroboration reasoning after this structural gate.
 */
export function assessSensorObservationAdmission(
  observation: SensorObservationEnvelope,
  nowEpochMs: number,
): ObservationAdmissionAssessment {
  const reasons: string[] = [];
  const capturedAt = parseTimestamp(observation.capturedAt);
  const receivedAt = parseTimestamp(observation.receivedAt);
  const healthAssessedAt = parseTimestamp(observation.health.assessedAt);

  if (observation.schema !== SENSOR_OBSERVATION_SCHEMA) reasons.push('UNSUPPORTED_SCHEMA');
  if (!observation.observationId.trim()) reasons.push('MISSING_OBSERVATION_ID');
  if (!observation.sourceId.trim()) reasons.push('MISSING_SOURCE_ID');

  if (capturedAt === null || receivedAt === null || healthAssessedAt === null) {
    reasons.push('INVALID_TIMESTAMP');
  }

  if (!Number.isSafeInteger(observation.sourceSequence) || observation.sourceSequence < 0) {
    reasons.push('INVALID_SOURCE_SEQUENCE');
  }

  if (!isFiniteNonNegative(observation.timing.estimatedClockErrorMs)) reasons.push('INVALID_CLOCK_ERROR');
  if (!isFiniteNonNegative(observation.timing.transportLatencyMs)) reasons.push('INVALID_TRANSPORT_LATENCY');
  if (!Number.isSafeInteger(observation.timing.freshnessTtlMs) || observation.timing.freshnessTtlMs <= 0) {
    reasons.push('INVALID_FRESHNESS_TTL');
  }

  if (!Number.isFinite(observation.health.score) || observation.health.score < 0 || observation.health.score > 1) {
    reasons.push('INVALID_HEALTH_SCORE');
  }

  if (!hasValidDigest(observation.provenance.rawPayloadSha256)) reasons.push('INVALID_RAW_PAYLOAD_DIGEST');
  if (!hasValidDigest(observation.provenance.normalizedPayloadSha256)) reasons.push('INVALID_NORMALIZED_PAYLOAD_DIGEST');
  if (!observation.provenance.adapterName.trim() || !observation.provenance.adapterVersion.trim()) {
    reasons.push('MISSING_ADAPTER_PROVENANCE');
  }
  if (!observation.provenance.jurisdiction.trim()) reasons.push('MISSING_JURISDICTION');
  if (!observation.provenance.purpose.trim()) reasons.push('MISSING_PURPOSE');

  if (observation.calibration.state === 'VALID' && !hasValidDigest(observation.calibration.calibrationDigest)) {
    reasons.push('INVALID_CALIBRATION_DIGEST');
  }

  if (capturedAt !== null) {
    const maxFutureSkewMs = Math.max(250, observation.timing.estimatedClockErrorMs + 250);
    if (capturedAt > nowEpochMs + maxFutureSkewMs) reasons.push('CAPTURE_TIME_IN_FUTURE');

    const expiry = capturedAt + observation.timing.freshnessTtlMs;
    if (expiry < nowEpochMs) reasons.push('STALE_OBSERVATION');
  }

  if (observation.health.state === 'QUARANTINED') reasons.push('SENSOR_QUARANTINED');
  if (observation.health.state === 'UNAVAILABLE') reasons.push('SENSOR_UNAVAILABLE');
  if (observation.calibration.state === 'INVALID') reasons.push('CALIBRATION_INVALID');

  const hardFailureReasons = new Set([
    'UNSUPPORTED_SCHEMA',
    'MISSING_OBSERVATION_ID',
    'MISSING_SOURCE_ID',
    'INVALID_TIMESTAMP',
    'INVALID_SOURCE_SEQUENCE',
    'INVALID_FRESHNESS_TTL',
    'INVALID_HEALTH_SCORE',
    'INVALID_RAW_PAYLOAD_DIGEST',
    'INVALID_NORMALIZED_PAYLOAD_DIGEST',
    'MISSING_ADAPTER_PROVENANCE',
    'MISSING_JURISDICTION',
    'MISSING_PURPOSE',
    'INVALID_CALIBRATION_DIGEST',
    'CAPTURE_TIME_IN_FUTURE',
    'SENSOR_QUARANTINED',
    'SENSOR_UNAVAILABLE',
    'CALIBRATION_INVALID',
  ]);

  if (reasons.some((reason) => hardFailureReasons.has(reason))) {
    return {
      disposition: 'QUARANTINE',
      reasonCodes: reasons,
      authority: 'NONE',
      requiresCorroboration: true,
      usableForCurrentState: false,
    };
  }

  if (reasons.includes('STALE_OBSERVATION')) {
    return {
      disposition: 'CONTEXT_ONLY',
      reasonCodes: reasons,
      authority: 'NONE',
      requiresCorroboration: true,
      usableForCurrentState: false,
    };
  }

  if (
    observation.health.state === 'DEGRADED'
    || observation.calibration.state === 'STALE'
    || observation.calibration.state === 'UNKNOWN'
    || observation.health.degradationCauses.length > 0
  ) {
    return {
      disposition: 'DEGRADED_USABLE',
      reasonCodes: reasons.length > 0 ? reasons : ['SENSOR_DEGRADED'],
      authority: 'NONE',
      requiresCorroboration: true,
      usableForCurrentState: true,
    };
  }

  return {
    disposition: 'ACCEPT',
    reasonCodes: reasons,
    authority: 'NONE',
    requiresCorroboration: false,
    usableForCurrentState: true,
  };
}
