import {
  ActorResolver,
  createActorResolverForEnvironment,
  createOidcIntegrationActorResolver
} from './actor-resolver.js';
import {
  IntegrationPrincipalBinding,
  IntegrationPrincipalPolicy,
  IntegrationPrincipalRole,
  IntegrationPurpose
} from '../integrations/integration-principal.js';
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
const MAX_BINDINGS = 64;
const PRINCIPAL_ROLES = new Set<IntegrationPrincipalRole>([
  'FIELD_USER', 'OPERATOR', 'SUPERVISOR', 'AUDITOR', 'INTEGRATION_SERVICE'
]);

export interface RuntimeActorResolverDependencies { readonly jwksFetch?: JwksHttpFetchPort; }

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for OIDC authentication`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredBindingString(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OIDC_ALLOWED_BINDINGS ${field} must be a non-empty string`);
  }
  return value.trim();
}

function principalBindings(environment: NodeJS.ProcessEnv): readonly IntegrationPrincipalBinding[] {
  let raw: unknown;
  try {
    raw = JSON.parse(required(environment, 'OIDC_ALLOWED_BINDINGS')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('OIDC_ALLOWED_BINDINGS must be valid JSON');
    throw error;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BINDINGS) {
    throw new Error(`OIDC_ALLOWED_BINDINGS must contain between 1 and ${MAX_BINDINGS} bindings`);
  }

  const seen = new Set<string>();
  return raw.map((value): IntegrationPrincipalBinding => {
    if (!isRecord(value)) throw new Error('OIDC_ALLOWED_BINDINGS entries must be objects');
    const clientId = requiredBindingString(value, 'clientId');
    const tenantId = requiredBindingString(value, 'tenantId');
    const purpose = requiredBindingString(value, 'purpose') as IntegrationPurpose;
    if (!PURPOSES.has(purpose)) throw new Error('OIDC_ALLOWED_BINDINGS contains an unsupported purpose');
    const configuredRoles = value.roles;
    let roles: readonly IntegrationPrincipalRole[] | undefined;
    if (configuredRoles !== undefined) {
      if (!Array.isArray(configuredRoles) || configuredRoles.length === 0) {
        throw new Error('OIDC_ALLOWED_BINDINGS roles must be a non-empty array when supplied');
      }
      const parsed = configuredRoles.map((role) => {
        if (typeof role !== 'string' || !PRINCIPAL_ROLES.has(role as IntegrationPrincipalRole)) {
          throw new Error('OIDC_ALLOWED_BINDINGS contains an unsupported role');
        }
        return role as IntegrationPrincipalRole;
      });
      if (new Set(parsed).size !== parsed.length) {
        throw new Error('OIDC_ALLOWED_BINDINGS roles must be unique');
      }
      roles = Object.freeze(parsed);
    }
    const identity = JSON.stringify([clientId, tenantId, purpose]);
    if (seen.has(identity)) throw new Error('OIDC_ALLOWED_BINDINGS contains a duplicate binding');
    seen.add(identity);
    return Object.freeze({ clientId, tenantId, purpose, ...(roles === undefined ? {} : { roles }) });
  });
}

function integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return value;
}

function httpsIssuer(raw: string): string {
  const configured = raw.trim();
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new Error('OIDC_ISSUER must be a valid URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('OIDC_ISSUER must be a credential-free HTTPS URL without a fragment');
  }
  return configured;
}

function simulationAuthAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'development' || nodeEnvironment === 'test') return true;
  const profile = (environment.ROS_AUTH_PROFILE ?? '').trim().toLowerCase();
  return nodeEnvironment !== 'production' && profile === 'simulation';
}

export function createRuntimeActorResolver(
  environment: NodeJS.ProcessEnv,
  dependencies: RuntimeActorResolverDependencies = {}
): ActorResolver {
  if (simulationAuthAllowed(environment)) return createActorResolverForEnvironment(environment);

  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  const profile = (environment.ROS_AUTH_PROFILE ?? '').trim().toLowerCase();
  if (profile !== 'oidc') {
    throw new Error(`${nodeEnvironment || 'runtime'} requires ROS_AUTH_PROFILE=oidc or an explicit non-production simulation profile`);
  }

  const policy: IntegrationPrincipalPolicy = {
    issuer: httpsIssuer(required(environment, 'OIDC_ISSUER')),
    audience: required(environment, 'OIDC_AUDIENCE'),
    allowedBindings: principalBindings(environment),
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
  return createActorResolverForEnvironment(environment, createOidcIntegrationActorResolver(verifier, policy));
}
