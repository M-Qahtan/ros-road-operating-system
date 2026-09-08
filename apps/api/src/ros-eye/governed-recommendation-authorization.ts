import type { TrustedIntegrationPrincipal } from '../integrations/integration-principal.js';
import type { ContactSqlPoolPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import {
  GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION,
  type GovernedRecommendationActor,
  type GovernedRecommendationAuthorizationPort,
  type GovernedRecommendationAuthorizationReceipt
} from './governed-recommendation-use-case.js';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';

interface CaseAuthorizationRow extends ContactSqlRow { readonly case_id: string; }

const AUTHORIZED_HUMAN_ROLES = new Set(['OPERATOR', 'SUPERVISOR']);

export const POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL = `SELECT id::text AS case_id
  FROM road_events WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid` as const;

/**
 * Turns one cryptographically verified OIDC principal into a narrow, expiring
 * recommendation capability. It cannot authorize collection, dispatch,
 * severity changes, closure, or any operational action.
 */
export class PostgresTrustedActorRecommendationAuthorization implements GovernedRecommendationAuthorizationPort {
  constructor(
    private readonly pool: ContactSqlPoolPort,
    private readonly principal: TrustedIntegrationPrincipal
  ) {}

  async authorize(
    actor: GovernedRecommendationActor,
    scope: InputSnapshotScope
  ): Promise<GovernedRecommendationAuthorizationReceipt | null> {
    if (!this.validPrincipal(actor, scope)) return null;
    const found = await this.pool.query<CaseAuthorizationRow>(
      POSTGRES_GOVERNED_RECOMMENDATION_AUTHORIZATION_SQL,
      [scope.tenantId, scope.purpose, scope.caseId]
    );
    if (found.rowCount !== 1 || found.rows.length !== 1 || found.rows[0]!.case_id.toLowerCase() !== scope.caseId.toLowerCase()) {
      return null;
    }
    return Object.freeze({
      ...scope,
      actorId: actor.actorId,
      permission: 'EVALUATE_AND_RECORD_RECOMMENDATION',
      status: 'ACTIVE',
      policyVersion: GOVERNED_RECOMMENDATION_AUTHORIZATION_POLICY_VERSION,
      issuedAt: this.principal.issuedAt,
      expiresAt: this.principal.expiresAt
    });
  }

  private validPrincipal(actor: GovernedRecommendationActor, scope: InputSnapshotScope): boolean {
    return this.principal.subject === actor.actorId && this.principal.mfaVerified === true &&
      this.principal.tenantId === scope.tenantId && this.principal.purpose === scope.purpose &&
      this.principal.roles.some((role) => AUTHORIZED_HUMAN_ROLES.has(role)) &&
      Number.isFinite(Date.parse(this.principal.issuedAt)) && Number.isFinite(Date.parse(this.principal.expiresAt)) &&
      Date.parse(this.principal.issuedAt) < Date.parse(this.principal.expiresAt);
  }
}
