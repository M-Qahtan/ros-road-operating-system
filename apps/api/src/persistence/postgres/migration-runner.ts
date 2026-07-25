import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgresPool } from './postgres-types.js';

interface AppliedMigrationRow {
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
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
      const sql = await readFile(join(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<AppliedMigrationRow>('SELECT name, checksum FROM schema_migrations WHERE name = $1', [name]);
      const previous = existing.rows[0];
      if (previous !== undefined) {
        if (previous.checksum !== checksum) throw new Error(`Applied migration ${name} has changed checksum`);
        skipped.push(name);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
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
