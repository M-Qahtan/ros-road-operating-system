import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContactSqlConnectionPort, ContactSqlPoolPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  AuthoritativeInputSnapshotCaptureService,
  AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL,
  type AuthoritativeInputSnapshotSources,
  type AuthoritativeRevisionReceipt
} from './input-snapshot-capture.js';
import { POSTGRES_INPUT_SNAPSHOT_SQL } from './input-snapshot-postgres.js';

const CASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const digest = (character: string) => character.repeat(64);
const receipt = (revision: number, character: string): AuthoritativeRevisionReceipt =>
  ({ authority: 'SOURCE_LEDGER', revision, digest: digest(character) });

class CapturePool implements ContactSqlPoolPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  transactionCount = 0;

  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    if (text === AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL) return { rows: [], rowCount: 0 };
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.authorizeCase) return { rows: [{ authorized: 1 }] as unknown as Row[], rowCount: 1 };
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.readExact || text === POSTGRES_INPUT_SNAPSHOT_SQL.readLatestVersion) {
      return { rows: [], rowCount: 0 };
    }
    if (text === POSTGRES_INPUT_SNAPSHOT_SQL.insert) return { rows: [], rowCount: 1 };
    throw new Error('unexpected SQL');
  }
}

function sources(
  order: string[] = [],
  overrides: Partial<AuthoritativeInputSnapshotSources> = {}
): AuthoritativeInputSnapshotSources {
  const source = (name: string, value: AuthoritativeRevisionReceipt | null) => ({
    async load(connection: ContactSqlConnectionPort) {
      assert.ok(connection instanceof CapturePool);
      order.push(name);
      return value;
    }
  });
  return {
    case: source('case', receipt(7, 'a')),
    severity: source('severity', receipt(3, 'b')),
    contact: { async load(connection) { assert.ok(connection instanceof CapturePool); order.push('contact'); return { status: 'PRESENT', binding: receipt(4, 'c') }; } },
    evidence: source('evidence', receipt(9, 'd')),
    indicators: source('indicators', receipt(2, 'e')),
    ...overrides
  };
}

const request = {
  tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID,
  inputVersion: 1, expectedPreviousInputVersion: 0, capturedAt: '2026-09-08T06:00:00.000Z'
} as const;

test('loads every module-owned receipt and appends the snapshot in one transaction', async () => {
  const pool = new CapturePool();
  const order: string[] = [];
  const service = new AuthoritativeInputSnapshotCaptureService(pool, sources(order));
  assert.equal(await service.capture(request), 'CREATED');
  assert.equal(pool.transactionCount, 1);
  assert.equal(pool.calls[0]?.text, AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL);
  assert.deepEqual(order, ['case', 'severity', 'contact', 'evidence', 'indicators']);
  const insert = pool.calls.find((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert);
  assert.deepEqual(insert?.values.slice(0, 6), ['tenant-a', 'human-safety', CASE_ID, 1, 'ros-eye.input-snapshot.v1', request.capturedAt]);
  assert.deepEqual(insert?.values.slice(6, 16), [7, digest('a'), 3, digest('b'), 4, digest('c'), 9, digest('d'), 2, digest('e')]);
  assert.match(String(insert?.values[16]), /^[a-f0-9]{64}$/);
});

test('canonical snapshot digest is deterministic across independent captures', async () => {
  const first = new CapturePool();
  const second = new CapturePool();
  await new AuthoritativeInputSnapshotCaptureService(first, sources()).capture(request);
  await new AuthoritativeInputSnapshotCaptureService(second, sources()).capture(request);
  const firstDigest = first.calls.find((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert)?.values[16];
  const secondDigest = second.calls.find((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert)?.values[16];
  assert.equal(firstDigest, secondDigest);
});

test('rejects projected evidence counts and missing indicator revisions before persistence', async () => {
  const projectedPool = new CapturePool();
  const projectedOrder: string[] = [];
  const projected = sources(projectedOrder, {
    evidence: { async load() { return { authority: 'PROJECTED_COUNT', revision: 9, digest: digest('d') } as unknown as AuthoritativeRevisionReceipt; } }
  });
  assert.equal(await new AuthoritativeInputSnapshotCaptureService(projectedPool, projected).capture(request), 'SOURCE_UNAVAILABLE');
  assert.deepEqual(projectedPool.calls.map((call) => call.text), [AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL]);
  assert.deepEqual(projectedOrder, ['case', 'severity', 'contact']);

  const missingPool = new CapturePool();
  const missing = sources([], { indicators: { async load() { return null; } } });
  assert.equal(await new AuthoritativeInputSnapshotCaptureService(missingPool, missing).capture(request), 'SOURCE_UNAVAILABLE');
  assert.deepEqual(missingPool.calls.map((call) => call.text), [AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL]);
});

test('fails at the first unavailable owner and does not query later modules', async () => {
  const pool = new CapturePool();
  const order: string[] = [];
  const missingCase = sources(order, { case: { async load() { order.push('case'); return null; } } });
  assert.equal(await new AuthoritativeInputSnapshotCaptureService(pool, missingCase).capture(request), 'SOURCE_UNAVAILABLE');
  assert.deepEqual(order, ['case']);
  assert.deepEqual(pool.calls.map((call) => call.text), [AUTHORITATIVE_SNAPSHOT_TRANSACTION_SQL]);
});

test('records explicit contact absence without fabricating a contact revision', async () => {
  const pool = new CapturePool();
  const noContact = sources([], { contact: { async load() { return { status: 'ABSENT' }; } } });
  assert.equal(await new AuthoritativeInputSnapshotCaptureService(pool, noContact).capture(request), 'CREATED');
  const values = pool.calls.find((call) => call.text === POSTGRES_INPUT_SNAPSHOT_SQL.insert)?.values;
  assert.equal(values?.[10], null);
  assert.equal(values?.[11], null);
});
