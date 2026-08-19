import {
  ActorResolver,
  createActorResolverForEnvironment,
  createOidcIntegrationActorResolver
} from './actor-resolver.js';
import { IntegrationPrincipalPolicy, IntegrationPurpose } from '../integrations/integration-principal.js';
import { HttpsJwksDocumentFetcher, JwksHttpFetchPort } from '../integrations/jwks-https-fetcher.js';
import { CachedJwksRs256KeyProvider } from '../integrations/jwks-key-provider.js';
import { Rs256OidcTokenVerifier } from '../integrations/oidc-rs256-verifier.js';

const PURPOSES = new Set<IntegrationPurpose>([
  'INCIDENT_TRIAGE',
  'EMERGENCY_COORDINATION',
  'TRAFFIC_COORDINATION',
  'INSURANCE_COORDINATION',
  'TOWING_COORDINATION',
  'ROUTE_COORDINATION'
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

function purposes(environment: NodeJS.ProcessEnv): readonly IntegrationPurpose[] {
  const values = csv(environment, 'OIDC_ALLOWED_PURPOSES');
  if (values.some((value) => !PURPOSES.has(value as IntegrationPurpose))) {
    throw new Error('OIDC_ALLOWED_PURPOSES contains an unsupported purpose');
  }
  return values as readonly IntegrationPurpose[];
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
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OIDC_ISSUER must be a valid URL');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('OIDC_ISSUER must be a credential-free HTTPS URL without a fragment');
  }
  return url.toString().replace(/\/$/, '');
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

  const policy: IntegrationPrincipalPolicy = {
    issuer: httpsIssuer(required(environment, 'OIDC_ISSUER')),
    audience: required(environment, 'OIDC_AUDIENCE'),
    allowedClientIds: csv(environment, 'OIDC_ALLOWED_CLIENT_IDS'),
    allowedTenantIds: csv(environment, 'OIDC_ALLOWED_TENANT_IDS'),
    allowedPurposes: purposes(environment),
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
    createOidcIntegrationActorResolver(verifier, policy)
  );
}
