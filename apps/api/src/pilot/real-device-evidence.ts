import { createHash } from 'node:crypto';

export type DevicePlatform = 'ANDROID' | 'IOS';
export type FieldScenarioKind =
  | 'CRITICAL_FLOW'
  | 'GPS_DEGRADATION'
  | 'NETWORK_LOSS'
  | 'RESTART_RECONNECT'
  | 'SCREEN_READER';
export type FieldScenarioOutcome = 'PASS' | 'FAIL';
export type ScreenReader = 'NONE' | 'TALKBACK' | 'VOICEOVER';

export interface FieldEvidenceFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface RealDeviceDescriptor {
  readonly platform: DevicePlatform;
  readonly model: string;
  readonly osVersion: string;
  readonly appBuildSha256: string;
  readonly locale: string;
  readonly screenReader: ScreenReader;
}

export interface RealDeviceScenarioEvidence {
  readonly caseId: string;
  readonly kind: FieldScenarioKind;
  readonly outcome: FieldScenarioOutcome;
  readonly duplicateLogicalActionsObserved: number;
  readonly staleUnsafeActionsObserved: number;
  readonly privacyDataMinimized: boolean;
  readonly evidenceFiles: readonly FieldEvidenceFile[];
}

export interface RealDeviceEvidenceSession {
  readonly sessionId: string;
  readonly candidateHeadSha: string;
  readonly environment: 'CONTROLLED_FIELD_LAB';
  readonly device: RealDeviceDescriptor;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly scenarios: readonly RealDeviceScenarioEvidence[];
}

export interface RealDeviceEvidenceBundle {
  readonly schema: 'ros-real-device-evidence/v1';
  readonly sessions: readonly RealDeviceEvidenceSession[];
}

export interface RealDeviceEvidenceDecision {
  readonly status: 'PASS' | 'NO_GO';
  readonly bundleSha256: string;
  readonly evidenceIntegrityVerified: boolean;
  readonly representativeRealDeviceCriticalFlowsPassed: boolean;
  readonly gpsDegradationSafeStateVerified: boolean;
  readonly networkLossSafeStateVerified: boolean;
  readonly restartReconnectSafeStateVerified: boolean;
  readonly screenReaderCriticalFlowsPassed: boolean;
  readonly duplicateLogicalActionsObserved: number;
  readonly staleStateUnsafeActionsObserved: number;
  readonly missingCoverage: readonly string[];
  readonly blockingReasons: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(source)) {
    if (!allowedSet.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!(key in source)) throw new TypeError(`${field}.${key} is required`);
  }
}

function stringField(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new TypeError(`${field} length is invalid`);
  }
  if (trimmed !== value) throw new TypeError(`${field} must not contain surrounding whitespace`);
  return trimmed;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function timestamp(value: unknown, field: string): string {
  const parsed = stringField(value, field, 64);
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be an ISO-8601 timestamp`);
  return new Date(milliseconds).toISOString();
}

function enumField<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseEvidenceFile(value: unknown, field: string): FieldEvidenceFile {
  const source = record(value, field);
  exactKeys(source, field, ['path', 'sha256', 'sizeBytes']);
  const path = stringField(source.path, `${field}.path`, 512);
  if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new TypeError(`${field}.path must be a safe relative evidence path`);
  }
  const sha256 = stringField(source.sha256, `${field}.sha256`, 64).toLowerCase();
  if (!SHA256.test(sha256)) throw new TypeError(`${field}.sha256 must be a lowercase SHA-256 digest`);
  const sizeBytes = nonNegativeInteger(source.sizeBytes, `${field}.sizeBytes`);
  if (sizeBytes === 0) throw new TypeError(`${field}.sizeBytes must be greater than zero`);
  return Object.freeze({ path, sha256, sizeBytes });
}

function parseDevice(value: unknown, field: string): RealDeviceDescriptor {
  const source = record(value, field);
  exactKeys(source, field, ['platform', 'model', 'osVersion', 'appBuildSha256', 'locale', 'screenReader']);
  const platform = enumField(source.platform, `${field}.platform`, ['ANDROID', 'IOS'] as const);
  const screenReader = enumField(source.screenReader, `${field}.screenReader`, ['NONE', 'TALKBACK', 'VOICEOVER'] as const);
  if (platform === 'ANDROID' && screenReader === 'VOICEOVER') {
    throw new TypeError(`${field}.screenReader VOICEOVER is invalid for Android`);
  }
  if (platform === 'IOS' && screenReader === 'TALKBACK') {
    throw new TypeError(`${field}.screenReader TALKBACK is invalid for iOS`);
  }
  const appBuildSha256 = stringField(source.appBuildSha256, `${field}.appBuildSha256`, 64).toLowerCase();
  if (!SHA256.test(appBuildSha256)) throw new TypeError(`${field}.appBuildSha256 must be a lowercase SHA-256 digest`);
  return Object.freeze({
    platform,
    model: stringField(source.model, `${field}.model`, 128),
    osVersion: stringField(source.osVersion, `${field}.osVersion`, 64),
    appBuildSha256,
    locale: stringField(source.locale, `${field}.locale`, 32),
    screenReader
  });
}

function parseScenario(value: unknown, field: string): RealDeviceScenarioEvidence {
  const source = record(value, field);
  exactKeys(source, field, [
    'caseId',
    'kind',
    'outcome',
    'duplicateLogicalActionsObserved',
    'staleUnsafeActionsObserved',
    'privacyDataMinimized',
    'evidenceFiles'
  ]);
  const caseId = stringField(source.caseId, `${field}.caseId`, 128);
  if (!CASE_ID.test(caseId)) throw new TypeError(`${field}.caseId format is invalid`);
  if (!Array.isArray(source.evidenceFiles) || source.evidenceFiles.length === 0 || source.evidenceFiles.length > 32) {
    throw new TypeError(`${field}.evidenceFiles must contain 1..32 files`);
  }
  return Object.freeze({
    caseId,
    kind: enumField(source.kind, `${field}.kind`, [
      'CRITICAL_FLOW',
      'GPS_DEGRADATION',
      'NETWORK_LOSS',
      'RESTART_RECONNECT',
      'SCREEN_READER'
    ] as const),
    outcome: enumField(source.outcome, `${field}.outcome`, ['PASS', 'FAIL'] as const),
    duplicateLogicalActionsObserved: nonNegativeInteger(
      source.duplicateLogicalActionsObserved,
      `${field}.duplicateLogicalActionsObserved`
    ),
    staleUnsafeActionsObserved: nonNegativeInteger(source.staleUnsafeActionsObserved, `${field}.staleUnsafeActionsObserved`),
    privacyDataMinimized: booleanField(source.privacyDataMinimized, `${field}.privacyDataMinimized`),
    evidenceFiles: Object.freeze(source.evidenceFiles.map((entry, index) => parseEvidenceFile(entry, `${field}.evidenceFiles[${index}]`)))
  });
}

function parseSession(value: unknown, index: number): RealDeviceEvidenceSession {
  const field = `sessions[${index}]`;
  const source = record(value, field);
  exactKeys(source, field, ['sessionId', 'candidateHeadSha', 'environment', 'device', 'startedAt', 'completedAt', 'scenarios']);
  const sessionId = stringField(source.sessionId, `${field}.sessionId`, 128);
  if (!SESSION_ID.test(sessionId)) throw new TypeError(`${field}.sessionId format is invalid`);
  const candidateHeadSha = stringField(source.candidateHeadSha, `${field}.candidateHeadSha`, 40).toLowerCase();
  if (!GIT_SHA.test(candidateHeadSha)) throw new TypeError(`${field}.candidateHeadSha must be a 40-character git SHA`);
  const startedAt = timestamp(source.startedAt, `${field}.startedAt`);
  const completedAt = timestamp(source.completedAt, `${field}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw new TypeError(`${field}.completedAt precedes startedAt`);
  if (!Array.isArray(source.scenarios) || source.scenarios.length === 0 || source.scenarios.length > 64) {
    throw new TypeError(`${field}.scenarios must contain 1..64 cases`);
  }
  const scenarios = source.scenarios.map((entry, scenarioIndex) => parseScenario(entry, `${field}.scenarios[${scenarioIndex}]`));
  const caseIds = new Set<string>();
  for (const scenario of scenarios) {
    if (caseIds.has(scenario.caseId)) throw new TypeError(`${field} contains duplicate caseId ${scenario.caseId}`);
    caseIds.add(scenario.caseId);
  }
  return Object.freeze({
    sessionId,
    candidateHeadSha,
    environment: enumField(source.environment, `${field}.environment`, ['CONTROLLED_FIELD_LAB'] as const),
    device: parseDevice(source.device, `${field}.device`),
    startedAt,
    completedAt,
    scenarios: Object.freeze(scenarios)
  });
}

export function parseRealDeviceEvidenceBundle(value: unknown): RealDeviceEvidenceBundle {
  const source = record(value, 'bundle');
  exactKeys(source, 'bundle', ['schema', 'sessions']);
  if (source.schema !== 'ros-real-device-evidence/v1') throw new TypeError('bundle.schema is unsupported');
  if (!Array.isArray(source.sessions) || source.sessions.length === 0 || source.sessions.length > 64) {
    throw new TypeError('bundle.sessions must contain 1..64 sessions');
  }
  const sessions = source.sessions.map(parseSession);
  const sessionIds = new Set<string>();
  const candidateHeads = new Set<string>();
  for (const session of sessions) {
    if (sessionIds.has(session.sessionId)) throw new TypeError(`duplicate sessionId ${session.sessionId}`);
    sessionIds.add(session.sessionId);
    candidateHeads.add(session.candidateHeadSha);
  }
  if (candidateHeads.size !== 1) throw new TypeError('all real-device sessions must target the same candidate head');
  return Object.freeze({ schema: 'ros-real-device-evidence/v1', sessions: Object.freeze(sessions) });
}

function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('undefined is not canonicalizable');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('value is not JSON-canonicalizable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`)
    .join(',')}}`;
}

export function realDeviceEvidenceBundleSha256(bundle: RealDeviceEvidenceBundle): string {
  return createHash('sha256').update(canonicalize(bundle), 'utf8').digest('hex');
}

function passed(session: RealDeviceEvidenceSession, kind: FieldScenarioKind): boolean {
  return session.scenarios.some(
    (scenario) =>
      scenario.kind === kind &&
      scenario.outcome === 'PASS' &&
      scenario.privacyDataMinimized &&
      scenario.duplicateLogicalActionsObserved === 0 &&
      scenario.staleUnsafeActionsObserved === 0
  );
}

export function evaluateRealDeviceEvidence(value: unknown): RealDeviceEvidenceDecision {
  const bundle = parseRealDeviceEvidenceBundle(value);
  let duplicateLogicalActionsObserved = 0;
  let staleStateUnsafeActionsObserved = 0;
  const blockingReasons: string[] = [];

  for (const session of bundle.sessions) {
    for (const scenario of session.scenarios) {
      duplicateLogicalActionsObserved += scenario.duplicateLogicalActionsObserved;
      staleStateUnsafeActionsObserved += scenario.staleUnsafeActionsObserved;
      if (scenario.outcome !== 'PASS') blockingReasons.push(`${session.sessionId}/${scenario.caseId} did not PASS`);
      if (!scenario.privacyDataMinimized) blockingReasons.push(`${session.sessionId}/${scenario.caseId} violated data minimization`);
    }
  }
  if (duplicateLogicalActionsObserved > 0) blockingReasons.push('duplicate logical actions were observed on real devices');
  if (staleStateUnsafeActionsObserved > 0) blockingReasons.push('unsafe stale-state actions were observed on real devices');

  const androidSessions = bundle.sessions.filter((session) => session.device.platform === 'ANDROID');
  const iosSessions = bundle.sessions.filter((session) => session.device.platform === 'IOS');
  const representativeRealDeviceCriticalFlowsPassed =
    androidSessions.some((session) => passed(session, 'CRITICAL_FLOW')) &&
    iosSessions.some((session) => passed(session, 'CRITICAL_FLOW'));
  const gpsDegradationSafeStateVerified = bundle.sessions.some((session) => passed(session, 'GPS_DEGRADATION'));
  const networkLossSafeStateVerified = bundle.sessions.some((session) => passed(session, 'NETWORK_LOSS'));
  const restartReconnectSafeStateVerified = bundle.sessions.some((session) => passed(session, 'RESTART_RECONNECT'));
  const talkBackPassed = androidSessions.some(
    (session) => session.device.screenReader === 'TALKBACK' && passed(session, 'SCREEN_READER')
  );
  const voiceOverPassed = iosSessions.some(
    (session) => session.device.screenReader === 'VOICEOVER' && passed(session, 'SCREEN_READER')
  );
  const screenReaderCriticalFlowsPassed = talkBackPassed && voiceOverPassed;

  const missingCoverage: string[] = [];
  if (!representativeRealDeviceCriticalFlowsPassed) missingCoverage.push('Android+iOS critical-flow coverage');
  if (!gpsDegradationSafeStateVerified) missingCoverage.push('GPS degradation safe-state coverage');
  if (!networkLossSafeStateVerified) missingCoverage.push('network-loss safe-state coverage');
  if (!restartReconnectSafeStateVerified) missingCoverage.push('restart/reconnect safe-state coverage');
  if (!screenReaderCriticalFlowsPassed) missingCoverage.push('TalkBack+VoiceOver critical-flow coverage');

  const evidenceIntegrityVerified = bundle.sessions.every((session) =>
    session.scenarios.every((scenario) => scenario.evidenceFiles.every((file) => SHA256.test(file.sha256) && file.sizeBytes > 0))
  );
  if (!evidenceIntegrityVerified) blockingReasons.push('evidence file integrity metadata is incomplete');

  const status =
    blockingReasons.length === 0 && missingCoverage.length === 0 && evidenceIntegrityVerified ? 'PASS' : 'NO_GO';

  return Object.freeze({
    status,
    bundleSha256: realDeviceEvidenceBundleSha256(bundle),
    evidenceIntegrityVerified,
    representativeRealDeviceCriticalFlowsPassed,
    gpsDegradationSafeStateVerified,
    networkLossSafeStateVerified,
    restartReconnectSafeStateVerified,
    screenReaderCriticalFlowsPassed,
    duplicateLogicalActionsObserved,
    staleStateUnsafeActionsObserved,
    missingCoverage: Object.freeze(missingCoverage),
    blockingReasons: Object.freeze(blockingReasons)
  });
}
