import { AuthorizationDeniedError } from '../application/local-adapters.js';
import { AuthenticatedActor, RosRole } from '../application/ports.js';
import {
  IntegrationPrincipalPolicy,
  OidcTokenVerifierPort,
  resolveTrustedIntegrationPrincipal
} from '../integrations/integration-principal.js';

export interface ActorResolver {
  resolve(headers: Readonly<Record<string, string | undefined>>): Promise<AuthenticatedActor>;
}

const ALLOWED_ROLES = new Set<RosRole>([
  'OPERATOR',
  'SUPERVISOR',
  'AUDITOR',
  'INTEGRATION_SERVICE'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  return { actorId, roles };
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

/**
 * Adapts a cryptographically verified integration principal to the existing ROS
 * application actor seam. Only the dedicated INTEGRATION_SERVICE role is ever
 * granted here; caller-supplied role headers are ignored.
 *
 * RoadEvent application writes currently require UUID actor identifiers, so the
 * trusted OIDC subject must be the provisioned UUID of the integration service.
 * A clock seam is injectable solely to make time-bound verification deterministic
 * under tests and controlled simulations; production defaults to the system clock.
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
          roles: ['INTEGRATION_SERVICE']
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
