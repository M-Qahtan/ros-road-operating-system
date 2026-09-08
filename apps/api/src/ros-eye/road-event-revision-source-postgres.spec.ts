import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContactSqlConnectionPort, ContactSqlQueryResult, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  POSTGRES_ROAD_EVENT_REVISION_SOURCE_SQL,
  PostgresRoadEventRevisionSource
} from './road-event-revision-source-postgres.js';

const CASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const scope = { tenantId: 'tenant-a', purpose: 'human-safety', caseId: CASE_ID } as const;

class RevisionConnection implements ContactSqlConnectionPort {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  constructor(readonly rows: readonly ContactSqlRow[]) {}
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: this.rows as readonly Row[], rowCount: this.rows.length };
  }
}

test('reads the latest case receipt from the exact tenant purpose and case scope', async () => {
  const connection = new RevisionConnection([{ revision: '7', digest: 'a'.repeat(64) }]);
  const source = new PostgresRoadEventRevisionSource('CASE');
  assert.deepEqual(await source.load(connection, scope), {
    authority: 'SOURCE_LEDGER', revision: 7, digest: 'a'.repeat(64)
  });
  assert.deepEqual(connection.calls[0]?.values, ['tenant-a', 'human-safety', CASE_ID, 'CASE']);
  assert.match(POSTGRES_ROAD_EVENT_REVISION_SOURCE_SQL, /tenant_id = \$1 AND purpose = \$2 AND case_id = \$3::uuid/);
  assert.match(POSTGRES_ROAD_EVENT_REVISION_SOURCE_SQL, /ORDER BY revision DESC[\s\S]*FOR SHARE/);
});

test('keeps severity ownership distinct from the case revision stream', async () => {
  const connection = new RevisionConnection([{ revision: 3, digest: 'b'.repeat(64) }]);
  const source = new PostgresRoadEventRevisionSource('SEVERITY');
  assert.equal((await source.load(connection, scope))?.revision, 3);
  assert.equal(connection.calls[0]?.values[3], 'SEVERITY');
});

test('missing ledger state remains unavailable instead of projecting road_events.version', async () => {
  const connection = new RevisionConnection([]);
  assert.equal(await new PostgresRoadEventRevisionSource('CASE').load(connection, scope), null);
  assert.equal(connection.calls.length, 1);
});

test('malformed ambiguous and cross-scope input fail closed', async () => {
  await assert.rejects(
    () => new PostgresRoadEventRevisionSource('CASE').load(new RevisionConnection([{ revision: 0, digest: 'a'.repeat(64) }]), scope),
    /revision/
  );
  await assert.rejects(
    () => new PostgresRoadEventRevisionSource('CASE').load(new RevisionConnection([{ revision: 1, digest: 'bad' }]), scope),
    /digest/
  );
  await assert.rejects(
    () => new PostgresRoadEventRevisionSource('CASE').load(
      new RevisionConnection([{ revision: 1, digest: 'a'.repeat(64) }, { revision: 2, digest: 'b'.repeat(64) }]), scope
    ),
    /ambiguous/
  );
  await assert.rejects(
    () => new PostgresRoadEventRevisionSource('CASE').load(new RevisionConnection([]), { ...scope, tenantId: ' tenant-a' }),
    /tenantId/
  );
});
