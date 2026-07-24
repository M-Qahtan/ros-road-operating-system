import { allowedTransitions, RoadEventStatus } from './road-event-status.js';
import {
  freezeSeverityAssessment,
  isHighSeverity,
  SeverityAssessment,
  SeverityLevel
} from './severity.js';

const MAX_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1000;

export interface ClosureAuthorization {
  readonly actorId: string;
  readonly reason: string;
  readonly authorizedAt: Date;
}

export interface RoadEventProps {
  readonly id: string;
  readonly occurredAt: Date;
  readonly latitude: number;
  readonly longitude: number;
  readonly status?: RoadEventStatus;
  readonly severity?: SeverityAssessment;
  readonly version?: number;
  readonly closureAuthorization?: ClosureAuthorization;
}

export class InvalidRoadEventError extends Error {
  override readonly name = 'InvalidRoadEventError';
}

export class InvalidRoadEventTransitionError extends Error {
  override readonly name = 'InvalidRoadEventTransitionError';
}

export class RoadEventClosureRequiresHumanAuthorizationError extends Error {
  override readonly name = 'RoadEventClosureRequiresHumanAuthorizationError';
}

function requireNonEmpty(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new InvalidRoadEventError(`${field} must contain between 1 and ${maximumLength} characters`);
  }
  return normalized;
}

function copyAuthorization(authorization: ClosureAuthorization): ClosureAuthorization {
  const actorId = requireNonEmpty(authorization.actorId, 'Closure authorization actorId', 128);
  const reason = requireNonEmpty(authorization.reason, 'Closure authorization reason', 500);
  const authorizedAt = authorization.authorizedAt.getTime();
  if (!Number.isFinite(authorizedAt) || authorizedAt > Date.now() + MAX_CLOCK_SKEW_MILLISECONDS) {
    throw new InvalidRoadEventError('Closure authorization time is invalid');
  }
  return Object.freeze({ actorId, reason, authorizedAt: new Date(authorizedAt) });
}

export class RoadEvent {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  private readonly _occurredAt: Date;
  private _status: RoadEventStatus;
  private _severity: SeverityAssessment;
  private _version: number;
  private _closureAuthorization: ClosureAuthorization | undefined;

  constructor(props: RoadEventProps) {
    this.id = requireNonEmpty(props.id, 'RoadEvent id', 128);

    const occurredAt = props.occurredAt.getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > Date.now() + MAX_CLOCK_SKEW_MILLISECONDS) {
      throw new InvalidRoadEventError('RoadEvent occurredAt is invalid');
    }
    if (!Number.isFinite(props.latitude) || props.latitude < -90 || props.latitude > 90) {
      throw new InvalidRoadEventError('RoadEvent latitude must be between -90 and 90');
    }
    if (!Number.isFinite(props.longitude) || props.longitude < -180 || props.longitude > 180) {
      throw new InvalidRoadEventError('RoadEvent longitude must be between -180 and 180');
    }

    const status = props.status ?? RoadEventStatus.Detected;
    if (!Object.values(RoadEventStatus).includes(status)) {
      throw new InvalidRoadEventError('RoadEvent status is invalid');
    }

    const version = props.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InvalidRoadEventError('RoadEvent version must be a positive safe integer');
    }

    this._occurredAt = new Date(occurredAt);
    this.latitude = props.latitude;
    this.longitude = props.longitude;
    this._status = status;
    this._severity = freezeSeverityAssessment(props.severity ?? {
      level: SeverityLevel.Informational,
      score: 0,
      reasonCodes: ['initial_detection'],
      confidence: 0,
      requiresHumanReview: true
    });
    this._version = version;
    this._closureAuthorization = undefined;
    if (props.closureAuthorization !== undefined) {
      this._closureAuthorization = copyAuthorization(props.closureAuthorization);
    }
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  get status(): RoadEventStatus {
    return this._status;
  }

  get severity(): SeverityAssessment {
    return this._severity;
  }

  get version(): number {
    return this._version;
  }

  get closureAuthorization(): ClosureAuthorization | undefined {
    return this._closureAuthorization === undefined
      ? undefined
      : copyAuthorization(this._closureAuthorization);
  }

  transitionTo(next: RoadEventStatus): void {
    if (!allowedTransitions[this._status].includes(next)) {
      throw new InvalidRoadEventTransitionError(`Transition ${this._status} -> ${next} is not allowed`);
    }
    if (
      next === RoadEventStatus.Closed &&
      isHighSeverity(this._severity.level) &&
      this._closureAuthorization === undefined
    ) {
      throw new RoadEventClosureRequiresHumanAuthorizationError(
        `${this._severity.level} RoadEvents require explicit human authorization before closure`
      );
    }
    this._status = next;
    this._version += 1;
  }

  assessSeverity(assessment: SeverityAssessment): void {
    this._severity = freezeSeverityAssessment(assessment);
    this._closureAuthorization = undefined;
    this._version += 1;
  }

  authorizeClosure(authorization: ClosureAuthorization): void {
    if (!allowedTransitions[this._status].includes(RoadEventStatus.Closed)) {
      throw new InvalidRoadEventTransitionError(
        `RoadEvent closure cannot be authorized while status is ${this._status}`
      );
    }
    this._closureAuthorization = copyAuthorization(authorization);
    this._version += 1;
  }
}
