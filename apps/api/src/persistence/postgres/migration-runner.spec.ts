import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareMigrationSql, runPostgresMigrations } from './migration-runner.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

class MigrationClient implements PostgresClient {
  readonly statements: string[] = [];
  readonly calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  released = false;
  constructor(
    private readonly applied: ReadonlyMap<string, string> = new Map(),
    private readonly failWhenStatementIncludes?: string
  ) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.statements.push(text);
    this.calls.push({ text, values });
    if (this.failWhenStatementIncludes !== undefined && text.includes(this.failWhenStatementIncludes)) {
      throw new Error('simulated migration failure');
    }
    if (text.startsWith('SELECT name, checksum')) {
      const name = String(values[0]);
      const checksum = this.applied.get(name);
      return { rows: checksum === undefined ? [] : [{ name, checksum }] as Row[], rowCount: checksum === undefined ? 0 : 1 };
    }
    return { rows: [], rowCount: null };
  }
  release(): void { this.released = true; }
}

test('prepareMigrationSql strips one outer BEGIN/COMMIT wrapper but preserves the body', () => {
  const prepared = prepareMigrationSql('0006_wrapped.sql', 'BEGIN;\nSELECT 1;\nCOMMIT;\n');
  assert.equal(prepared.strippedOuterTransaction, true);
  assert.equal(prepared.sql, 'SELECT 1;\n');
});

test('prepareMigrationSql leaves migrations without an outer transaction unchanged', () => {
  const prepared = prepareMigrationSql('0001_plain.sql', 'SELECT 1;\n');
  assert.equal(prepared.strippedOuterTransaction, false);
  assert.equal(prepared.sql, 'SELECT 1;\n');
});

test('prepareMigrationSql rejects incomplete wrappers and transaction controls inside the body', () => {
  assert.throws(
    () => prepareMigrationSql('0001_partial.sql', 'BEGIN;\nSELECT 1;\n'),
    /incomplete outer transaction wrapper/
  );
  assert.throws(
    () => prepareMigrationSql('0002_internal.sql', 'SELECT 1;\nCOMMIT;\nSELECT 2;\n'),
    /unsupported transaction control/
  );
  assert.throws(
    () => prepareMigrationSql('0003_internal.sql', 'SELECT 1;\nSTART TRANSACTION;\nSELECT 2;\n'),
    /unsupported transaction control/
  );
});

class MigrationPool implements PostgresPool {
  constructor(readonly client: MigrationClient) {}
  async connect(): Promise<PostgresClient> { return this.client; }
}

test('migration runner applies files in lexical order under advisory lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ros-migrations-'));
  try {
    await writeFile(join(directory, '0002_second.sql'), 'SELECT 2;');
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'README.md'), 'ignored');
    const client = new MigrationClient();
    const result = await runPostgresMigrations(new MigrationPool(client), directory);

    assert.deepEqual(result.applied, ['0001_first.sql', '0002_second.sql']);
    assert.deepEqual(result.skipped, []);
    assert.ok(client.statements.indexOf('SELECT 1;') < client.statements.indexOf('SELECT 2;'));
    assert.match(client.statements[1]!, /pg_advisory_lock/);
    assert.match(client.statements.at(-1)!, /pg_advisory_unlock/);
    assert.equal(client.released, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration runner owns the transaction while checksumming the unmodified source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ros-migrations-'));
  try {
    const sourceSql = 'BEGIN;\nSELECT 42;\nCOMMIT;\n';
    await writeFile(join(directory, '0006_wrapped.sql'), sourceSql);
    const client = new MigrationClient();
    const result = await runPostgresMigrations(new MigrationPool(client), directory);

    assert.deepEqual(result.applied, ['0006_wrapped.sql']);
    const beginIndex = client.statements.indexOf('BEGIN');
    const bodyIndex = client.statements.indexOf('SELECT 42;\n');
    const ledgerIndex = client.statements.findIndex((statement) => statement.startsWith('INSERT INTO schema_migrations'));
    const commitIndex = client.statements.indexOf('COMMIT');
    const ledgerCall = client.calls[ledgerIndex];

    assert.ok(beginIndex >= 0);
    assert.ok(bodyIndex > beginIndex);
    assert.ok(ledgerIndex > bodyIndex);
    assert.ok(commitIndex > ledgerIndex);
    assert.equal(client.statements.filter((statement) => statement === 'BEGIN').length, 1);
    assert.equal(client.statements.filter((statement) => statement === 'COMMIT').length, 1);
    assert.equal(ledgerCall?.values[1], createHash('sha256').update(sourceSql).digest('hex'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration runner rolls back without recording the ledger when a migration body fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ros-migrations-'));
  try {
    await writeFile(join(directory, '0006_wrapped.sql'), 'BEGIN;\nSELECT fail_me;\nCOMMIT;\n');
    const client = new MigrationClient(new Map(), 'fail_me');

    await assert.rejects(
      () => runPostgresMigrations(new MigrationPool(client), directory),
      /simulated migration failure/
    );

    assert.ok(client.statements.includes('ROLLBACK'));
    assert.equal(
      client.statements.some((statement) => statement.startsWith('INSERT INTO schema_migrations')),
      false
    );
    assert.equal(client.released, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration runner rejects a changed checksum for an applied migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ros-migrations-'));
  try {
    await writeFile(join(directory, '0001_first.sql'), 'SELECT 1;');
    const client = new MigrationClient(new Map([['0001_first.sql', 'different-checksum']]));
    await assert.rejects(() => runPostgresMigrations(new MigrationPool(client), directory), /has changed checksum/);
    assert.equal(client.released, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
