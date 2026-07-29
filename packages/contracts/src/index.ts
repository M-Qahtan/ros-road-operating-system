export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly traceId: string;
}

export interface SignalInput {
  readonly signalId: string;
  readonly sourceType: 'MANUAL_REPORT' | 'DEVICE_IMPACT' | 'OPERATOR_CREATED' | 'SIMULATION_SIGNAL';
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type RosRoleContract = 'OPERATOR' | 'SUPERVISOR' | 'AUDITOR' | 'INTEGRATION_SERVICE';
export type SeverityLevelContract = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
export type RoadEventStatusContract =
  | 'DETECTED' | 'VALIDATING' | 'CONFIRMED' | 'SAFETY_ASSESSMENT'
  | 'RESPONSE_COORDINATION' | 'ROAD_CLEARANCE' | 'RECOVERY' | 'CLOSED'
  | 'FALSE_POSITIVE' | 'DUPLICATE' | 'UNDER_REVIEW' | 'TRANSFERRED_TO_AUTHORITY';

export interface SeverityAssessmentContract {
  readonly level: SeverityLevelContract;
  readonly score: number;
  readonly confidence: number;
  readonly reasonCodes: readonly string[];
  readonly requiresHumanReview: boolean;
}

export interface CreateRoadEventRequest {
  readonly id: string;
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly severity?: SeverityAssessmentContract;
}

export interface ReassessSeverityRequest {
  readonly expectedVersion: number;
  readonly assessment: SeverityAssessmentContract;
  readonly reason: string;
}

export interface TransitionRoadEventRequest {
  readonly expectedVersion: number;
  readonly nextStatus: RoadEventStatusContract;
  readonly reason: string;
}

export interface AuthorizeClosureRequest {
  readonly expectedVersion: number;
  readonly reason: string;
  readonly authorizedAt: string;
}

export interface AttachSignalRequest {
  readonly signalId: string;
  readonly matchScore: number;
  readonly mergeReasons: readonly string[];
}

export interface RoadEventResponse {
  readonly id: string;
  readonly status: RoadEventStatusContract;
  readonly severity: SeverityAssessmentContract;
  readonly latitude: number;
  readonly longitude: number;
  readonly occurredAt: string;
  readonly version: number;
  readonly closureAuthorization: {
    readonly actorId: string;
    readonly reason: string;
    readonly authorizedAt: string;
  } | null;
}

export interface RoadEventPageResponse {
  readonly items: readonly RoadEventResponse[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export * from './human-safety.js';
export * from './human-contact-protocol.js';
