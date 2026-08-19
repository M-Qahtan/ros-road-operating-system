import { AuthorizationDeniedError } from '../application/local-adapters.js';
import { AuthenticatedActor, RosRole } from '../application/ports.js';

export interface ActorResolver {
  resolve(headers: Readonly<Record<string, string | undefined>>): AuthenticatedActor;
}

const ALLOWED_ROLES = new Set<RosRole>([
  'OPERATOR',
  'SUPERVISOR',
  'AUDITOR',
  'INTEGRATION_SERVICE'
]);

function resolveSimulationHeaders(
  headers: Readonly<Record<string, string | undefined>>
): AuthenticatedActor {
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

/**
 * Self-attested actor headers exist only as a deterministic development/test
 * boundary. Production must inject a trusted OIDC/JWT-backed resolver before
 * RoadEvent routes can authorize a caller.
 */
export function createActorResolverForEnvironment(
  environment: NodeJS.ProcessEnv
): ActorResolver {
  if (simulationHeadersAllowed(environment)) {
    return { resolve: resolveSimulationHeaders };
  }

  return {
    resolve(): AuthenticatedActor {
      throw new AuthorizationDeniedError(
        'Trusted OIDC/JWT actor resolver is required; self-attested actor headers are disabled'
      );
    }
  };
}
