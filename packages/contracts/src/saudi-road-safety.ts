export const SAUDI_ROAD_SAFETY_PROFILE = 'ros.sa-road-safety/v1' as const;

export type SaudiInteropStatus = 'ICD_REQUIRED' | 'MAPPING_READY' | 'CERTIFIED';

export type SaudiRoadSafetyEventType =
  | 'COLLISION'
  | 'STOPPED_VEHICLE'
  | 'WRONG_WAY_MOVEMENT'
  | 'UNSAFE_FOLLOWING_SIGNAL'
  | 'SUDDEN_SWERVE_PATTERN'
  | 'HARD_BRAKING_WAVE'
  | 'PEDESTRIAN_CROSSING_RISK'
  | 'CYCLIST_RISK'
  | 'LIVESTOCK_ON_ROAD'
  | 'CAMEL_ON_ROAD'
  | 'SAND_ON_ROAD'
  | 'DUST_VISIBILITY_DEGRADATION'
  | 'FLOOD_OR_STANDING_WATER'
  | 'ROAD_DEBRIS'
  | 'WORK_ZONE_CONFLICT'
  | 'TUNNEL_SMOKE'
  | 'TUNNEL_FIRE'
  | 'SIGNAL_FAILURE'
  | 'LANE_BLOCKAGE'
  | 'EMERGENCY_ACCESS_DEGRADATION';

export interface SaudiPrivacyMetadata {
  readonly purpose: string;
  readonly legalBasis: string;
  readonly dataClassification: string;
  readonly retentionPolicy: string;
  readonly retentionUntil?: string;
  readonly jurisdiction: 'SA';
  readonly controller: string;
  readonly processor?: string;
  readonly allowedRecipients: readonly string[];
  readonly crossBorderStatus: 'LOCAL_ONLY' | 'APPROVED_TRANSFER' | 'NOT_APPLICABLE';
}

export interface SaudiCrashExportRecord {
  readonly profile: typeof SAUDI_ROAD_SAFETY_PROFILE;
  readonly recordType: 'CRASH_EVENT';
  readonly eventId: string;
  readonly occurredAt: string;
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly roadSegmentId?: string;
    readonly direction?: string;
    readonly laneContext: readonly string[];
  };
  readonly classification: {
    readonly rosType: SaudiRoadSafetyEventType;
    readonly localAuthorityCode: string | null;
    readonly severity: 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
    readonly confidence: number;
    readonly legalViolationConfirmed: false;
  };
  readonly environment: Readonly<Record<string, unknown>>;
  readonly participants: {
    readonly vehicles: number;
    readonly pedestrians: number;
    readonly vulnerableRoadUsers: number;
  };
  readonly evidenceSummary: {
    readonly independentSources: number;
    readonly contradictions: number;
    readonly manifestId: string;
  };
  readonly lifecycle: {
    readonly detectedAt: string;
    readonly confirmedAt?: string;
    readonly responseStartedAt?: string;
    readonly roadReopenedAt?: string;
  };
  readonly privacy: SaudiPrivacyMetadata;
}

export interface SaudiHazardLocationRecord {
  readonly profile: typeof SAUDI_ROAD_SAFETY_PROFILE;
  readonly recordType: 'HAZARD_LOCATION';
  readonly hazardLocationId: string;
  readonly geometry: Readonly<Record<string, unknown>>;
  readonly analysisWindow: {
    readonly from: string;
    readonly to: string;
  };
  readonly exposure: Readonly<Record<string, unknown>>;
  readonly crashHistory: Readonly<Record<string, unknown>>;
  readonly nearMissEvidence: Readonly<Record<string, unknown>>;
  readonly riskFactors: readonly string[];
  readonly confidence: number;
  readonly modelVersion: string;
  readonly evidenceManifestId: string;
}

export interface SaudiSafetyIndicatorRecord {
  readonly profile: typeof SAUDI_ROAD_SAFETY_PROFILE;
  readonly recordType: 'SAFETY_INDICATOR';
  readonly indicatorId: string;
  readonly indicatorNamespace: 'ROS_OPERATIONAL' | 'OFFICIAL_MAPPED';
  readonly officialCode: string | null;
  readonly measurementWindow: {
    readonly from: string;
    readonly to: string;
  };
  readonly value: number;
  readonly unit: string;
  readonly methodologyVersion: string;
  readonly evidenceManifestId: string;
}

export type SaudiRoadSafetyExportRecord =
  | SaudiCrashExportRecord
  | SaudiHazardLocationRecord
  | SaudiSafetyIndicatorRecord;

export interface SaudiRoadSafetyInteroperabilityState {
  readonly profile: typeof SAUDI_ROAD_SAFETY_PROFILE;
  /**
   * Remains ICD_REQUIRED until an authoritative NRSC/Marsad interface contract
   * is supplied and independently mapped/tested. Publicly inferred fields are
   * not treated as certified government interoperability.
   */
  readonly nrscMarsad: SaudiInteropStatus;
  readonly roadCodeMappingVersion: string;
  readonly mappingDigest: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function validateSaudiExportRecord(record: SaudiRoadSafetyExportRecord): readonly string[] {
  const errors: string[] = [];

  if (record.profile !== SAUDI_ROAD_SAFETY_PROFILE) errors.push('UNSUPPORTED_PROFILE');

  if (record.recordType === 'CRASH_EVENT') {
    if (!record.eventId.trim()) errors.push('MISSING_EVENT_ID');
    if (!Number.isFinite(record.location.latitude) || record.location.latitude < -90 || record.location.latitude > 90) {
      errors.push('INVALID_LATITUDE');
    }
    if (!Number.isFinite(record.location.longitude) || record.location.longitude < -180 || record.location.longitude > 180) {
      errors.push('INVALID_LONGITUDE');
    }
    if (!Number.isFinite(record.classification.confidence)
      || record.classification.confidence < 0
      || record.classification.confidence > 1) {
      errors.push('INVALID_CONFIDENCE');
    }
    if (record.classification.legalViolationConfirmed !== false) {
      errors.push('LEGAL_ENFORCEMENT_OUT_OF_SCOPE');
    }
    if (!record.evidenceSummary.manifestId.trim()) errors.push('MISSING_EVIDENCE_MANIFEST');
    if (record.privacy.jurisdiction !== 'SA') errors.push('INVALID_PRIVACY_JURISDICTION');
    if (!record.privacy.purpose.trim()) errors.push('MISSING_PRIVACY_PURPOSE');
    if (!record.privacy.legalBasis.trim()) errors.push('MISSING_LEGAL_BASIS');
  } else if (record.recordType === 'HAZARD_LOCATION') {
    if (!record.hazardLocationId.trim()) errors.push('MISSING_HAZARD_LOCATION_ID');
    if (!record.modelVersion.trim()) errors.push('MISSING_MODEL_VERSION');
    if (!record.evidenceManifestId.trim()) errors.push('MISSING_EVIDENCE_MANIFEST');
  } else {
    if (!record.indicatorId.trim()) errors.push('MISSING_INDICATOR_ID');
    if (!Number.isFinite(record.value)) errors.push('INVALID_INDICATOR_VALUE');
    if (record.indicatorNamespace === 'OFFICIAL_MAPPED' && !record.officialCode) {
      errors.push('OFFICIAL_INDICATOR_REQUIRES_CODE');
    }
    if (!record.evidenceManifestId.trim()) errors.push('MISSING_EVIDENCE_MANIFEST');
  }

  return errors;
}

export function validateSaudiInteropState(state: SaudiRoadSafetyInteroperabilityState): readonly string[] {
  const errors: string[] = [];
  if (state.profile !== SAUDI_ROAD_SAFETY_PROFILE) errors.push('UNSUPPORTED_PROFILE');
  if (!state.roadCodeMappingVersion.trim()) errors.push('MISSING_ROAD_CODE_MAPPING_VERSION');
  if (!SHA256_HEX.test(state.mappingDigest)) errors.push('INVALID_MAPPING_DIGEST');
  return errors;
}
