import assert from 'node:assert/strict';
import test from 'node:test';
import { COGNITIVE_ROAD_STATE_SCHEMA, type CognitiveRoadState } from '@ros/contracts';
import {
  COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY,
  CognitiveRoadStateSnapshotAdapter,
  type CognitiveRoadStateOwnerPort,
  type OwnedCognitiveRoadStateRevision
} from './cognitive-road-state-snapshot-adapter.js';

const CASE_ID = '018f2f7c-8b8a-4a2f-9f73-4d5e6f708192';
const SCOPE = { tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID } as const;
const DIGEST = 'a'.repeat(64);

function state(materialContradiction = false): CognitiveRoadState {
  return {
    schema: COGNITIVE_ROAD_STATE_SCHEMA,
    crsId: 'crs-001', zoneId: 'RUH-Z41', stateTime: '2026-09-19T12:00:00.000Z',
    validUntil: '2026-09-19T12:00:05.000Z', stateDigest: DIGEST, sensorHealthDigest: 'b'.repeat(64),
    entities: [], hazards: [], trafficState: {}, environment: {}, signalState: {}, infrastructureState: {},
    evidenceObservationIds: [],
    contradictions: materialContradiction ? [{
      contradictionId: 'conflict-1', observationIds: ['observation-1'], material: true, reason: 'MATERIAL_CONTRADICTION'
    }] : [],
    epistemicSummary: { known: [], uncertain: [], unknown: [] }
  };
}

function revision(overrides: Partial<OwnedCognitiveRoadStateRevision> = {}): OwnedCognitiveRoadStateRevision {
  return { ...SCOPE, authority: 'COGNITIVE_STATE_LEDGER', revision: 7, digest: DIGEST, state: state(), ...overrides };
}

function adapter(value: OwnedCognitiveRoadStateRevision | null): CognitiveRoadStateSnapshotAdapter {
  const owner: CognitiveRoadStateOwnerPort = { async load() { return value; } };
  return new CognitiveRoadStateSnapshotAdapter(owner);
}

test('binds an exact owner revision without exposing cognitive entities or observations', async () => {
  const binding = await adapter(revision()).load(SCOPE, '2026-09-19T12:00:02.000Z');
  assert.deepEqual(binding, {
    policyVersion: COGNITIVE_ROAD_STATE_INPUT_BINDING_POLICY, ...SCOPE,
    capturedAt: '2026-09-19T12:00:02.000Z', revision: 7, digest: DIGEST,
    stateTime: '2026-09-19T12:00:00.000Z', validUntil: '2026-09-19T12:00:05.000Z',
    requiresAbstention: false, authority: 'SOURCE_LEDGER'
  });
  assert.equal('state' in (binding as unknown as Record<string, unknown>), false);
});

test('propagates material cognitive contradiction only as mandatory abstention', async () => {
  const binding = await adapter(revision({ state: state(true) })).load(SCOPE, '2026-09-19T12:00:02.000Z');
  assert.equal(binding?.requiresAbstention, true);
});

test('missing owner state remains unavailable instead of inventing a revision', async () => {
  assert.equal(await adapter(null).load(SCOPE, '2026-09-19T12:00:02.000Z'), null);
});

test('cross-purpose owner state fails closed before creating a binding', async () => {
  await assert.rejects(
    () => adapter(revision({ purpose: 'traffic-efficiency' })).load(SCOPE, '2026-09-19T12:00:02.000Z'),
    /scope mismatch/
  );
});

test('digest drift and stale or future cognitive state fail closed', async () => {
  await assert.rejects(
    () => adapter(revision({ digest: 'c'.repeat(64) })).load(SCOPE, '2026-09-19T12:00:02.000Z'),
    /digest/
  );
  await assert.rejects(
    () => adapter(revision()).load(SCOPE, '2026-09-19T12:00:06.000Z'),
    /snapshot window/
  );
  await assert.rejects(
    () => adapter(revision()).load(SCOPE, '2026-09-19T11:59:59.000Z'),
    /snapshot window/
  );
});
