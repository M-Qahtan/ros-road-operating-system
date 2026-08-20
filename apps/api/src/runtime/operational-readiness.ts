export type ReadinessCheck = 'not_required' | 'reachable' | 'unreachable' | 'external_gate';

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly checks: {
    readonly database: ReadinessCheck;
    readonly redis: ReadinessCheck;
    readonly objectStorage: ReadinessCheck;
  };
}

export interface RuntimeReadinessProbes {
  readonly database?: () => Promise<void>;
  readonly redis?: () => Promise<void>;
}

// Must remain below the caller/readiness-client deadline so dependency loss is
// reported as an explicit HTTP 503 rather than a client-side timeout. The
// underlying PostgreSQL/Redis operations retain their own bounded timeouts.
const DEFAULT_PROBE_TIMEOUT_MS = 1_000;

function nodeEnvironment(environment: NodeJS.ProcessEnv): string {
  return (environment.NODE_ENV ?? 'development').trim().toLowerCase();
}

function runtimeProfile(environment: NodeJS.ProcessEnv): string {
  return (environment.ROS_RUNTIME_PROFILE ?? '').trim().toLowerCase();
}

function simulationMode(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnv = nodeEnvironment(environment);
  if (nodeEnv === 'development' || nodeEnv === 'test') return true;
  return nodeEnv !== 'production' && runtimeProfile(environment) === 'simulation';
}

/**
 * Validate only dependencies opened by the core RoadEvent process.
 *
 * OIDC trust inputs are validated by the actor-resolver factory. Evidence/Object
 * Storage inputs are validated by the Evidence runtime factory. Keeping those
 * contracts separate prevents the core API from requiring legacy static object
 * storage/JWT secrets for dependencies that are not active in this process.
 */
export function validateRuntimeEnvironment(environment: NodeJS.ProcessEnv): void {
  if (simulationMode(environment)) return;

  const nodeEnv = nodeEnvironment(environment);
  const profile = runtimeProfile(environment);
  if (nodeEnv !== 'production' && profile !== 'persistent') return;

  for (const name of ['DATABASE_URL', 'REDIS_URL'] as const) {
    if (!environment[name]?.trim()) throw new Error(`Missing required runtime variable: ${name}`);
  }
}

function timeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Readiness probe timed out')), milliseconds);
    timer.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function probe(operation: (() => Promise<void>) | undefined): Promise<ReadinessCheck> {
  if (operation === undefined) return 'not_required';
  try {
    await timeout(operation(), DEFAULT_PROBE_TIMEOUT_MS);
    return 'reachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Evaluate the dependencies held by the running process.
 *
 * Object Storage is an external release gate while no Evidence HTTP/API surface
 * is active in `main.ts`. The dedicated Object Storage Integration workflow
 * performs the PostgreSQL-backed EvidenceService -> MinIO/S3-compatible proof.
 * When Evidence becomes an active process dependency, add an authenticated
 * storage probe here rather than reintroducing a MinIO-specific health URL.
 */
export async function evaluateReadiness(probes: RuntimeReadinessProbes): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([
    probe(probes.database),
    probe(probes.redis)
  ]);
  const requiredChecks = [database, redis].filter((check) => check !== 'not_required');
  const ready = requiredChecks.every((check) => check === 'reachable');

  return {
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database,
      redis,
      objectStorage: 'external_gate'
    }
  };
}
