import type { SafetyFusionClockPort } from '@ros/contracts';
import type { TrustedIntegrationPrincipal } from '../integrations/integration-principal.js';
import type { ContactSqlPoolPort } from './contact-orchestration-postgres.js';
import { PostgresTrustedActorRecommendationAuthorization } from './governed-recommendation-authorization.js';
import { GovernedRecommendationUseCase } from './governed-recommendation-use-case.js';
import {
  GovernedSafetyFusionOrchestrator,
  type SafetyFusionEvidenceAuthorityPort
} from './governed-safety-fusion.js';
import { PostgresAuthoritativeSafetyFusionInput } from './postgres-authoritative-safety-fusion-input.js';
import { PostgresRecommendationJournal } from './recommendation-journal-postgres.js';
import {
  ACTIVE_SAFETY_FUSION_RULE_SET,
  DEFAULT_SAFETY_FUSION_GUARDS,
  NodeSafetyFusionFingerprint,
  StaticSafetyFusionRegistry,
  SystemSafetyFusionClock
} from './safety-fusion.js';

const DENY_UNSCOPED_EVIDENCE: SafetyFusionEvidenceAuthorityPort = Object.freeze({
  async findEvidence() { return null; }
});

/** Internal composition root only. It deliberately exposes no HTTP handler. */
export function createPostgresGovernedRecommendationRuntime(input: {
  readonly pool: ContactSqlPoolPort;
  readonly principal: TrustedIntegrationPrincipal;
  readonly clock?: SafetyFusionClockPort;
}): GovernedRecommendationUseCase {
  const clock = input.clock ?? new SystemSafetyFusionClock();
  const registry = new StaticSafetyFusionRegistry([ACTIVE_SAFETY_FUSION_RULE_SET]);
  const fusion = new GovernedSafetyFusionOrchestrator(
    registry,
    DEFAULT_SAFETY_FUSION_GUARDS,
    clock,
    new NodeSafetyFusionFingerprint(),
    DENY_UNSCOPED_EVIDENCE
  );
  return new GovernedRecommendationUseCase(
    input.pool,
    new PostgresTrustedActorRecommendationAuthorization(input.pool, input.principal),
    new PostgresAuthoritativeSafetyFusionInput(),
    fusion,
    clock,
    new PostgresRecommendationJournal(input.pool, registry)
  );
}
