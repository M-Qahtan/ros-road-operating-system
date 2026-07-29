import { connect } from 'node:net';

const REQUIRED_NON_DEVELOPMENT_VARIABLES = [
  'DATABASE_URL',
  'REDIS_URL',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
  'OBJECT_STORAGE_BUCKET',
  'JWT_SECRET'
] as const;

const UNSAFE_SECRET_FRAGMENTS = ['change-me', 'replace-with', 'password', 'secret'];
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

export type ReadinessCheck = 'missing' | 'reachable' | 'unreachable';

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Readonly<Record<'database' | 'redis' | 'objectStorage', ReadinessCheck>>;
}

export interface ReadinessProbes {
  readonly database: (databaseUrl: string) => Promise<boolean>;
  readonly redis: (redisUrl: string) => Promise<boolean>;
  readonly objectStorage: (endpoint: string) => Promise<boolean>;
}

export function validateRuntimeEnvironment(environment: NodeJS.ProcessEnv): void {
  if ((environment.NODE_ENV ?? 'development') === 'development') return;

  const missing = REQUIRED_NON_DEVELOPMENT_VARIABLES.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing required runtime variables: ${missing.join(', ')}`);

  for (const name of ['OBJECT_STORAGE_SECRET_KEY', 'JWT_SECRET'] as const) {
    const value = environment[name] ?? '';
    if (value.length < 32 || UNSAFE_SECRET_FRAGMENTS.some((fragment) => value.toLowerCase().includes(fragment))) {
      throw new Error(`${name} must be a strong externally supplied secret`);
    }
  }
}

function probeTcp(urlValue: string, defaultPort: number, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      resolve(reachable);
    };

    try {
      const url = new URL(urlValue);
      const port = url.port ? Number(url.port) : defaultPort;
      if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65_535) return finish(false);

      const socket = connect({ host: url.hostname, port });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        socket.destroy();
        finish(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        finish(false);
      });
      socket.once('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

async function probeObjectStorage(endpoint: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const response = await fetch(`${base}/minio/health/ready`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

const defaultProbes: ReadinessProbes = {
  database: (url) => probeTcp(url, 5432),
  redis: (url) => probeTcp(url, 6379),
  objectStorage: (endpoint) => probeObjectStorage(endpoint)
};

async function evaluateDependency(
  configuredValue: string | undefined,
  probe: (value: string) => Promise<boolean>
): Promise<ReadinessCheck> {
  const value = configuredValue?.trim();
  if (!value) return 'missing';
  return await probe(value) ? 'reachable' : 'unreachable';
}

export async function evaluateReadiness(
  environment: NodeJS.ProcessEnv,
  probes: ReadinessProbes = defaultProbes
): Promise<ReadinessResult> {
  const [database, redis, objectStorage] = await Promise.all([
    evaluateDependency(environment.DATABASE_URL, probes.database),
    evaluateDependency(environment.REDIS_URL, probes.redis),
    evaluateDependency(environment.OBJECT_STORAGE_ENDPOINT, probes.objectStorage)
  ]);

  const checks = { database, redis, objectStorage } as const;
  return {
    status: Object.values(checks).every((value) => value === 'reachable') ? 'ready' : 'not_ready',
    checks
  };
}
