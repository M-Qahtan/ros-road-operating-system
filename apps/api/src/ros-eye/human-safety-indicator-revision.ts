import { createHash } from 'node:crypto';
import type { SafetyIndicatorCode, StructuredSafetyIndicator } from '@ros/contracts';

const INDICATOR_CODES = new Set<SafetyIndicatorCode>([
  'PERSON_RESPONDED', 'PERSON_NOT_RESPONDING', 'COMMUNICATION_INTERRUPTED', 'HELP_REQUESTED',
  'POSSIBLE_IMMEDIATE_DANGER', 'LOCATION_UNCERTAIN', 'MULTIPLE_PEOPLE_REPORTED',
  'CONTRADICTORY_RESPONSE', 'ACCESSIBILITY_SUPPORT_REQUIRED'
]);
const SOURCES = new Set<StructuredSafetyIndicator['source']>(['PERSON', 'DEVICE', 'OPERATOR', 'SIMULATION']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecordedSafetyIndicator extends StructuredSafetyIndicator {
  readonly indicatorId: string;
  readonly supersedesIndicatorId: string | null;
}

export interface IndicatorRevisionScope {
  readonly tenantId: string;
  readonly purpose: string;
  readonly caseId: string;
}

export function indicatorRevisionDigest(
  scope: IndicatorRevisionScope,
  indicators: readonly RecordedSafetyIndicator[]
): string {
  const material = {
    policyVersion: 'ros-eye.human-safety-indicators.v1',
    tenantId: scope.tenantId,
    purpose: scope.purpose,
    caseId: scope.caseId,
    indicators: [...indicators].sort((left, right) => left.indicatorId.localeCompare(right.indicatorId))
  };
  return createHash('sha256').update(canonicalize(material), 'utf8').digest('hex');
}

export function parseRecordedIndicators(value: unknown): readonly RecordedSafetyIndicator[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) throw new Error('invalid indicator set');
  const parsed = value.map(parseRecordedIndicator);
  if (new Set(parsed.map((item) => item.indicatorId)).size !== parsed.length) throw new Error('duplicate indicator id');
  const ids = new Set(parsed.map((item) => item.indicatorId));
  const byId = new Map(parsed.map((item) => [item.indicatorId, item]));
  const superseded = new Set<string>();
  for (const item of parsed) {
    if (item.supersedesIndicatorId === null) continue;
    const target = byId.get(item.supersedesIndicatorId);
    if (!ids.has(item.supersedesIndicatorId) || target === undefined || item.supersedesIndicatorId === item.indicatorId ||
        superseded.has(item.supersedesIndicatorId) || Date.parse(item.observedAt) < Date.parse(target.observedAt)) {
      throw new Error('invalid indicator correction chain');
    }
    superseded.add(item.supersedesIndicatorId);
    const visited = new Set([item.indicatorId]);
    let cursor: RecordedSafetyIndicator | undefined = target;
    while (cursor !== undefined) {
      if (visited.has(cursor.indicatorId)) throw new Error('invalid indicator correction chain');
      visited.add(cursor.indicatorId);
      cursor = cursor.supersedesIndicatorId === null ? undefined : byId.get(cursor.supersedesIndicatorId);
    }
  }
  return Object.freeze(parsed);
}

export function parseRecordedIndicator(value: unknown): RecordedSafetyIndicator {
  if (!isRecord(value)) throw new Error('invalid indicator');
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'code,confidence,indicatorId,observedAt,requiresHumanReview,source,supersedesIndicatorId') {
    throw new Error('invalid indicator fields');
  }
  if (typeof value.indicatorId !== 'string' || !UUID.test(value.indicatorId)) throw new Error('invalid indicator id');
  if (value.supersedesIndicatorId !== null && (typeof value.supersedesIndicatorId !== 'string' || !UUID.test(value.supersedesIndicatorId))) {
    throw new Error('invalid superseded indicator id');
  }
  if (typeof value.code !== 'string' || !INDICATOR_CODES.has(value.code as SafetyIndicatorCode)) throw new Error('invalid indicator code');
  if (typeof value.source !== 'string' || !SOURCES.has(value.source as StructuredSafetyIndicator['source'])) throw new Error('invalid indicator source');
  if (typeof value.observedAt !== 'string' || !validTimestamp(value.observedAt)) throw new Error('invalid indicator time');
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('invalid indicator confidence');
  }
  if (typeof value.requiresHumanReview !== 'boolean') throw new Error('invalid indicator review flag');
  return Object.freeze({
    indicatorId: value.indicatorId.toLowerCase(),
    supersedesIndicatorId: value.supersedesIndicatorId === null ? null : value.supersedesIndicatorId.toLowerCase(),
    code: value.code as SafetyIndicatorCode,
    observedAt: new Date(value.observedAt).toISOString(),
    source: value.source as StructuredSafetyIndicator['source'],
    confidence: value.confidence,
    requiresHumanReview: value.requiresHumanReview
  });
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
}
