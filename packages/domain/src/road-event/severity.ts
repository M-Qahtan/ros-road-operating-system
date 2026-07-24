export enum SeverityLevel {
  Informational = 'S0',
  Low = 'S1',
  Moderate = 'S2',
  High = 'S3',
  Critical = 'S4'
}

export interface SeverityAssessment {
  readonly level: SeverityLevel;
  readonly score: number;
  readonly reasonCodes: readonly string[];
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
}
