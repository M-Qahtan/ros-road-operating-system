import { allowedTransitions, RoadEventStatus } from './road-event-status.js';
import { SeverityAssessment, SeverityLevel } from './severity.js';

export interface RoadEventProps {
  readonly id: string;
  readonly occurredAt: Date;
  readonly latitude: number;
  readonly longitude: number;
  status?: RoadEventStatus;
  severity?: SeverityAssessment;
  version?: number;
}

export class InvalidRoadEventTransitionError extends Error {}

export class RoadEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly latitude: number;
  readonly longitude: number;
  private _status: RoadEventStatus;
  private _severity: SeverityAssessment;
  private _version: number;

  constructor(props: RoadEventProps) {
    this.id = props.id;
    this.occurredAt = props.occurredAt;
    this.latitude = props.latitude;
    this.longitude = props.longitude;
    this._status = props.status ?? RoadEventStatus.Detected;
    this._severity = props.severity ?? {
      level: SeverityLevel.Informational,
      score: 0,
      reasonCodes: ['initial_detection'],
      confidence: 0,
      requiresHumanReview: true
    };
    this._version = props.version ?? 1;
  }

  get status(): RoadEventStatus { return this._status; }
  get severity(): SeverityAssessment { return this._severity; }
  get version(): number { return this._version; }

  transitionTo(next: RoadEventStatus): void {
    if (!allowedTransitions[this._status].includes(next)) {
      throw new InvalidRoadEventTransitionError(`Transition ${this._status} -> ${next} is not allowed`);
    }
    this._status = next;
    this._version += 1;
  }

  assessSeverity(assessment: SeverityAssessment): void {
    if (assessment.score < 0 || assessment.score > 100) throw new RangeError('Severity score must be between 0 and 100');
    if (assessment.confidence < 0 || assessment.confidence > 1) throw new RangeError('Confidence must be between 0 and 1');
    if (assessment.reasonCodes.length === 0) throw new Error('Severity requires at least one reason code');
    this._severity = assessment;
    this._version += 1;
  }
}
