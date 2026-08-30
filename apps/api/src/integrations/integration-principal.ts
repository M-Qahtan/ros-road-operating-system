export type IntegrationPurpose =
  | 'INCIDENT_TRIAGE'
  | 'EMERGENCY_COORDINATION'
  | 'TRAFFIC_COORDINATION'
  | 'INSURANCE_COORDINATION'
  | 'TOWING_COORDINATION'
  | 'ROUTE_COORDINATION';

export type IntegrationPrincipalRole =
  | 'FIELD_USER'
  | 'OPERATOR'
  | 'SUPERVISOR'
  | 'AUDITOR'
  | 'INTEGRATION_SERVICE';

export interface VerifiedOidcClaims {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly clientId: string;
  readonly tenantId: string;
  readonly purpose: string;
  readonly authenticationMethods: readonly string[];
  readonly roles?: readonly string[];
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
}

export interface OidcTokenVerifierPort {
  verifyBearerToken(token: string): Promise<VerifiedOidcClaims>;
}

export interface IntegrationPrincipalBinding {
  readonly clientId: string;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  /** Human roles provisioned for this exact client/tenant/purpose binding. */
  readonly roles?: readonly IntegrationPrincipalRole[];
}

export interface IntegrationPrincipalPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly allowedBindings: readonly IntegrationPrincipalBinding[];
  readonly requireMfa: boolean;
  readonly maxTokenAgeSeconds: number;
  readonly maxClockSkewSeconds: number;
}

export interface TrustedIntegrationPrincipal {
  readonly subject: string;
  readonly clientId: string;
  readonly tenantId: string;
  readonly purpose: IntegrationPurpose;
  readonly mfaVerified: boolean;
  readonly roles: readonly IntegrationPrincipalRole[];
}

export class IntegrationPrincipalError extends Error {
  override readonly name = 'IntegrationPrincipalError';
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new IntegrationPrincipalError(`${field} is required`);
  return normalized;
}

function hasAudience(audience: string | readonly string[], expected: string): boolean {
  return typeof audience === 'string' ? audience === expected : audience.includes(expected);
}

function validInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function authorizedBinding(
  bindings: readonly IntegrationPrincipalBinding[],
  clientId: string,
  tenantId: string,
  purpose: IntegrationPurpose
): IntegrationPrincipalBinding | undefined {
  return bindings.find((binding) =>
    binding.clientId === clientId &&
    binding.tenantId === tenantId &&
    binding.purpose === purpose
  );
}

const PRINCIPAL_ROLES = new Set<IntegrationPrincipalRole>([
  'FIELD_USER', 'OPERATOR', 'SUPERVISOR', 'AUDITOR', 'INTEGRATION_SERVICE'
]);

function trustedRoles(
  binding: IntegrationPrincipalBinding,
  claimedRoles: readonly string[] | undefined
): readonly IntegrationPrincipalRole[] {
  if (binding.roles === undefined) {
    if (claimedRoles !== undefined) {
      throw new IntegrationPrincipalError('OIDC roles are not authorized for this principal binding');
    }
    return Object.freeze(['INTEGRATION_SERVICE'] as const);
  }
  if (claimedRoles === undefined || claimedRoles.length === 0) {
    throw new IntegrationPrincipalError('Provisioned OIDC roles claim is required');
  }
  const roles = claimedRoles.map((role) => {
    if (!PRINCIPAL_ROLES.has(role as IntegrationPrincipalRole)) {
      throw new IntegrationPrincipalError('OIDC roles contain an unsupported role');
    }
    return role as IntegrationPrincipalRole;
  });
  if (new Set(roles).size !== roles.length) {
    throw new IntegrationPrincipalError('OIDC roles must be unique');
  }
  if (roles.some((role) => !binding.roles!.includes(role))) {
    throw new IntegrationPrincipalError('OIDC role is not allowlisted for this principal binding');
  }
  return Object.freeze([...roles]);
}

export async function resolveTrustedIntegrationPrincipal(
  bearerToken: string,
  verifier: OidcTokenVerifierPort,
  policy: IntegrationPrincipalPolicy,
  nowEpochSeconds = Math.floor(Date.now() / 1000)
): Promise<TrustedIntegrationPrincipal> {
  const token = nonEmpty(bearerToken, 'Bearer token');
  if (!validInteger(nowEpochSeconds)) throw new IntegrationPrincipalError('Verifier clock is invalid');
  if (!validInteger(policy.maxTokenAgeSeconds) || !validInteger(policy.maxClockSkewSeconds)) {
    throw new IntegrationPrincipalError('Token timing policy is invalid');
  }
  if (policy.allowedBindings.length === 0) {
    throw new IntegrationPrincipalError('At least one exact integration principal binding is required');
  }

  const claims = await verifier.verifyBearerToken(token);
  const subject = nonEmpty(claims.subject, 'subject');
  const tenantId = nonEmpty(claims.tenantId, 'tenantId');
  const clientId = nonEmpty(claims.clientId, 'clientId');
  const purpose = nonEmpty(claims.purpose, 'purpose') as IntegrationPurpose;

  if (claims.issuer !== policy.issuer) throw new IntegrationPrincipalError('OIDC issuer is not trusted');
  if (!hasAudience(claims.audience, policy.audience)) throw new IntegrationPrincipalError('OIDC audience is not trusted');
  const binding = authorizedBinding(policy.allowedBindings, clientId, tenantId, purpose);
  if (binding === undefined) {
    throw new IntegrationPrincipalError('OIDC principal binding is not authorized');
  }
  const roles = trustedRoles(binding, claims.roles);

  if (!validInteger(claims.issuedAtEpochSeconds) || !validInteger(claims.expiresAtEpochSeconds)) {
    throw new IntegrationPrincipalError('Token timestamps are invalid');
  }
  if (claims.issuedAtEpochSeconds > nowEpochSeconds + policy.maxClockSkewSeconds) {
    throw new IntegrationPrincipalError('Token issued-at time is in the future');
  }
  if (claims.expiresAtEpochSeconds <= nowEpochSeconds - policy.maxClockSkewSeconds) {
    throw new IntegrationPrincipalError('Token is expired');
  }
  if (nowEpochSeconds - claims.issuedAtEpochSeconds > policy.maxTokenAgeSeconds + policy.maxClockSkewSeconds) {
    throw new IntegrationPrincipalError('Token is older than the allowed session age');
  }

  const methods = claims.authenticationMethods.map((method) => method.trim().toLowerCase());
  const mfaVerified = methods.includes('mfa');
  if (policy.requireMfa && !mfaVerified) throw new IntegrationPrincipalError('Explicit MFA authentication is required');

  return Object.freeze({ subject, clientId, tenantId, purpose, mfaVerified, roles });
}
