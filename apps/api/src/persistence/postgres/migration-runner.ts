import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresPool } from './postgres-types.js';

interface AppliedMigrationRow {
  readonly name: string;
  readonly checksum: string;
}

interface PreparedMigrationSql {
  readonly sql: string;
  readonly strippedOuterTransaction: boolean;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

const transactionControlLine =
  /^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END\s+TRANSACTION)\s*;\s*(?:--.*)?$/i;

export function prepareMigrationSql(name: string, sourceSql: string): PreparedMigrationSql {
  const normalized = sourceSql.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first += 1;

  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === '') last -= 1;

  if (first > last) throw new Error(`Migration ${name} is empty`);

  const firstLine = lines[first]!.trim().toUpperCase();
  const lastLine = lines[last]!.trim().toUpperCase();
  const hasOuterBegin = firstLine === 'BEGIN;';
  const hasOuterCommit = lastLine === 'COMMIT;';

  if (hasOuterBegin !== hasOuterCommit) {
    throw new Error(`Migration ${name} has an incomplete outer transaction wrapper`);
  }

  const preparedLines = [...lines];
  if (hasOuterBegin && hasOuterCommit) {
    preparedLines.splice(last, 1);
    preparedLines.splice(first, 1);
  }

  for (const line of preparedLines) {
    if (transactionControlLine.test(line)) {
      throw new Error(`Migration ${name} contains unsupported transaction control inside the migration body`);
    }
  }

  const sql = preparedLines.join('\n');
  if (sql.trim() === '') throw new Error(`Migration ${name} has no executable body`);

  return {
    sql,
    strippedOuterTransaction: hasOuterBegin && hasOuterCommit
  };
}

export async function runPostgresMigrations(pool: PostgresPool, migrationsDirectory: string): Promise<MigrationResult> {
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  let lockAcquired = false;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query("SELECT pg_advisory_lock(hashtext('ros-schema-migrations'))");
    lockAcquired = true;

    const names = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right));

    for (const name of names) {
      const sourceSql = await readFile(join(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sourceSql).digest('hex');
      const existing = await client.query<AppliedMigrationRow>('SELECT name, checksum FROM schema_migrations WHERE name = $1', [name]);
      const previous = existing.rows[0];
      if (previous !== undefined) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration ${name} has changed checksum`);
        skipped.push(name);
        continue;
      }

      const prepared = prepareMigrationSql(name, sourceSql);

      await client.query('BEGIN');
      try {
        await client.query(prepared.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied, skipped };
  } finally {
    try {
      if (lockAcquired) await client.query("SELECT pg_advisory_unlock(hashtext('ros-schema-migrations'))");
    } finally {
      client.release();
    }
  }
}
