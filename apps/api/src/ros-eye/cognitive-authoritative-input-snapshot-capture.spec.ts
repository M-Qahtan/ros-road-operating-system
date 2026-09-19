import assert from 'node:assert/strict';
import test from 'node:test';
import { COGNITIVE_ROAD_STATE_SCHEMA, type CognitiveRoadState } from '@ros/contracts';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  CognitiveAuthoritativeInputSnapshotCaptureService,
  TransactionalCognitiveRoadStateSnapshotSource,
  type TransactionalCognitiveInputSourcePort
} from './cognitive-authoritative-input-snapshot-capture.js';
import { POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL } from './cognitive-input-snapshot-postgres.js';
import { AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL, type AuthoritativeInputSnapshotSources } from './input-snapshot-capture.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';

const CASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const SCOPE = { tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID } as const;
const CAPTURED_AT = '2026-09-19T12:00:02.000Z';
const digest = (character: string) => character.repeat(64);

function sources(): AuthoritativeInputSnapshotSources {
  const revision = (value: number, character: string) => ({ authority: 'SOURCE_LEDGER' as const, revision: value, digest: digest(character) });
  return {
    case: { async load() { return revision(7, 'a'); } },
    severity: { async load() { return revision(3, 'b'); } },
    contact: { async load() { return { status: 'PRESENT', binding: revision(4, 'c') }; } },
    evidence: { async load() { return revision(9, 'd'); } },
    indicators: { async load() { return revision(2, 'e'); } }
  };
}

function cognitiveState(): CognitiveRoadState {
  return {
    schema: COGNITIVE_ROAD_STATE_SCHEMA, crsId: 'crs-1', zoneId: 'RUH-Z41',
    stateTime: '2026-09-19T12:00:00.000Z', validUntil: '2026-09-19T12:00:05.000Z',
    stateDigest: digest('f'), sensorHealthDigest: digest('0'), entities: [], hazards: [], trafficState: {},
    environment: {}, signalState: {}, infrastructureState: {}, evidenceObservationIds: [], contradictions: [],
    epistemicSummary: { known: [], uncertain: [], unknown: [] }
  };
}

function cognitiveSource(pool: AtomicPool): TransactionalCognitiveInputSourcePort {
  return new TransactionalCognitiveRoadStateSnapshotSource({
    async load(connection, scope) {
      assert.equal(connection, pool);
      return { ...scope, authority: 'COGNITIVE_STATE_LEDGER', revision: 11, digest: digest('f'), state: cognitiveState() };
    }
  });
}

const request = { ...SCOPE, inputVersion: 1, expectedPreviousInputVersion: 0, capturedAt: CAPTURED_AT } as const;

class AtomicPool implements ContactSqlPoolPort {
  readonly calls: string[] = [];
  snapshots = new Map<number, ContactSqlRow>();
  bindings = new Map<number, ContactSqlRow>();
  commits = 0;
  rollbacks = 0;
  hideBaseFromBinding = false;
  failBindingInsert = false;

  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> {
    const snapshots = new Map(this.snapshots);
    const bindings = new Map(this.bindings);
    try {
      const result = await work(this);
      this.commits += 1;
      return result;
    } catch (error) {
      this.snapshots = snapshots;
      this.bindings = bindings;
      this.rollbacks += 1;
      throw error;
    }
  }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push(text);
    const typed = (rows: readonly ContactSqlRow[]) => result(rows) as unknown as ContactSqlQueryResult<Row>;
    if (text === AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL) return typed([]);
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase) return typed([{ authorized: 1 }]);
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) {
      const row = this.snapshots.get(Number(values[3]));
      return typed(row === undefined ? [] : [row]);
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readLatestVersion) {
      const latest = Math.max(0, ...this.snapshots.keys());
      return typed(latest === 0 ? [] : [{ input_version: latest }]);
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.insert) {
      const version = Number(values[3]);
      if (this.snapshots.has(version)) return typed([]);
      this.snapshots.set(version, baseRow(values));
      return { rows: [], rowCount: 1 } as ContactSqlQueryResult<Row>;
    }
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readExact) {
      const row = this.bindings.get(Number(values[3]));
      return typed(row === undefined ? [] : [row]);
    }
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.readBase) {
      if (this.hideBaseFromBinding) return typed([]);
      const row = this.snapshots.get(Number(values[3]));
      const present = row !== undefined && row.snapshot_digest === values[4] && row.captured_at === values[5];
      return typed(present ? [{ present: 1 }] : []);
    }
    if (text === POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert) {
      if (this.failBindingInsert) throw new Error('cognitive binding persistence failed');
      const version = Number(values[3]);
      if (this.bindings.has(version)) return typed([]);
      this.bindings.set(version, bindingRow(values));
      return { rows: [], rowCount: 1 } as ContactSqlQueryResult<Row>;
    }
    throw new Error(`unexpected SQL: ${text}`);
  }
}

test('captures owner state, v1 base and required v2 binding in one repeatable-read transaction', async () => {
  const pool = new AtomicPool();
  const service = new CognitiveAuthoritativeInputSnapshotCaptureService(pool, sources(), cognitiveSource(pool));
  assert.equal(await service.capture(request), 'CREATED');
  assert.equal(pool.commits, 1);
  assert.equal(pool.rollbacks, 0);
  assert.equal(pool.snapshots.size, 1);
  assert.equal(pool.bindings.size, 1);
  assert.equal(pool.calls[0], AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL);
  assert.ok(pool.calls.indexOf(POSTGRES_INPUT_SNAPSHOT_SQL.insert) < pool.calls.indexOf(POSTGRES_COGNITIVE_INPUT_SNAPSHOT_SQL.insert));
  assert.equal(pool.bindings.get(1)?.cognitive_revision, 11);
  assert.equal(pool.bindings.get(1)?.cognitive_authority, 'SOURCE_LEDGER');
});

test('an exact atomic replay is idempotent without adding either row', async () => {
  const pool = new AtomicPool();
  const service = new CognitiveAuthoritativeInputSnapshotCaptureService(pool, sources(), cognitiveSource(pool));
  assert.equal(await service.capture(request), 'CREATED');
  assert.equal(await service.capture(request), 'IDEMPOTENT');
  assert.equal(pool.snapshots.size, 1);
  assert.equal(pool.bindings.size, 1);
});

test('missing cognitive owner state writes neither the v1 base nor a v2 binding', async () => {
  const pool = new AtomicPool();
  const missing: TransactionalCognitiveInputSourcePort = { async load() { return null; } };
  const service = new CognitiveAuthoritativeInputSnapshotCaptureService(pool, sources(), missing);
  assert.equal(await service.capture(request), 'SOURCE_UNAVAILABLE');
  assert.equal(pool.snapshots.size, 0);
  assert.equal(pool.bindings.size, 0);
  assert.equal(pool.calls.includes(POSTGRES_INPUT_SNAPSHOT_SQL.insert), false);
});

test('a post-base fail-closed disposition rolls back instead of committing a partial v1 snapshot', async () => {
  const pool = new AtomicPool();
  pool.hideBaseFromBinding = true;
  const service = new CognitiveAuthoritativeInputSnapshotCaptureService(pool, sources(), cognitiveSource(pool));
  assert.equal(await service.capture(request), 'NOT_FOUND');
  assert.equal(pool.commits, 0);
  assert.equal(pool.rollbacks, 1);
  assert.equal(pool.snapshots.size, 0);
  assert.equal(pool.bindings.size, 0);
});

test('a binding persistence error rolls back the new base and preserves the original failure', async () => {
  const pool = new AtomicPool();
  pool.failBindingInsert = true;
  const service = new CognitiveAuthoritativeInputSnapshotCaptureService(pool, sources(), cognitiveSource(pool));
  await assert.rejects(service.capture(request), /cognitive binding persistence failed/);
  assert.equal(pool.commits, 0);
  assert.equal(pool.rollbacks, 1);
  assert.equal(pool.snapshots.size, 0);
  assert.equal(pool.bindings.size, 0);
});

function result<Row extends ContactSqlRow>(rows: readonly Row[]): ContactSqlQueryResult<Row> {
  return { rows, rowCount: rows.length };
}

function baseRow(values: readonly unknown[]): ContactSqlRow {
  return {
    tenant_id: values[0], purpose: values[1], case_id: values[2], input_version: values[3], policy_version: values[4],
    captured_at: values[5], case_revision: values[6], case_digest: values[7], severity_revision: values[8],
    severity_digest: values[9], contact_revision: values[10], contact_digest: values[11], evidence_revision: values[12],
    evidence_digest: values[13], indicator_revision: values[14], indicator_digest: values[15], snapshot_digest: values[16]
  };
}

function bindingRow(values: readonly unknown[]): ContactSqlRow {
  return {
    tenant_id: values[0], purpose: values[1], case_id: values[2], input_version: values[3], policy_version: values[4],
    base_snapshot_digest: values[5], captured_at: values[6], binding_policy_version: values[7],
    cognitive_authority: values[8], cognitive_revision: values[9], cognitive_digest: values[10],
    cognitive_state_time: values[11], cognitive_valid_until: values[12], cognitive_requires_abstention: values[13]
  };
}
