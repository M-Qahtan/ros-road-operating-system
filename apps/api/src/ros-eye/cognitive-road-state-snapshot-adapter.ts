import {
  COGNITIVE_ROAD_STATE_SCHEMA,
  cognitiveStateRequiresAbstention,
  type CognitiveRoadState
} from '@ros/contracts';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';

export const COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY = 'ros-eye.cognitive-input-binding.v1' as const;

export interface OwnedCognitiveRoadStateRevision extends InputSnapshotScope {
  readonly authority: 'COGNITIVE_STATE_LEDGER';
  readonly revision: number;
  readonly digest: string;
  readonly state: CognitiveRoadState;
}

export interface CognitiveRoadStateOwnerPort {
  load(scope: InputSnapshotScope): Promise<OwnedCognitiveRoadStateRevision | null>;
}

export interface CognitiveRoadStateInputBinding extends InputSnapshotScope {
  readonly policyVersion: typeof COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY;
  readonly capturedAt: string;
  readonly revision: number;
  readonly digest: string;
  readonly stateTime: string;
  readonly validUntil: string;
  readonly requiresAbstention: boolean;
  readonly authority: 'SOURCE_LEDGER';
}

/**
 * Read-only ownership bridge into the ROS Brain snapshot boundary. It exposes
 * only the version binding and abstention posture; entities, observations, and
 * sensor detail remain owned by the Cognitive Road State module.
 */
export class CognitiveRoadStateSnapshotAdapter {
  constructor(private readonly owner: CognitiveRoadStateOwnerPort) {}

  async load(scope: InputSnapshotScope, capturedAt: string): Promise<CognitiveRoadStateInputBinding | null> {
    validateScope(scope);
    const captureTime = timestamp(capturedAt, 'capturedAt');
    const owned = await this.owner.load(scope);
    if (owned === null) return null;
    validateOwnedRevision(owned, scope, captureTime);
    return Object.freeze({
      policyVersion: COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY,
      tenantId: scope.tenantId,
      purpose: scope.purpose,
      caseId: scope.caseId,
      capturedAt: new Date(captureTime).toISOString(),
      revision: owned.revision,
      digest: owned.digest,
      stateTime: new Date(timestamp(owned.state.stateTime, 'stateTime')).toISOString(),
      validUntil: new Date(timestamp(owned.state.validUntil, 'validUntil')).toISOString(),
      requiresAbstention: cognitiveStateRequiresAbstention(owned.state),
      authority: 'SOURCE_LEDGER'
    });
  }
}

function validateOwnedRevision(owned: OwnedCognitiveRoadStateRevision, scope: InputSnapshotScope, captureTime: number): void {
  if (owned.authority !== 'COGNITIVE_STATE_LEDGER') throw new Error('cognitive state authority is invalid');
  if (owned.tenantId !== scope.tenantId || owned.purpose !== scope.purpose || owned.caseId !== scope.caseId) {
    throw new Error('cognitive state scope mismatch');
  }
  if (!Number.isSafeInteger(owned.revision) || owned.revision < 1) throw new Error('cognitive state revision is invalid');
  if (!digest(owned.digest) || owned.state.schema !== COGNITIVE_ROAD_STATE_SCHEMA || owned.state.stateDigest !== owned.digest) {
    throw new Error('cognitive state digest is invalid');
  }
  const stateTime = timestamp(owned.state.stateTime, 'stateTime');
  const validUntil = timestamp(owned.state.validUntil, 'validUntil');
  if (validUntil <= stateTime || captureTime < stateTime || captureTime > validUntil) {
    throw new Error('cognitive state is outside the snapshot window');
  }
}

function validateScope(scope: InputSnapshotScope): void {
  for (const [field, value] of [['tenantId', scope.tenantId], ['purpose', scope.purpose]] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new TypeError(`${field} is invalid`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.caseId)) {
    throw new TypeError('caseId must be a UUID');
  }
}

function timestamp(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${field} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} is invalid`);
  return parsed;
}

function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
