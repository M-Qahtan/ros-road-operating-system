import {
  SAUDI_ROAD_SAFETY_PROFILE,
  validateSaudiExportRecord,
  validateSaudiInteropState,
  type SaudiCrashExportRecord,
  type SaudiPrivacyMetadata,
  type SaudiRoadSafetyEventType,
  type SaudiRoadSafetyInteroperabilityState,
} from '@ros/contracts';

export interface SaudiCrashProjectionInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly roadSegmentId?: string;
  readonly direction?: string;
  readonly laneContext: readonly string[];
  readonly rosType: SaudiRoadSafetyEventType;
  readonly severity: SaudiCrashExportRecord['classification']['severity'];
  readonly confidence: number;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly participants: SaudiCrashExportRecord['participants'];
  readonly evidenceSummary: SaudiCrashExportRecord['evidenceSummary'];
  readonly lifecycle: SaudiCrashExportRecord['lifecycle'];
  readonly privacy: SaudiPrivacyMetadata;
  readonly interoperability: SaudiRoadSafetyInteroperabilityState;
}

export type SaudiGovernmentTransmissionGate =
  | 'AUTHORITATIVE_ICD_REQUIRED'
  | 'CERTIFICATION_REQUIRED'
  | 'SEPARATE_EXTERNAL_AUTHORIZATION_REQUIRED';

export interface SaudiCrashProjectionResult {
  readonly record: SaudiCrashExportRecord;
  readonly interoperabilityStatus: SaudiRoadSafetyInteroperabilityState['nrscMarsad'];
  readonly transmissionGate: SaudiGovernmentTransmissionGate;
  /** Projection is deliberately non-networking; another governed adapter must authorize transport. */
  readonly transmissionAuthorized: false;
  readonly networkCalls: 0;
  readonly legalEnforcementAuthority: 'NONE';
}

export function projectSaudiCrashRecord(input: SaudiCrashProjectionInput): SaudiCrashProjectionResult {
  validateProjectionInput(input);

  const interopErrors = validateSaudiInteropState(input.interoperability);
  if (interopErrors.length > 0) {
    throw new Error(`INVALID_SAUDI_INTEROP_STATE:${interopErrors.join(',')}`);
  }

  const record: SaudiCrashExportRecord = {
    profile: SAUDI_ROAD_SAFETY_PROFILE,
    recordType: 'CRASH_EVENT',
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.roadSegmentId === undefined ? {} : { roadSegmentId: input.roadSegmentId }),
      ...(input.direction === undefined ? {} : { direction: input.direction }),
      laneContext: [...input.laneContext],
    },
    classification: {
      rosType: input.rosType,
      // ROS must not fabricate regulator codes before the authoritative mapping exists.
      localAuthorityCode: null,
      severity: input.severity,
      confidence: input.confidence,
      legalViolationConfirmed: false,
    },
    environment: input.environment,
    participants: input.participants,
    evidenceSummary: input.evidenceSummary,
    lifecycle: input.lifecycle,
    privacy: input.privacy,
  };

  const recordErrors = validateSaudiExportRecord(record);
  if (recordErrors.length > 0) {
    throw new Error(`INVALID_SAUDI_EXPORT_RECORD:${recordErrors.join(',')}`);
  }

  return {
    record,
    interoperabilityStatus: input.interoperability.nrscMarsad,
    transmissionGate: transmissionGate(input.interoperability.nrscMarsad),
    transmissionAuthorized: false,
    networkCalls: 0,
    legalEnforcementAuthority: 'NONE',
  };
}

function transmissionGate(status: SaudiRoadSafetyInteroperabilityState['nrscMarsad']): SaudiGovernmentTransmissionGate {
  if (status === 'ICD_REQUIRED') return 'AUTHORITATIVE_ICD_REQUIRED';
  if (status === 'MAPPING_READY') return 'CERTIFICATION_REQUIRED';
  return 'SEPARATE_EXTERNAL_AUTHORIZATION_REQUIRED';
}

function validateProjectionInput(input: SaudiCrashProjectionInput): void {
  if (!input.eventId.trim()) throw new Error('MISSING_EVENT_ID');
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('INVALID_OCCURRED_AT');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) throw new Error('INVALID_LATITUDE');
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) throw new Error('INVALID_LONGITUDE');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('INVALID_CONFIDENCE');

  const counts = [input.participants.vehicles, input.participants.pedestrians, input.participants.vulnerableRoadUsers];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('INVALID_PARTICIPANT_COUNT');
  if (!Number.isSafeInteger(input.evidenceSummary.independentSources) || input.evidenceSummary.independentSources < 0) {
    throw new Error('INVALID_INDEPENDENT_SOURCE_COUNT');
  }
  if (!Number.isSafeInteger(input.evidenceSummary.contradictions) || input.evidenceSummary.contradictions < 0) {
    throw new Error('INVALID_CONTRADICTION_COUNT');
  }

  const lifecycleTimes = [
    input.lifecycle.detectedAt,
    input.lifecycle.confirmedAt,
    input.lifecycle.responseStartedAt,
    input.lifecycle.roadReopenedAt,
  ].filter((value): value is string => value !== undefined);
  if (lifecycleTimes.some((value) => !Number.isFinite(Date.parse(value)))) throw new Error('INVALID_LIFECYCLE_TIME');

  if (input.privacy.crossBorderStatus === 'APPROVED_TRANSFER' && input.privacy.allowedRecipients.length === 0) {
    throw new Error('APPROVED_TRANSFER_REQUIRES_RECIPIENT');
  }
}
