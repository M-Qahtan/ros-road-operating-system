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

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly checks: Readonly<Record<string, 'configured' | 'missing'>>;
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

export function evaluateReadiness(environment: NodeJS.ProcessEnv): ReadinessResult {
  const checks = {
    database: environment.DATABASE_URL?.trim() ? 'configured' : 'missing',
    redis: environment.REDIS_URL?.trim() ? 'configured' : 'missing',
    objectStorage: environment.OBJECT_STORAGE_ENDPOINT?.trim() ? 'configured' : 'missing'
  } as const;
  return {
    status: Object.values(checks).every((value) => value === 'configured') ? 'ready' : 'not_ready',
    checks
  };
}
