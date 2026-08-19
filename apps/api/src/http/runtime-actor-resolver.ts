import { RosRole } from '../application/ports.js';
import {
  ActorResolver,
  createActorResolverForEnvironment,
  createOidcRosActorResolver,
  TrustedRosActorPolicy
} from './actor-resolver.js';
import { HttpsJwksDocumentFetcher, JwksHttpFetchPort } from '../integrations/jwks-https-fetcher.js';
import { CachedJwksRs256KeyProvider } from '../integrations/jwks-key-provider.js';
import { Rs256OidcTokenVerifier } from '../integrations/oidc-rs256-verifier.js';

const ROS_ROLES = new Set<RosRole>([
  'OPERATOR',
  'SUPERVISOR',
  'AUDITOR',
  'INTEGRATION_SERVICE'
]);

export interface RuntimeActorResolverDependencies {
  readonly jwksFetch?: JwksHttpFetchPort;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for OIDC authentication`);
  return value;
}

function csv(environment: NodeJS.ProcessEnv, name: string): readonly string[] {
  const values = required(environment, name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${name} must contain unique comma-separated values`);
  }
  return values;
}

function roles(environment: NodeJS.ProcessEnv): readonly RosRole[] {
  const values = csv(environment, 'OIDC_ALLOWED_ROLES');
  if (values.some((value) => !ROS_ROLES.has(value as RosRole))) {
    throw new Error('OIDC_ALLOWED_ROLES contains an unsupported ROS role');
  }
  return values as readonly RosRole[];
}

function purposes(environment: NodeJS.ProcessEnv): readonly string[] {
  const values = csv(environment, 'OIDC_ALLOWED_PURPOSES');
  if (values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))) {
    throw new Error('OIDC_ALLOWED_PURPOSES contains an unsafe purpose');
  }
  return values;
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number
): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be at least ${minimum}`);
  }
  return value;
}

function httpsIssuer(raw: string): string {
  const configured = raw.trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('OIDC_ISSUER must be a valid URL');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('OIDC_ISSUER must be a credential-free HTTPS URL without a fragment');
  }
  // OIDC `iss` comparison is exact. Validate the configured URL but do not
  // add/remove a trailing slash or otherwise rewrite the trust value.
  return configured;
}

function simulationAuthAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'development' || nodeEnvironment === 'test') return true;
  const profile = (environment.ROS_AUTH_PROFILE ?? '').trim().toLowerCase();
  return nodeEnvironment !== 'production' && profile === 'simulation';
}

/**
 * Creates the runtime identity boundary without performing network I/O.
 * Network access occurs only when a bearer token needs a JWKS key.
 */
export function createRuntimeActorResolver(
  environment: NodeJS.ProcessEnv,
  dependencies: RuntimeActorResolverDependencies = {}
): ActorResolver {
  if (simulationAuthAllowed(environment)) {
    return createActorResolverForEnvironment(environment);
  }

  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const profile = (environment.ROS_AUTH_PROFILE ?? '').trim().toLowerCase();
  if (profile !== 'oidc') {
    throw new Error(
      `${nodeEnvironment || 'runtime'} requires ROS_AUTH_PROFILE=oidc or an explicit non-production simulation profile`
    );
  }

  const policy: TrustedRosActorPolicy = {
    issuer: httpsIssuer(required(environment, 'OIDC_ISSUER')),
    audience: required(environment, 'OIDC_AUDIENCE'),
    allowedClientIds: csv(environment, 'OIDC_ALLOWED_CLIENT_IDS'),
    allowedTenantIds: csv(environment, 'OIDC_ALLOWED_TENANT_IDS'),
    allowedPurposes: purposes(environment),
    allowedRoles: roles(environment),
    requireMfa: true,
    maxTokenAgeSeconds: integer(environment, 'OIDC_MAX_TOKEN_AGE_SECONDS', 600, 1),
    maxClockSkewSeconds: integer(environment, 'OIDC_MAX_CLOCK_SKEW_SECONDS', 30, 1)
  };

  const fetcher = new HttpsJwksDocumentFetcher(required(environment, 'OIDC_JWKS_URL'), {
    timeoutMs: integer(environment, 'OIDC_JWKS_TIMEOUT_MS', 2_000, 100),
    maximumBodyBytes: integer(environment, 'OIDC_JWKS_MAX_BODY_BYTES', 128 * 1024, 1_024),
    ...(dependencies.jwksFetch === undefined ? {} : { fetch: dependencies.jwksFetch })
  });
  const keys = new CachedJwksRs256KeyProvider(fetcher, {
    cacheTtlSeconds: integer(environment, 'OIDC_JWKS_CACHE_TTL_SECONDS', 300, 1),
    minimumRefreshIntervalSeconds: integer(environment, 'OIDC_JWKS_MIN_REFRESH_SECONDS', 5, 0)
  });
  const verifier = new Rs256OidcTokenVerifier(keys);
  return createActorResolverForEnvironment(
    environment,
    createOidcRosActorResolver(verifier, policy)
  );
}
