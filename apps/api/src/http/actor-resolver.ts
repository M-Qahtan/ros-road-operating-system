import { AuthorizationDeniedError } from '../application/local-adapters.js';
import { AuthenticatedActor, RosRole } from '../application/ports.js';
import {
  IntegrationPrincipalPolicy,
  OidcTokenVerifierPort,
  resolveTrustedIntegrationPrincipal,
  VerifiedOidcClaims
} from '../integrations/integration-principal.js';

export interface ActorResolver {
  resolve(headers: Readonly<Record<string, string | undefined>>): Promise<AuthenticatedActor>;
}

export interface TrustedRosActorPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly allowedClientIds: readonly string[];
  readonly allowedTenantIds: readonly string[];
  readonly allowedPurposes: readonly string[];
  readonly allowedRoles: readonly RosRole[];
  readonly requireMfa: boolean;
  readonly maxTokenAgeSeconds: number;
  readonly maxClockSkewSeconds: number;
}

const ALLOWED_ROLES = new Set<RosRole>([
  'OPERATOR',
  'SUPERVISOR',
  'AUDITOR',
  'INTEGRATION_SERVICE'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_ATTRIBUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requireSimulationScope(value: string | undefined, field: string): string {
  if (value === undefined || !ACCESS_ATTRIBUTE_PATTERN.test(value)) {
    throw new AuthorizationDeniedError(`Missing or invalid simulation ${field}`);
  }
  return value;
}

async function resolveSimulationHeaders(
  headers: Readonly<Record<string, string | undefined>>
): Promise<AuthenticatedActor> {
  const actorId = headers['x-actor-id'];
  const rawRoles = headers['x-ros-roles'];
  if (actorId === undefined || rawRoles === undefined) {
    throw new AuthorizationDeniedError('Missing actor identity headers');
  }

  const roles = rawRoles
    .split(',')
    .map((role) => role.trim())
    .filter((role): role is RosRole => ALLOWED_ROLES.has(role as RosRole));

  if (roles.length === 0) {
    throw new AuthorizationDeniedError('No recognized ROS role was supplied');
  }

  return {
    actorId,
    roles,
    tenantId: requireSimulationScope(headers['x-tenant-id'], 'tenant'),
    purpose: requireSimulationScope(headers['x-purpose'], 'purpose')
  };
}

function simulationHeadersAllowed(environment: NodeJS.ProcessEnv): boolean {
  const nodeEnvironment = (environment.NODE_ENV ?? 'development').trim().toLowerCase();
  if (nodeEnvironment === 'development' || nodeEnvironment === 'test') return true;

  const authProfile = (environment.ROS_AUTH_PROFILE ?? '').trim().toLowerCase();
  return nodeEnvironment !== 'production' && authProfile === 'simulation';
}

function bearerToken(headers: Readonly<Record<string, string | undefined>>): string {
  const authorization = headers.authorization;
  if (authorization === undefined) {
    throw new AuthorizationDeniedError('Bearer authorization is required');
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (match === null) throw new AuthorizationDeniedError('Bearer authorization is malformed');
  return match[1]!;
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required`);
  return normalized;
}

function hasAudience(audience: string | readonly string[], expected: string): boolean {
  return typeof audience === 'string' ? audience === expected : audience.includes(expected);
}

function safeClock(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function mfaVerified(claims: VerifiedOidcClaims): boolean {
  const methods = claims.authenticationMethods.map((method) => method.trim().toLowerCase());
  return methods.includes('mfa') || methods.includes('otp') || methods.includes('hwk');
}

function trustedRosRoles(claims: VerifiedOidcClaims, policy: TrustedRosActorPolicy): readonly RosRole[] {
  if (claims.roles.length === 0 || new Set(claims.roles).size !== claims.roles.length) {
    throw new Error('OIDC ROS roles are missing or duplicated');
  }
  const roles = claims.roles.map((role) => role.trim());
  if (roles.some((role) => !ALLOWED_ROLES.has(role as RosRole))) {
    throw new Error('OIDC token contains an unknown ROS role');
  }
  if (roles.some((role) => !policy.allowedRoles.includes(role as RosRole))) {
    throw new Error('OIDC token contains a ROS role outside the runtime allowlist');
  }
  return roles as readonly RosRole[];
}

function validateTrustedRosClaims(
  claims: VerifiedOidcClaims,
  policy: TrustedRosActorPolicy,
  nowEpochSeconds: number
): AuthenticatedActor {
  if (!safeClock(nowEpochSeconds)) throw new Error('OIDC resolver clock is invalid');
  if (!safeClock(policy.maxTokenAgeSeconds) || !safeClock(policy.maxClockSkewSeconds)) {
    throw new Error('OIDC timing policy is invalid');
  }

  const actorId = nonEmpty(claims.subject, 'subject');
  const clientId = nonEmpty(claims.clientId, 'clientId');
  const tenantId = nonEmpty(claims.tenantId, 'tenantId');
  const purpose = nonEmpty(claims.purpose, 'purpose');
  if (!UUID_PATTERN.test(actorId)) throw new Error('Trusted OIDC subject is not a provisioned ROS UUID');
  if (!ACCESS_ATTRIBUTE_PATTERN.test(tenantId) || !ACCESS_ATTRIBUTE_PATTERN.test(purpose)) {
    throw new Error('Trusted OIDC access scope is malformed');
  }
  if (claims.issuer !== policy.issuer) throw new Error('OIDC issuer is not trusted');
  if (!hasAudience(claims.audience, policy.audience)) throw new Error('OIDC audience is not trusted');
  if (!policy.allowedClientIds.includes(clientId)) throw new Error('OIDC client is not authorized');
  if (!policy.allowedTenantIds.includes(tenantId)) throw new Error('OIDC tenant is not authorized');
  if (!policy.allowedPurposes.includes(purpose)) throw new Error('OIDC purpose is not authorized');

  if (!safeClock(claims.issuedAtEpochSeconds) || !safeClock(claims.expiresAtEpochSeconds)) {
    throw new Error('OIDC token timestamps are invalid');
  }
  if (claims.issuedAtEpochSeconds > nowEpochSeconds + policy.maxClockSkewSeconds) {
    throw new Error('OIDC token issued-at time is in the future');
  }
  if (claims.expiresAtEpochSeconds <= nowEpochSeconds - policy.maxClockSkewSeconds) {
    throw new Error('OIDC token is expired');
  }
  if (nowEpochSeconds - claims.issuedAtEpochSeconds > policy.maxTokenAgeSeconds + policy.maxClockSkewSeconds) {
    throw new Error('OIDC token is older than the allowed session age');
  }
  if (policy.requireMfa && !mfaVerified(claims)) throw new Error('MFA authentication is required');

  return Object.freeze({
    actorId,
    roles: trustedRosRoles(claims, policy),
    tenantId,
    purpose
  });
}

/**
 * General ROS runtime OIDC resolver used by RoadEvent HTTP. Identity, roles,
 * tenant, purpose and MFA context all come from cryptographically verified JWT
 * claims and are checked against explicit runtime allowlists. Request headers
 * cannot override any authorization attribute.
 */
export function createOidcRosActorResolver(
  verifier: OidcTokenVerifierPort,
  policy: TrustedRosActorPolicy,
  nowEpochSeconds: () => number = () => Math.floor(Date.now() / 1000)
): ActorResolver {
  return {
    async resolve(headers): Promise<AuthenticatedActor> {
      try {
        const claims = await verifier.verifyBearerToken(bearerToken(headers));
        return validateTrustedRosClaims(claims, policy, nowEpochSeconds());
      } catch (error) {
        if (error instanceof AuthorizationDeniedError) throw error;
        throw new AuthorizationDeniedError('Trusted OIDC/JWT identity could not be verified');
      }
    }
  };
}

/**
 * Dedicated integration-service resolver retained for provider adapter paths.
 * It intentionally grants only INTEGRATION_SERVICE and still derives tenant and
 * purpose from cryptographically verified integration claims.
 */
export function createOidcIntegrationActorResolver(
  verifier: OidcTokenVerifierPort,
  policy: IntegrationPrincipalPolicy,
  nowEpochSeconds: () => number = () => Math.floor(Date.now() / 1000)
): ActorResolver {
  return {
    async resolve(headers): Promise<AuthenticatedActor> {
      try {
        const now = nowEpochSeconds();
        if (!Number.isSafeInteger(now) || now <= 0) {
          throw new Error('OIDC resolver clock is invalid');
        }
        const principal = await resolveTrustedIntegrationPrincipal(
          bearerToken(headers),
          verifier,
          policy,
          now
        );
        if (!UUID_PATTERN.test(principal.subject)) {
          throw new Error('Trusted integration subject is not a provisioned ROS UUID');
        }
        return {
          actorId: principal.subject,
          roles: ['INTEGRATION_SERVICE'],
          tenantId: principal.tenantId,
          purpose: principal.purpose
        };
      } catch (error) {
        if (error instanceof AuthorizationDeniedError) throw error;
        throw new AuthorizationDeniedError('Trusted OIDC/JWT identity could not be verified');
      }
    }
  };
}

/**
 * Self-attested actor headers exist only as a deterministic development/test
 * boundary. Non-simulation environments must inject a trusted async resolver;
 * otherwise access fails closed.
 */
export function createActorResolverForEnvironment(
  environment: NodeJS.ProcessEnv,
  trustedResolver?: ActorResolver
): ActorResolver {
  if (simulationHeadersAllowed(environment)) {
    return { resolve: resolveSimulationHeaders };
  }

  if (trustedResolver !== undefined) return trustedResolver;

  return {
    async resolve(): Promise<AuthenticatedActor> {
      throw new AuthorizationDeniedError(
        'Trusted OIDC/JWT actor resolver is required; self-attested actor headers are disabled'
      );
    }
  };
}
