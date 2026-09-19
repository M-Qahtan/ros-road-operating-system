import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import type { CognitiveRoadStateInputBinding } from './cognitive-road-state-snapshot-adapter.js';
import {
  COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION,
  POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL,
  PostgresCognitiveInputSnapshotRepository,
  type CaptureCognitiveInputSnapshotRequest
} from './cognitive-input-snapshot-postgres.js';

const CASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const SCOPE = { tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID } as const;
const BASE_DIGEST = 'a'.repeat(64);

function binding(overrides: Partial<CognitiveRoadStateInputBinding> = {}): CognitiveRoadStateInputBinding {
  return {
    ...SCOPE, policyVersion: 'ros-eye.cognitive-input-binding.v1', capturedAt: '2026-09-19T12:00:02.000Z',
    revision: 7, digest: 'b'.repeat(64), stateTime: '2026-09-19T12:00:00.000Z',
    validUntil: '2026-09-19T12:00:05.000Z', requiresAbstention: false, authority: 'SOURCE_LEDGER', ...overrides
  };
}

function request(overrides: Partial<CaptureCognitiveInputSnapshotRequest> = {}): CaptureCognitiveInputSnapshotRequest {
  return { ...SCOPE, inputVersion: 1, baseSnapshotDigest: BASE_DIGEST, binding: binding(), ...overrides };
}

function row(value: CaptureCognitiveInputSnapshotRequest): ContactSqlRow {
  return {
    ...snakeScope(value), input_version: value.inputVersion,
    policy_version: COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION,
    base_snapshot_digest: value.baseSnapshotDigest, captured_at: value.binding.capturedAt,
    binding_policy_version: value.binding.policyVersion, cognitive_authority: value.binding.authority,
    cognitive_revision: value.binding.revision, cognitive_digest: value.binding.digest,
    cognitive_state_time: value.binding.stateTime, cognitive_valid_until: value.binding.validUntil,
    cognitive_requires_abstention: value.binding.requiresAbstention
  };
}

function snakeScope(value: { readonly tenantId: string; readonly purpose: string; readonly caseId: string }): ContactSqlRow {
  return { tenant_id: value.tenantId, purpose: value.purpose, case_id: value.caseId };
}

class CognitivePool implements ContactSqlPoolPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  stored: ContactSqlRow | null = null;
  basePresent = true;

  async transaction<T>(work: (connection: CognitivePool) => Promise<T>): Promise<T> { return work(this); }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readExact) {
      return { rows: (this.stored === null ? [] : [this.stored]) as Row[], rowCount: this.stored === null ? 0 : 1 };
    }
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readBase) {
      return { rows: (this.basePresent ? [{ present: 1 }] : []) as unknown as Row[], rowCount: this.basePresent ? 1 : 0 };
    }
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert) {
      if (this.stored !== null) return { rows: [], rowCount: 0 };
      this.stored = row({
        tenantId: String(values[0]), purpose: String(values[1]), caseId: String(values[2]), inputVersion: Number(values[3]),
        baseSnapshotDigest: String(values[5]),
        binding: {
          tenantId: String(values[0]), purpose: String(values[1]), caseId: String(values[2]),
          policyVersion: String(values[7]) as CognitiveRoadStateInputBinding['policyVersion'],
          capturedAt: String(values[6]), authority: String(values[8]) as CognitiveRoadStateInputBinding['authority'],
          revision: Number(values[9]), digest: String(values[10]), stateTime: String(values[11]),
          validUntil: String(values[12]), requiresAbstention: Boolean(values[13])
        }
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error('unexpected SQL');
  }
}

test('persists and reads the required v2 binding only after the exact v1 base exists', async () => {
  const pool = new CognitivePool();
  const repository = new PostgresCognitiveInputSnapshotRepository(pool);
  assert.equal(await repository.capture(request()), 'CREATED');
  const receipt = await repository.read(SCOPE, 1);
  assert.equal(receipt?.policyVersion, COGNITIVE_INPUT_SNAPSHOT_POLICY_VERSION);
  assert.equal(receipt?.baseSnapshotDigest, BASE_DIGEST);
  assert.deepEqual(receipt?.cognitive, binding());
  const baseRead = pool.calls.find((call) => call.text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readBase);
  assert.deepEqual(baseRead?.values, ['tenant-a', 'human-safety', CASE_ID, 1, BASE_DIGEST, binding().capturedAt]);
});

test('an old v1 base is readable but never promoted when its required v2 binding is absent', async () => {
  const pool = new CognitivePool();
  const repository = new PostgresCognitiveInputSnapshotRepository(pool);
  assert.equal(await repository.read(SCOPE, 1), null);
  pool.basePresent = false;
  assert.equal(await repository.capture(request()), 'NOT_FOUND');
  assert.equal(pool.calls.some((call) => call.text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert), false);
});

test('exact replay is idempotent while binding drift conflicts without overwriting', async () => {
  const pool = new CognitivePool();
  const repository = new PostgresCognitiveInputSnapshotRepository(pool);
  assert.equal(await repository.capture(request()), 'CREATED');
  assert.equal(await repository.capture(request()), 'IDEMPOTENT');
  assert.equal(await repository.capture(request({ binding: binding({ digest: 'c'.repeat(64) }) })), 'CONFLICT');
  assert.equal(pool.calls.filter((call) => call.text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert).length, 1);
});

test('scope drift and invalid validity windows fail before database access', async () => {
  const pool = new CognitivePool();
  const repository = new PostgresCognitiveInputSnapshotRepository(pool);
  await assert.rejects(() => repository.capture(request({ tenantId: 'tenant-b' })), /scope/);
  await assert.rejects(() => repository.capture(request({ binding: binding({ validUntil: '2026-09-19T12:00:01.000Z' }) })), /binding/);
  await assert.rejects(() => repository.capture(request({ baseSnapshotDigest: 'invalid' })), /baseSnapshotDigest/);
  assert.equal(pool.calls.length, 0);
});

test('migration enforces an append-only, fully required v2 extension with exact v1 linkage', () => {
  const migration = readFileSync('database/migrations/0023_ros_eye_cognitive_input_snapshot_bindings.sql', 'utf8');
  assert.match(migration, /policy_version text NOT NULL CHECK \(policy_version = 'ros-eye\.input-snapshot\.v2'\)/);
  assert.match(migration, /binding_policy_version text NOT NULL CHECK \(binding_policy_version = 'ros-eye\.cognitive-input-binding\.v1'\)/);
  assert.match(migration, /cognitive_authority text NOT NULL CHECK \(cognitive_authority = 'SOURCE_LEDGER'\)/);
  assert.match(migration, /FOREIGN KEY \([\s\S]*base_snapshot_digest, captured_at[\s\S]*REFERENCES ros_eye_safety_fusion_input_snapshots/);
  assert.match(migration, /cognitive_state_time <= captured_at/);
  assert.match(migration, /captured_at <= cognitive_valid_until/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(migration, /UPDATE ros_eye_safety_fusion_input_snapshots/);
});
