import { Pool, PoolConfig } from 'pg';
import { PostgresClient, PostgresPool, PostgresQueryResult } from './postgres-types.js';

const DEFAULT_POOL_MAX = 10;
const MAX_POOL_MAX = 100;
const DEFAULT_CONNECTION_TIMEOUT_MS = 2_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const REQUIRED_RUNTIME_RELATIONS = Object.freeze([
  'road_events',
  'road_event_access_scopes',
  'idempotency_records',
  'idempotency_reservations',
  'audit_logs',
  'outbox_events',
  'road_event_signals'
]);

interface RuntimeSchemaProbeRow {
  readonly relation_name: string;
}

export interface PgRuntimePool extends PostgresPool {
  verifyConnection(): Promise<void>;
  verifyReadiness(): Promise<void>;
  close(): Promise<void>;
}

export class PostgresRuntimeConfigurationError extends Error {
  override readonly name = 'PostgresRuntimeConfigurationError';
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new PostgresRuntimeConfigurationError(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PostgresRuntimeConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new PostgresRuntimeConfigurationError(`${name} is required`);
  return value;
}

function parseDatabaseUrl(raw: string): {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PostgresRuntimeConfigurationError('DATABASE_URL is invalid');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new PostgresRuntimeConfigurationError('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!url.hostname) throw new PostgresRuntimeConfigurationError('DATABASE_URL must include a hostname');
  if (url.hash) throw new PostgresRuntimeConfigurationError('DATABASE_URL must not include a fragment');
  if (url.search) {
    throw new PostgresRuntimeConfigurationError(
      'DATABASE_URL query parameters are not allowed; configure TLS and pool policy through ROS runtime variables'
    );
  }
  const port = url.port === '' ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PostgresRuntimeConfigurationError('DATABASE_URL port is invalid');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  const user = decodeURIComponent(url.username).trim();
  const password = decodeURIComponent(url.password);
  if (!database) throw new PostgresRuntimeConfigurationError('DATABASE_URL database name is required');
  if (!user) throw new PostgresRuntimeConfigurationError('DATABASE_URL user is required');
  if (!password) throw new PostgresRuntimeConfigurationError('DATABASE_URL password/token is required');
  return { host: url.hostname, port, database, user, password };
}

export function buildPgPoolConfig(environment: NodeJS.ProcessEnv): PoolConfig {
  const connection = parseDatabaseUrl(required(environment, 'DATABASE_URL'));
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const ca = environment.DATABASE_SSL_CA_PEM?.trim();

  if (nodeEnvironment === 'production' && !ca) {
    throw new PostgresRuntimeConfigurationError(
      'DATABASE_SSL_CA_PEM is required in production for verified PostgreSQL TLS'
    );
  }

  return {
    ...connection,
    max: integer(environment, 'DATABASE_POOL_MAX', DEFAULT_POOL_MAX, 1, MAX_POOL_MAX),
    connectionTimeoutMillis: integer(
      environment,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      100,
      60_000
    ),
    idleTimeoutMillis: integer(
      environment,
      'DATABASE_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      300_000
    ),
    allowExitOnIdle: false,
    ...(ca === undefined || ca === ''
      ? { ssl: false }
      : { ssl: { ca, rejectUnauthorized: true } })
  };
}

export class NodePostgresPool implements PgRuntimePool {
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on('error', () => {
      // Idle-client errors are intentionally not logged here because connection
      // objects may carry sensitive configuration. Readiness/telemetry records
      // only dependency state, never credentials.
    });
  }

  async connect(): Promise<PostgresClient> {
    const client = await this.pool.connect();
    let released = false;
    return {
      async query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
        const result = await client.query(text, values === undefined ? [] : [...values]);
        return {
          rows: result.rows as readonly Row[],
          rowCount: result.rowCount
        };
      },
      release(): void {
        if (released) return;
        released = true;
        client.release();
      }
    };
  }

  async verifyConnection(): Promise<void> {
    const client = await this.connect();
    try {
      await client.query('SELECT 1 AS ros_runtime_probe');
    } finally {
      client.release();
    }
  }

  async verifyReadiness(): Promise<void> {
    const client = await this.connect();
    try {
      await client.query('SELECT 1 AS ros_runtime_probe');
      const result = await client.query<RuntimeSchemaProbeRow>(
        `SELECT required.relation_name
         FROM unnest($1::text[]) AS required(relation_name)
         WHERE to_regclass('public.' || required.relation_name) IS NULL`,
        [REQUIRED_RUNTIME_RELATIONS]
      );
      if (result.rows.length > 0) {
        const missing = result.rows.map((row) => row.relation_name).sort().join(', ');
        throw new Error(`PostgreSQL runtime schema is incomplete: ${missing}`);
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createNodePostgresPool(environment: NodeJS.ProcessEnv): PgRuntimePool {
  return new NodePostgresPool(buildPgPoolConfig(environment));
}
