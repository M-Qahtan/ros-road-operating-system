import { createHash } from 'node:crypto';
import {
  COGNITIVE_ROAD_STATE_SCHEMA,
  assessSensorObservationAdmission,
  cognitiveStateRequiresAbstention,
  type CognitiveEntity,
  type CognitiveEntityClass,
  type CognitiveRoadState,
  type EvidenceAssuranceResult,
  type SensorObservationEnvelope,
} from '@ros/contracts';

export interface CognitiveRoadStateBuildInput {
  readonly crsId: string;
  readonly zoneId: string;
  readonly stateTime: string;
  readonly validUntil: string;
  readonly trustedNowEpochMs: number;
  readonly observations: readonly SensorObservationEnvelope[];
  readonly assuranceResults: readonly EvidenceAssuranceResult[];
}

export interface CognitiveRoadStateBuildResult {
  readonly state: CognitiveRoadState;
  readonly abstentionRequired: boolean;
  readonly admittedObservationIds: readonly string[];
  readonly excludedObservationIds: readonly string[];
  readonly authority: 'NONE';
}

interface TrackCandidate {
  readonly envelope: SensorObservationEnvelope;
  readonly track: Extract<SensorObservationEnvelope['payload'], { readonly kind: 'TRACK_SET' }>['tracks'][number];
}

export function buildCognitiveRoadState(input: CognitiveRoadStateBuildInput): CognitiveRoadStateBuildResult {
  validateBuildWindow(input);

  const observedIds = new Set<string>();
  const admitted: SensorObservationEnvelope[] = [];
  const excluded: string[] = [];

  for (const observation of input.observations) {
    if (observedIds.has(observation.observationId)) throw new Error('DUPLICATE_OBSERVATION_ID');
    observedIds.add(observation.observationId);

    const assessment = assessSensorObservationAdmission(observation, input.trustedNowEpochMs);
    if (assessment.usableForCurrentState) admitted.push(observation);
    else excluded.push(observation.observationId);
  }

  const assuranceByObject = uniqueAssuranceResults(input.assuranceResults);
  const tracksById = collectTrackCandidates(admitted);
  const entities: CognitiveEntity[] = [];
  const contradictions: CognitiveRoadState['contradictions'][number][] = [];

  for (const trackId of [...tracksById.keys()].sort()) {
    const candidates = tracksById.get(trackId)!;
    const newest = [...candidates].sort((a, b) => Date.parse(b.envelope.capturedAt) - Date.parse(a.envelope.capturedAt))[0]!;
    const distinctTrackStates = new Set(candidates.map((candidate) => digestTrackState(candidate.track)));
    const assurance = assuranceByObject.get(trackId);

    const materialTrackContradiction = distinctTrackStates.size > 1;
    const assuranceContradiction = assurance?.decision === 'CONTRADICTED';
    const epistemicState = materialTrackContradiction || assuranceContradiction
      ? 'CONTRADICTED'
      : assurance?.decision === 'CORROBORATED'
        ? 'CORROBORATED'
        : assurance === undefined
          ? 'UNKNOWN'
          : 'UNCERTAIN';

    const envelopeIds = uniqueSorted(candidates.map((candidate) => candidate.envelope.observationId));
    const nestedSupporting = uniqueSorted(candidates.flatMap((candidate) => candidate.track.supportingObservationIds));
    const supportingObservationIds = uniqueSorted([...envelopeIds, ...nestedSupporting]);

    if (materialTrackContradiction || assuranceContradiction) {
      contradictions.push({
        contradictionId: `contradiction:${trackId}`,
        observationIds: envelopeIds,
        material: true,
        reason: materialTrackContradiction ? 'DIVERGENT_TRACK_STATE' : 'CPAL_MATERIAL_CONTRADICTION',
      });
    }

    entities.push({
      entityId: trackId,
      entityClass: mapEntityClass(newest.track.objectClass),
      state: {
        positionM: newest.track.state.positionM,
        estimatedVelocityMps: newest.track.state.estimatedVelocityMps,
        ...(newest.track.state.estimatedAccelerationMps2 === undefined
          ? {}
          : { estimatedAccelerationMps2: newest.track.state.estimatedAccelerationMps2 }),
        covariance: newest.track.state.covariance,
        estimator: newest.track.state.estimator,
      },
      ...(newest.track.laneId === undefined ? {} : { laneId: newest.track.laneId }),
      ...(newest.track.roadSegmentId === undefined ? {} : { roadSegmentId: newest.track.roadSegmentId }),
      supportingObservationIds,
      contradictingObservationIds: materialTrackContradiction || assuranceContradiction ? envelopeIds : [],
      confidence: boundedConfidence(epistemicState === 'CONTRADICTED' ? Math.min(newest.track.confidence, 0.5) : newest.track.confidence),
      epistemicState,
      validUntil: entityValidUntil(candidates, input.validUntil),
    });
  }

  const environment = latestEnvironment(admitted);
  const sensorHealthDigest = sha256(stableStringify(admitted
    .map((item) => ({
      sourceId: item.sourceId,
      state: item.health.state,
      score: item.health.score,
      causes: [...item.health.degradationCauses].sort(),
      assessedAt: item.health.assessedAt,
    }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))));

  const evidenceObservationIds = uniqueSorted(admitted.map((item) => item.observationId));
  const epistemicSummary = {
    known: entities.filter((entity) => entity.epistemicState === 'CORROBORATED').map((entity) => entity.entityId).sort(),
    uncertain: entities.filter((entity) => entity.epistemicState === 'UNCERTAIN' || entity.epistemicState === 'CONTRADICTED').map((entity) => entity.entityId).sort(),
    unknown: entities.filter((entity) => entity.epistemicState === 'UNKNOWN').map((entity) => entity.entityId).sort(),
  };

  const digestMaterial = {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: input.crsId,
    zoneId: input.zoneId,
    stateTime: input.stateTime,
    validUntil: input.validUntil,
    sensorHealthDigest,
    entities,
    contradictions,
    environment,
    evidenceObservationIds,
    epistemicSummary,
  };
  const stateDigest = sha256(stableStringify(digestMaterial));

  const state: CognitiveRoadState = {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: input.crsId,
    zoneId: input.zoneId,
    stateTime: input.stateTime,
    validUntil: input.validUntil,
    stateDigest,
    sensorHealthDigest,
    entities,
    hazards: [],
    trafficState: { trackedEntityCount: entities.length },
    environment,
    signalState: {},
    infrastructureState: {},
    evidenceObservationIds,
    contradictions,
    epistemicSummary,
  };

  return {
    state,
    abstentionRequired: cognitiveStateRequiresAbstention(state),
    admittedObservationIds: evidenceObservationIds,
    excludedObservationIds: excluded.sort(),
    authority: 'NONE',
  };
}

function validateBuildWindow(input: CognitiveRoadStateBuildInput): void {
  if (!input.crsId.trim()) throw new Error('MISSING_CRS_ID');
  if (!input.zoneId.trim()) throw new Error('MISSING_ZONE_ID');
  const stateTime = Date.parse(input.stateTime);
  const validUntil = Date.parse(input.validUntil);
  if (!Number.isFinite(stateTime) || !Number.isFinite(validUntil) || validUntil <= stateTime) {
    throw new Error('INVALID_CRS_WINDOW');
  }
  if (stateTime > input.trustedNowEpochMs + 1_000) throw new Error('CRS_TIME_FROM_FUTURE');
}

function uniqueAssuranceResults(results: readonly EvidenceAssuranceResult[]): Map<string, EvidenceAssuranceResult> {
  const byObject = new Map<string, EvidenceAssuranceResult>();
  for (const result of results) {
    if (result.authority !== 'NONE') throw new Error('ASSURANCE_AUTHORITY_IMPORT_FORBIDDEN');
    if (byObject.has(result.objectBinding)) throw new Error('DUPLICATE_ASSURANCE_OBJECT_BINDING');
    byObject.set(result.objectBinding, result);
  }
  return byObject;
}

function collectTrackCandidates(observations: readonly SensorObservationEnvelope[]): Map<string, TrackCandidate[]> {
  const byTrack = new Map<string, TrackCandidate[]>();
  for (const envelope of observations) {
    if (envelope.payload.kind !== 'TRACK_SET') continue;
    for (const track of envelope.payload.tracks) {
      if (!track.trackId.trim()) throw new Error('MISSING_TRACK_ID');
      if (!Number.isFinite(track.confidence) || track.confidence < 0 || track.confidence > 1) {
        throw new Error('INVALID_TRACK_CONFIDENCE');
      }
      const existing = byTrack.get(track.trackId) ?? [];
      existing.push({ envelope, track });
      byTrack.set(track.trackId, existing);
    }
  }
  return byTrack;
}

function mapEntityClass(value: string): CognitiveEntityClass {
  const normalized = value.trim().toUpperCase();
  const supported: readonly CognitiveEntityClass[] = [
    'VEHICLE', 'PEDESTRIAN', 'CYCLIST', 'LIVESTOCK', 'DEBRIS',
    'STATIC_OBSTACLE', 'EMERGENCY_VEHICLE', 'UNKNOWN',
  ];
  return supported.includes(normalized as CognitiveEntityClass) ? normalized as CognitiveEntityClass : 'UNKNOWN';
}

function latestEnvironment(observations: readonly SensorObservationEnvelope[]): Readonly<Record<string, unknown>> {
  const candidates = observations
    .filter((item): item is SensorObservationEnvelope & { readonly payload: Extract<SensorObservationEnvelope['payload'], { readonly kind: 'ENVIRONMENT' }> } => item.payload.kind === 'ENVIRONMENT')
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const latest = candidates[0];
  if (latest === undefined) return {};
  return Object.freeze({ ...latest.payload, observationId: latest.observationId, capturedAt: latest.capturedAt });
}

function entityValidUntil(candidates: readonly TrackCandidate[], crsValidUntil: string): string {
  let limit = Date.parse(crsValidUntil);
  for (const candidate of candidates) {
    limit = Math.min(limit, Date.parse(candidate.envelope.capturedAt) + candidate.envelope.timing.freshnessTtlMs);
  }
  return new Date(limit).toISOString();
}

function digestTrackState(track: TrackCandidate['track']): string {
  return sha256(stableStringify({
    objectClass: track.objectClass,
    state: track.state,
    laneId: track.laneId ?? null,
    roadSegmentId: track.roadSegmentId ?? null,
  }));
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error('NON_FINITE_CONFIDENCE');
  return Math.max(0, Math.min(1, value));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
