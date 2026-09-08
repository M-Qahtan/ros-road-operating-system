import {
  SAFETY_FUSION_MAX_EVIDENCE_AGE_MS,
  type HumanContactState,
  type SafetyFusionEvidence,
  type SafetyFusionInput,
  type SafetyFusionInputSnapshot,
  type SafetyFusionSourceType
} from '@ros/contracts';
import { PostgresEvidenceRevisionSource } from '../evidence/evidence-revision-source-postgres.js';
import type { ContactSqlConnectionPort, ContactSqlRow } from './contact-orchestration-postgres.js';
import { PostgresContactRevisionSource } from './contact-revision-source-postgres.js';
import type {
  AuthoritativeSafetyFusionInputPort,
  AuthoritativeSafetyFusionInputReceipt
} from './governed-recommendation-use-case.js';
import {
  SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
  type SafetyFusionEvidenceAuthorityPort,
  type SafetyFusionEvidenceAuthorityReceipt
} from './governed-safety-fusion.js';
import { PostgresHumanSafetyIndicatorSource } from './human-safety-indicator-source-postgres.js';
import { parseRecordedIndicators, type RecordedSafetyIndicator } from './human-safety-indicator-revision.js';
import type { AuthoritativeRevisionReceipt } from './input-snapshot-capture.js';
import type { InputSnapshotScope } from './input-snapshot-postgres.js';
import { PostgresRoadEventRevisionSource } from './road-event-revision-source-postgres.js';

interface RoadEventFusionRow extends ContactSqlRow {
  readonly case_id: string;
  readonly severity: string;
}
interface ContactFusionRow extends ContactSqlRow {
  readonly state: string;
  readonly last_interaction_at: Date | string;
}
interface IndicatorFusionRow extends ContactSqlRow {
  readonly indicator_set: unknown;
  readonly recorded_at: Date | string;
}
interface ActiveRuleRow extends ContactSqlRow {
  readonly rule_set_version: string;
  readonly threshold_version: string;
}

export const POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL = Object.freeze({
  roadEvent: `SELECT id::text AS case_id, severity::text AS severity
    FROM road_events WHERE tenant_id=$1 AND purpose=$2 AND id=$3::uuid FOR SHARE`,
  contacts: `SELECT state, last_interaction_at
    FROM ros_eye_contact_sessions WHERE tenant_id=$1 AND case_id=$2::uuid
    ORDER BY updated_at DESC, session_id DESC`,
  indicators: `SELECT indicator_set, recorded_at
    FROM human_safety_indicator_revision_ledger
    WHERE tenant_id=$1 AND purpose=$2 AND case_id=$3::uuid
    ORDER BY revision DESC LIMIT 1 FOR SHARE`,
  activeRule: `SELECT rule_set_version, threshold_version
    FROM ros_eye_safety_fusion_rule_sets WHERE status='ACTIVE' FOR SHARE`
});

/**
 * Transaction-scoped read model for governed fusion. It verifies all five
 * module-owned snapshot receipts and derives semantic evidence only from the
 * Human-Safety structured indicator ledger. Evidence-object counts or payloads
 * are never promoted into fusion evidence.
 */
export class PostgresAuthoritativeSafetyFusionInput implements AuthoritativeSafetyFusionInputPort {
  private readonly caseSource = new PostgresRoadEventRevisionSource('CASE');
  private readonly severitySource = new PostgresRoadEventRevisionSource('SEVERITY');
  private readonly contactSource = new PostgresContactRevisionSource();
  private readonly evidenceSource = new PostgresEvidenceRevisionSource();
  private readonly indicatorSource = new PostgresHumanSafetyIndicatorSource();

  async load(
    connection: ContactSqlConnectionPort,
    scope: InputSnapshotScope,
    snapshot: SafetyFusionInputSnapshot
  ): Promise<AuthoritativeSafetyFusionInputReceipt | null> {
    if (!sameSnapshotScope(scope, snapshot)) return null;

    const caseReceipt = await this.caseSource.load(connection, scope);
    if (!matches(caseReceipt, snapshot.case)) return null;
    const severityReceipt = await this.severitySource.load(connection, scope);
    if (!matches(severityReceipt, snapshot.severity)) return null;
    const contactReceipt = await this.contactSource.load(connection, scope);
    if (contactReceipt === null || (contactReceipt.status === 'ABSENT' ? snapshot.contact !== null : !matches(contactReceipt.binding, snapshot.contact))) return null;
    const evidenceReceipt = await this.evidenceSource.load(connection, scope);
    if (!matches(evidenceReceipt, snapshot.evidence)) return null;
    const indicatorReceipt = await this.indicatorSource.load(connection, scope);
    if (!matches(indicatorReceipt, snapshot.indicators)) return null;

    const event = await exactOne<RoadEventFusionRow>(connection, POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.roadEvent, [scope.tenantId, scope.purpose, scope.caseId]);
    if (event === null || event.case_id !== scope.caseId.toLowerCase() || !isSeverity(event.severity)) return null;
    const contacts = await connection.query<ContactFusionRow>(POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.contacts, [scope.tenantId, scope.caseId]);
    if (contacts.rows.length > 1 || contacts.rowCount !== contacts.rows.length) return null;
    if ((contactReceipt.status === 'ABSENT') !== (contacts.rows.length === 0)) return null;
    const contact = contacts.rows[0];
    if (contact !== undefined && (!isContactState(contact.state) || timestamp(contact.last_interaction_at) === null)) return null;
    const contactState: SafetyFusionInput['contactState'] = contact === undefined ? 'NOT_STARTED' : contact.state as HumanContactState;
    const contactLastInteractionAt = contact === undefined ? null : timestamp(contact.last_interaction_at);

    const indicators = await exactOne<IndicatorFusionRow>(connection, POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.indicators, [scope.tenantId, scope.purpose, scope.caseId]);
    const rule = await exactOne<ActiveRuleRow>(connection, POSTGRES_AUTHORITATIVE_FUSION_INPUT_SQL.activeRule, []);
    if (indicators === null || rule === null || !validVersion(rule.rule_set_version) || !validVersion(rule.threshold_version)) return null;
    const recordedAt = timestamp(indicators.recorded_at);
    if (recordedAt === null) return null;
    const effective = effectiveIndicators(parseRecordedIndicators(indicators.indicator_set));
    if (effective.length === 0) return null;
    const authority = new IndicatorEvidenceAuthority(scope, effective, recordedAt);
    const evidence = effective.map((indicator) => authority.evidenceFor(indicator));

    const input: SafetyFusionInput = Object.freeze({
      tenantId: scope.tenantId,
      caseId: scope.caseId,
      inputVersion: snapshot.inputVersion,
      currentSeverity: event.severity,
      contactState,
      contactLastInteractionAt,
      evidence: Object.freeze(evidence),
      requestedRuleSetVersion: rule.rule_set_version,
      requestedThresholdVersion: rule.threshold_version
    });
    return Object.freeze({
      authority: 'SOURCE_LEDGER',
      sourceSnapshotDigest: snapshot.snapshotDigest,
      input,
      evidenceAuthority: authority
    });
  }
}

class IndicatorEvidenceAuthority implements SafetyFusionEvidenceAuthorityPort {
  private readonly receipts = new Map<string, SafetyFusionEvidenceAuthorityReceipt>();

  constructor(scope: InputSnapshotScope, indicators: readonly RecordedSafetyIndicator[], private readonly recordedAt: string) {
    const expiresAt = new Date(Date.parse(recordedAt) + SAFETY_FUSION_MAX_EVIDENCE_AGE_MS).toISOString();
    for (const indicator of indicators) {
      const evidence = this.evidenceFor(indicator);
      this.receipts.set(evidence.evidenceId, Object.freeze({
        ...evidence,
        tenantId: scope.tenantId,
        caseId: scope.caseId,
        approvedPurpose: 'HUMAN_SAFETY_FUSION',
        status: 'ACTIVE',
        policyVersion: SAFETY_FUSION_EVIDENCE_AUTHORITY_POLICY_VERSION,
        issuedAt: recordedAt,
        expiresAt
      }));
    }
  }

  evidenceFor(indicator: RecordedSafetyIndicator): SafetyFusionEvidence {
    return Object.freeze({
      evidenceId: indicator.indicatorId,
      sourceRef: `indicator:${indicator.indicatorId}`,
      sourceType: sourceType(indicator.source),
      code: indicator.code,
      direction: indicator.code === 'PERSON_RESPONDED' ? 'SUPPORTS_SAFETY' : contextOnly(indicator.code) ? 'CONTEXT_ONLY' : 'SUPPORTS_RISK',
      observedAt: indicator.observedAt,
      receivedAt: this.recordedAt,
      reliability: indicator.confidence,
      integrity: 'VERIFIED',
      deviceCondition: 'UNKNOWN',
      corroborationGroup: `case:${indicator.indicatorId}`,
      locationQuality: 'UNKNOWN'
    });
  }

  async findEvidence(input: { tenantId: string; caseId: string; evidenceId: string; sourceRef: string }): Promise<SafetyFusionEvidenceAuthorityReceipt | null> {
    const receipt = this.receipts.get(input.evidenceId);
    return receipt !== undefined && receipt.tenantId === input.tenantId && receipt.caseId === input.caseId && receipt.sourceRef === input.sourceRef
      ? receipt : null;
  }
}

function effectiveIndicators(values: readonly RecordedSafetyIndicator[]): readonly RecordedSafetyIndicator[] {
  const superseded = new Set(values.flatMap((value) => value.supersedesIndicatorId === null ? [] : [value.supersedesIndicatorId]));
  return Object.freeze(values.filter((value) => !superseded.has(value.indicatorId)).sort((a, b) => a.indicatorId.localeCompare(b.indicatorId)));
}
function matches(receipt: AuthoritativeRevisionReceipt | null, expected: { revision: number; digest: string } | null): boolean {
  return receipt !== null && expected !== null && receipt.authority === 'SOURCE_LEDGER' && receipt.revision === expected.revision && receipt.digest === expected.digest;
}
function sameSnapshotScope(scope: InputSnapshotScope, snapshot: SafetyFusionInputSnapshot): boolean {
  return snapshot.tenantId === scope.tenantId && snapshot.caseId === scope.caseId && snapshot.inputVersion > 0 && /^[a-f0-9]{64}$/.test(snapshot.snapshotDigest);
}
async function exactOne<Row extends ContactSqlRow>(connection: ContactSqlConnectionPort, sql: string, values: readonly unknown[]): Promise<Row | null> {
  const result = await connection.query<Row>(sql, values);
  return result.rowCount === 1 && result.rows.length === 1 ? result.rows[0]! : null;
}
function timestamp(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function isSeverity(value: string): value is SafetyFusionInput['currentSeverity'] { return ['S0','S1','S2','S3','S4'].includes(value); }
function isContactState(value: string): value is HumanContactState {
  return ['CREATED','CONSENT_PENDING','LANGUAGE_SELECTION','CONTACTING','AWAITING_RESPONSE','PARTIAL_RESPONSE','RESPONSE_CONFIRMED','NO_RESPONSE','UNREACHABLE','DISCONNECTED','HUMAN_REVIEW','ESCALATED','COMPLETED'].includes(value);
}
function validVersion(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function sourceType(value: RecordedSafetyIndicator['source']): SafetyFusionSourceType {
  if (value === 'PERSON') return 'PERSON';
  if (value === 'OPERATOR') return 'OPERATOR';
  if (value === 'SIMULATION') return 'SIMULATION';
  return 'PHONE';
}
function contextOnly(code: RecordedSafetyIndicator['code']): boolean {
  return code === 'LOCATION_UNCERTAIN' || code === 'MULTIPLE_PEOPLE_REPORTED' || code === 'ACCESSIBILITY_SUPPORT_REQUIRED';
}
