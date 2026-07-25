import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runPostgresMigrations } from './migration-runner.js';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

class MigrationClient implements PostgresClient {
  readonly statements: string[] = [];
  released = false;
  constructor(private readonly applied: ReadonlyMap<string, string> = new Map()) {}
  async query<Row = unknown>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.statements.push(text);
    if (text.startsWith('SELECT name, checksum')) {
      const name = String(values[0]);
      const checksum = this.applied.get(name);
      return { rows: checksum === undefined ? [] : [{ name, checksum }] as Row[], rowCount: checksum === undefined ? 0 : 1 };
    }
    return { rows: [], rowCount: null };
  }
  release(): void { this.released = true; }
}

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
