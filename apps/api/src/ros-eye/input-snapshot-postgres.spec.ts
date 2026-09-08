import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafetyFusionInputSnapshot } from '@ros/contracts';
import type { ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  POSTGRES_INPUT_SNAPSHOT_SQL,
  PostgresInputSnapshotRepository,
  type CaptureInputSnapshotRequest
} from './input-snapshot-postgres.js';

const CASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const digest = (character: string) => character.repeat(64);
const revision = (value: number, character: string) => ({ revision: value, digest: digest(character) });

function snapshot(snapshotDigest = digest('1')): SafetyFusionInputSnapshot {
  return {
    policyVersion: 'ros-eye.input-snapshot.v1', tenantId: 'tenant-a', caseId: CASE_ID,
    inputVersion: 1, capturedAt: '2026-09-08T05:00:00.000Z', case: revision(7, 'a'),
    severity: revision(3, 'b'), contact: revision(4, 'c'), evidence: revision(9, 'd'),
    indicators: revision(2, 'e'), snapshotDigest
  };
}

function request(value = snapshot()): CaptureInputSnapshotRequest {
  return { tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID, expectedPreviousInputVersion: 0, snapshot: value };
}

function row(value: SafetyFusionInputSnapshot): ContactSqlRow {
  return {
    tenant_id: value.tenantId, purpose: 'human-safety', case_id: value.caseId,
    input_version: value.inputVersion, policy_version: value.policyVersion, captured_at: value.capturedAt,
    case_revision: value.case.revision, case_digest: value.case.digest,
    severity_revision: value.severity.revision, severity_digest: value.severity.digest,
    contact_revision: value.contact?.revision ?? null, contact_digest: value.contact?.digest ?? null,
    evidence_revision: value.evidence.revision, evidence_digest: value.evidence.digest,
    indicator_revision: value.indicators.revision, indicator_digest: value.indicators.digest,
    snapshot_digest: value.snapshotDigest
  };
}

class SnapshotPool implements ContactSqlPoolPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly stored = new Map<number, ContactSqlRow>();
  authorized = true;

  async transaction<T>(work: (connection: SnapshotPool) => Promise<T>): Promise<T> { return work(this); }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase) {
      return { rows: (this.authorized ? [{ authorized: 1 }] : []) as unknown as Row[], rowCount: this.authorized ? 1 : 0 };
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact) {
      const found = this.stored.get(Number(values[3]));
      return { rows: (found === undefined ? [] : [found]) as Row[], rowCount: found === undefined ? 0 : 1 };
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readLatestVersion) {
      const latest = [...this.stored.keys()].sort((a, b) => b - a)[0];
      return { rows: (latest === undefined ? [] : [{ input_version: latest }]) as unknown as Row[], rowCount: latest === undefined ? 0 : 1 };
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.insert) {
      const inputVersion = Number(values[3]);
      if (this.stored.has(inputVersion)) return { rows: [], rowCount: 0 };
      this.stored.set(inputVersion, row({
        policyVersion: String(values[4]) as SafetyFusionInputSnapshot['policyVersion'], tenantId: String(values[0]),
        caseId: String(values[2]), inputVersion, capturedAt: String(values[5]),
        case: { revision: Number(values[6]), digest: String(values[7]) },
        severity: { revision: Number(values[8]), digest: String(values[9]) },
        contact: values[10] === null ? null : { revision: Number(values[10]), digest: String(values[11]) },
        evidence: { revision: Number(values[12]), digest: String(values[13]) },
        indicators: { revision: Number(values[14]), digest: String(values[15]) }, snapshotDigest: String(values[16])
      }));
      return { rows: [], rowCount: 1 };
    }
    throw new Error('unexpected SQL');
  }
}

test('captures and reads an immutable snapshot only inside trusted tenant and purpose scope', async () => {
  const pool = new SnapshotPool();
  const repository = new PostgresInputSnapshotRepository(pool);
  assert.equal(await repository.capture(request()), 'CREATED');
  assert.deepEqual(await repository.read({ tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID }, 1), snapshot());
  const insert = pool.calls.find((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert);
  assert.deepEqual(insert?.values.slice(0, 4), ['tenant-a', 'human-safety', CASE_ID, 1]);
  assert.match(POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase, /tenant_id = \$1 AND purpose = \$2/);
  assert.match(POSTGRES_INPUT_SNAPSHOT_SQL.readExact, /tenant_id = \$1 AND purpose = \$2/);
});

test('exact replay is idempotent while a stale or different receipt conflicts', async () => {
  const pool = new SnapshotPool();
  const repository = new PostgresInputSnapshotRepository(pool);
  assert.equal(await repository.capture(request()), 'CREATED');
  assert.equal(await repository.capture(request()), 'IDEMPOTENT');
  assert.equal(await repository.capture(request(snapshot(digest('2')))), 'CONFLICT');
  assert.equal(pool.calls.filter((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert).length, 1);
});

test('concurrent writers have one created receipt and never overwrite the winner', async () => {
  const pool = new SnapshotPool();
  const repository = new PostgresInputSnapshotRepository(pool);
  const results = await Promise.all([
    repository.capture(request(snapshot(digest('1')))),
    repository.capture(request(snapshot(digest('2'))))
  ]);
  assert.deepEqual([...results].sort(), ['CONFLICT', 'CREATED']);
  assert.equal(pool.stored.size, 1);
  assert.equal((await repository.read({ tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID }, 1))?.snapshotDigest, digest('1'));
});

test('missing scoped RoadEvent and stale expected version fail closed before insert', async () => {
  const pool = new SnapshotPool();
  pool.authorized = false;
  const repository = new PostgresInputSnapshotRepository(pool);
  assert.equal(await repository.capture(request()), 'NOT_FOUND');
  assert.equal(pool.calls.some((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert), false);

  pool.authorized = true;
  pool.stored.set(1, row(snapshot()));
  const next = { ...snapshot(digest('2')), inputVersion: 3 };
  assert.equal(await repository.capture({ ...request(next), expectedPreviousInputVersion: 0 }), 'CONFLICT');
  assert.equal(pool.stored.has(3), false);
});

test('caller scope drift and malformed receipts are rejected before database access', async () => {
  const pool = new SnapshotPool();
  const repository = new PostgresInputSnapshotRepository(pool);
  await assert.rejects(() => repository.capture({ ...request(), tenantId: 'tenant-b' }), /scope/);
  await assert.rejects(() => repository.capture(request({ ...snapshot(), snapshotDigest: 'invalid' })), /receipt/);
  await assert.rejects(() => repository.read({ tenantId: 'tenant-a', purpose: 'human-safety', caseId: 'not-a-uuid' }, 1), /UUID/);
  assert.equal(pool.calls.length, 0);
});
