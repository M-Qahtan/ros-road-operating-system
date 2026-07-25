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

export function isHighSeverity(level: SeverityLevel): boolean {
  return level === SeverityLevel.High || level === SeverityLevel.Critical;
}

export function validateSeverityAssessment(assessment: SeverityAssessment): void {
  if (!Object.values(SeverityLevel).includes(assessment.level)) {
    throw new TypeError('Severity level is invalid');
  }
  if (!Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 100) {
    throw new RangeError('Severity score must be between 0 and 100');
  }
  if (!Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) {
    throw new RangeError('Confidence must be between 0 and 1');
  }
  if (
    assessment.reasonCodes.length === 0 ||
    assessment.reasonCodes.some((reasonCode) => reasonCode.trim().length === 0 || reasonCode.length > 64)
  ) {
    throw new TypeError('Severity requires non-empty reason codes of at most 64 characters');
  }
  if (isHighSeverity(assessment.level) && !assessment.requiresHumanReview) {
    throw new TypeError('S3 and S4 severity assessments require human review');
  }
}

export function freezeSeverityAssessment(assessment: SeverityAssessment): SeverityAssessment {
  validateSeverityAssessment(assessment);
  return Object.freeze({
    ...assessment,
    reasonCodes: Object.freeze([...assessment.reasonCodes])
  });
}
