export const PRIVACY_POLICY_VERSION = 'ros-eye.privacy-security.v3' as const;
export const BREAK_GLASS_MAX_MS = 900_000;

export type DataKind = 'SIGNAL'|'INDICATOR'|'CONVERSATION_METADATA'|'CONVERSATION_RAW'|'EVIDENCE_METADATA'|'EVIDENCE_RAW'|'PRECISE_LOCATION'|'RAW_TOKEN'|'OPERATOR_VIEW';
export type Purpose = 'SAFETY_CONTACT'|'INCIDENT_TRIAGE'|'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'|'RETENTION_ADMIN';
export type Lifecycle = 'INACTIVE'|'CONSENT_PENDING'|'LANGUAGE_SELECTION'|'ACTIVE'|'REVOKED'|'EXPIRED'|'LEGAL_HOLD'|'DELETION_PENDING';
export type Role = 'SYSTEM_WORKER'|'SAFETY_OPERATOR'|'SECURITY_REVIEWER'|'RETENTION_ADMIN'|'AUDITOR';
export type Action = 'READ'|'MASKED_READ'|'WRITE'|'DELETE'|'EXPORT';

export interface Scope { readonly tenantId:string; readonly caseId:string }
export interface BreakGlassLease extends Scope { readonly leaseId:string; readonly actorId:string; readonly role:'SAFETY_OPERATOR'|'SECURITY_REVIEWER'; readonly purpose:'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'; readonly reasonCode:string; readonly issuedAt:string; readonly expiresAt:string; readonly reviewedAt:string|null; readonly revokedAt?:string|null }
export interface AccessRequest extends Scope {
 readonly actorId:string; readonly actorTenantId:string; readonly actorCaseId:string; readonly role:Role; readonly purpose:Purpose;
 readonly lifecycle:Lifecycle; readonly dataKind:DataKind; readonly action:Action; readonly now:string; readonly breakGlass:BreakGlassLease|null;
 readonly sessionId:string|null; readonly subjectId:string|null; readonly consentGrantId:string|null; readonly idempotencyKey?:string;
}
export interface AccessDecision { readonly allowed:boolean; readonly mode:'DENY'|'MASKED'|'FULL'; readonly reasonCode:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION; readonly receiptId?:string }

export interface ConsentGrantReceipt extends Scope {
 readonly grantId:string; readonly sessionId:string; readonly subjectId:string; readonly purposes:readonly Purpose[];
 readonly dataKinds:readonly DataKind[]; readonly actions:readonly Action[]; readonly disclosureLanguage:string;
 readonly contactState:'CONTACTING'|'AWAITING_RESPONSE'|'HUMAN_REVIEW'|'ESCALATED';
 readonly protocolVersion:string; readonly consentPolicyVersion:string; readonly grantedAt:string; readonly expiresAt:string;
 readonly revokedAt:string|null; readonly status:'ACTIVE'|'REVOKED'|'EXPIRED';
}
export interface ConsentAuthorityPort { findConsentGrant(input:Scope & {grantId:string;sessionId:string;subjectId:string}):Promise<ConsentGrantReceipt|null> }

export interface RetentionCommand extends Scope { readonly resourceId:string; readonly dataKind:DataKind; readonly requestedAt:string; readonly reasonCode:string }
export interface RetentionPort { scheduleDeletion(command:RetentionCommand):Promise<'SCHEDULED'|'LEGAL_HOLD'|'NOT_FOUND'>; applyLegalHold(command:RetentionCommand & {holdUntil:string|null}):Promise<'HELD'|'NOT_FOUND'>; releaseLegalHold(command:RetentionCommand):Promise<'RELEASED'|'NOT_FOUND'>; purgeContentPreservingAudit(command:RetentionCommand):Promise<'PURGED'|'LEGAL_HOLD'|'NOT_FOUND'> }
export interface AbusePreventionPort { consume(input:Scope & {actorId:string; action:string; occurredAt:string}):Promise<'ALLOW'|'RATE_LIMIT'|'ANOMALY_REVIEW'>; signal(input:Scope & {actorId:string; signal:string; occurredAt:string}):Promise<void> }
export interface PrivacyAuditEvent extends Scope { readonly eventId:string; readonly eventType:string; readonly actorId:string; readonly role:Role; readonly purpose:Purpose; readonly reasonCode:string; readonly occurredAt:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION }
export interface PrivacyAuditPort { append(event:PrivacyAuditEvent):Promise<'APPENDED'|'IDEMPOTENT'> }

export interface BreakGlassGrantInput extends Scope {
 readonly grantId:string; readonly idempotencyKey:string; readonly actorId:string; readonly leaseId:string;
 readonly role:Role; readonly purpose:Purpose; readonly dataKind:DataKind; readonly action:Action;
 readonly reasonCode:string; readonly occurredAt:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION;
}
export interface BreakGlassGrantReceipt extends BreakGlassGrantInput { readonly alertReceiptId:string; readonly auditEventId:string; readonly status:'AUTHORIZED' }
export interface BreakGlassGrantTransaction {
 consumeAbuse(input:BreakGlassGrantInput):Promise<'ALLOW'|'RATE_LIMIT'|'ANOMALY_REVIEW'>;
 reserveAlert(input:BreakGlassGrantInput):Promise<{status:'RESERVED'|'EXISTS'|'FAILED';receiptId:string|null}>;
 appendAudit(input:BreakGlassGrantInput & {alertReceiptId:string}):Promise<{status:'APPENDED'|'IDEMPOTENT'|'FAILED';eventId:string|null}>;
 finalizeGrant(input:BreakGlassGrantInput & {alertReceiptId:string;auditEventId:string}):Promise<{status:'AUTHORIZED'|'IDEMPOTENT'|'CONFLICT';receipt:BreakGlassGrantReceipt|null}>;
}
export interface BreakGlassGrantRepositoryPort {
 transaction<T>(work:(tx:BreakGlassGrantTransaction)=>Promise<T>):Promise<T>;
 findAuthorized(scope:Scope & {grantId:string;actorId:string;leaseId:string}):Promise<BreakGlassGrantReceipt|null>;
}
export interface PrivacyIdFactoryPort { create(namespace:string,material:string):Promise<string> }

export interface RecommendationApprovalReceipt extends Scope {
 readonly approvalId:string; readonly recommendationId:string; readonly recommendationVersion:number; readonly actionId:string;
 readonly risk:'HIGH'|'CRITICAL'; readonly approverId:string; readonly approverRole:'SAFETY_OPERATOR'|'SECURITY_REVIEWER';
 readonly proposerId:string; readonly explanationArtifactHash:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION;
 readonly approvedAt:string; readonly expiresAt:string; readonly revokedAt:string|null; readonly status:'APPROVED'|'REVOKED'|'EXPIRED';
}
export interface RecommendationExecutionRequest extends Scope {
 readonly recommendationId:string; readonly recommendationVersion:number; readonly actionId:string; readonly risk:'LOW'|'MODERATE'|'HIGH'|'CRITICAL';
 readonly proposerId:string; readonly approvalId:string|null; readonly explanationArtifactHash:string; readonly now:string; readonly idempotencyKey:string;
}
export interface RecommendationAuthorityPort {
 findApproval(input:Scope & {approvalId:string;recommendationId:string;recommendationVersion:number;actionId:string}):Promise<RecommendationApprovalReceipt|null>;
 authorizeExecution(input:RecommendationExecutionRequest & {approval:RecommendationApprovalReceipt|null}):Promise<'AUTHORIZED'|'IDEMPOTENT'|'DENIED'|'AUDIT_FAILED'>;
}

const minimum:Readonly<Record<Purpose,readonly DataKind[]>>={
 SAFETY_CONTACT:['SIGNAL','INDICATOR','CONVERSATION_METADATA'],
 INCIDENT_TRIAGE:['SIGNAL','INDICATOR','EVIDENCE_METADATA'],
 OPERATOR_REVIEW:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 SECURITY_INVESTIGATION:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 RETENTION_ADMIN:['CONVERSATION_METADATA','EVIDENCE_METADATA']
};
const rolePurposes:Readonly<Record<Role,readonly Purpose[]>>={SYSTEM_WORKER:['SAFETY_CONTACT','INCIDENT_TRIAGE'],SAFETY_OPERATOR:['OPERATOR_REVIEW'],SECURITY_REVIEWER:['SECURITY_INVESTIGATION'],RETENTION_ADMIN:['RETENTION_ADMIN'],AUDITOR:['SECURITY_INVESTIGATION']};
const restrictedRaw:readonly DataKind[]=['EVIDENCE_RAW','CONVERSATION_RAW','PRECISE_LOCATION'];

/** Pure policy evaluation never trusts caller consent assertions and never grants raw access. */
export function evaluateAccess(r:AccessRequest):AccessDecision{
 const common=validateCommon(r); if(common!==null)return common;
 if(r.dataKind==='RAW_TOKEN')return deny('raw_token_denied');
 if(r.action==='EXPORT'&&restrictedRaw.includes(r.dataKind))return deny('restricted_export_denied');
 if(r.action==='DELETE'&&r.role!=='RETENTION_ADMIN')return deny('delete_role_denied');
 if(requiresConsent(r.purpose))return deny('authoritative_consent_required');
 if(restrictedRaw.includes(r.dataKind))return deny('break_glass_orchestration_required');
 if(!minimum[r.purpose].includes(r.dataKind))return deny('minimum_necessary_denied');
 return allow(r.action==='MASKED_READ'?'MASKED':'FULL','policy_allow');
}

export class PrivacyAccessOrchestrator {
 constructor(private readonly grants:BreakGlassGrantRepositoryPort,private readonly ids:PrivacyIdFactoryPort,private readonly consent:ConsentAuthorityPort){}
 async authorizeAccess(r:AccessRequest):Promise<AccessDecision>{
  const common=validateCommon(r); if(common!==null)return common;
  if(r.dataKind==='RAW_TOKEN')return deny('raw_token_denied');
  if(r.action==='EXPORT'&&restrictedRaw.includes(r.dataKind))return deny('restricted_export_denied');
  if(requiresConsent(r.purpose)){const consentDecision=await this.verifyConsent(r);if(consentDecision!==null)return consentDecision;}
  if(!restrictedRaw.includes(r.dataKind)){
   if(r.action==='DELETE'&&r.role!=='RETENTION_ADMIN')return deny('delete_role_denied');
   if(!minimum[r.purpose].includes(r.dataKind))return deny('minimum_necessary_denied');
   return allow(r.action==='MASKED_READ'?'MASKED':'FULL','policy_allow');
  }
  if(!validBreakGlass(r.breakGlass,r))return deny('break_glass_required');
  if(!validId(r.idempotencyKey??''))return deny('idempotency_required');
  const lease=r.breakGlass;
  const grantId=await this.ids.create('break-glass-grant',`${r.tenantId}|${r.caseId}|${r.actorId}|${lease.leaseId}|${r.purpose}|${r.dataKind}|${r.action}|${r.idempotencyKey}`);
  const existing=await this.grants.findAuthorized({...r,grantId,leaseId:lease.leaseId});
  if(existing!==null)return allow('FULL','break_glass_authorized',existing.grantId);
  const input:BreakGlassGrantInput={tenantId:r.tenantId,caseId:r.caseId,grantId,idempotencyKey:r.idempotencyKey!,actorId:r.actorId,leaseId:lease.leaseId,role:r.role,purpose:r.purpose,dataKind:r.dataKind,action:r.action,reasonCode:lease.reasonCode,occurredAt:r.now,policyVersion:PRIVACY_POLICY_VERSION};
  return this.grants.transaction(async tx=>{
   const abuse=await tx.consumeAbuse(input); if(abuse!=='ALLOW')return deny(abuse==='RATE_LIMIT'?'break_glass_rate_limited':'break_glass_anomaly_review');
   const alert=await tx.reserveAlert(input); if(alert.status==='FAILED'||alert.receiptId===null)return deny('break_glass_alert_not_durable');
   const audit=await tx.appendAudit({...input,alertReceiptId:alert.receiptId}); if(audit.status==='FAILED'||audit.eventId===null)return deny('break_glass_audit_not_durable');
   const finalized=await tx.finalizeGrant({...input,alertReceiptId:alert.receiptId,auditEventId:audit.eventId});
   if((finalized.status==='AUTHORIZED'||finalized.status==='IDEMPOTENT')&&finalized.receipt!==null)return allow('FULL','break_glass_authorized',finalized.receipt.grantId);
   return deny('break_glass_grant_conflict');
  });
 }
 private async verifyConsent(r:AccessRequest):Promise<AccessDecision|null>{
  if(!validId(r.consentGrantId??'')||!validId(r.sessionId??'')||!validId(r.subjectId??''))return deny('consent_record_required');
  const grant=await this.consent.findConsentGrant({tenantId:r.tenantId,caseId:r.caseId,grantId:r.consentGrantId!,sessionId:r.sessionId!,subjectId:r.subjectId!});
  if(grant===null)return deny('consent_record_missing');
  const active=grant.status==='ACTIVE'&&grant.revokedAt===null&&validTime(grant.grantedAt)&&validTime(grant.expiresAt)&&Date.parse(r.now)>=Date.parse(grant.grantedAt)&&Date.parse(r.now)<Date.parse(grant.expiresAt);
  const bound=grant.tenantId===r.tenantId&&grant.caseId===r.caseId&&grant.sessionId===r.sessionId&&grant.subjectId===r.subjectId&&grant.purposes.includes(r.purpose)&&grant.dataKinds.includes(r.dataKind)&&grant.actions.includes(r.action);
  const sequenceComplete=['CONTACTING','AWAITING_RESPONSE','HUMAN_REVIEW','ESCALATED'].includes(grant.contactState)&&validId(grant.disclosureLanguage)&&validId(grant.protocolVersion)&&validId(grant.consentPolicyVersion);
  return active&&bound&&sequenceComplete?null:deny('consent_record_invalid');
 }
}

export class RecommendationExecutionOrchestrator {
 constructor(private readonly authority:RecommendationAuthorityPort){}
 async authorize(input:RecommendationExecutionRequest):Promise<boolean>{
  if(!validScope(input)||!validId(input.recommendationId)||!validId(input.actionId)||!validId(input.proposerId)||!validId(input.explanationArtifactHash)||!validId(input.idempotencyKey)||!validTime(input.now))return false;
  if(input.risk==='LOW'||input.risk==='MODERATE')return (await this.authority.authorizeExecution({...input,approval:null}))==='AUTHORIZED';
  if(!validId(input.approvalId??''))return false;
  const approval=await this.authority.findApproval({tenantId:input.tenantId,caseId:input.caseId,approvalId:input.approvalId!,recommendationId:input.recommendationId,recommendationVersion:input.recommendationVersion,actionId:input.actionId});
  if(approval===null)return false;
  const valid=approval.status==='APPROVED'&&approval.revokedAt===null&&approval.tenantId===input.tenantId&&approval.caseId===input.caseId&&approval.recommendationId===input.recommendationId&&approval.recommendationVersion===input.recommendationVersion&&approval.actionId===input.actionId&&approval.risk===input.risk&&approval.proposerId===input.proposerId&&approval.approverId!==input.proposerId&&approval.explanationArtifactHash===input.explanationArtifactHash&&validTime(approval.approvedAt)&&validTime(approval.expiresAt)&&Date.parse(input.now)>=Date.parse(approval.approvedAt)&&Date.parse(input.now)<Date.parse(approval.expiresAt);
  if(!valid)return false;
  const result=await this.authority.authorizeExecution({...input,approval});
  return result==='AUTHORIZED'||result==='IDEMPOTENT';
 }
}

export function createBreakGlassLease(input:Omit<BreakGlassLease,'expiresAt'|'reviewedAt'|'revokedAt'> & {durationMs:number}):BreakGlassLease|null{
 if(!validScope(input)||!validTime(input.issuedAt)||input.durationMs<1||input.durationMs>BREAK_GLASS_MAX_MS)return null;
 if(!validId(input.reasonCode)||!validId(input.actorId)||!validId(input.leaseId))return null;
 return {...input,expiresAt:new Date(Date.parse(input.issuedAt)+input.durationMs).toISOString(),reviewedAt:null,revokedAt:null};
}

const TELEMETRY_ALLOWLIST=new Set(['eventType','state','reasonCode','policyVersion','role','purpose','lifecycle','dataKind','action','outcome','attempt','durationMs']);
export function redactForGeneralTelemetry(value:Readonly<Record<string,unknown>>):Readonly<Record<string,string|number|boolean|null>>{
 const output:Record<string,string|number|boolean|null>={};
 for(const [key,entry] of Object.entries(value)){
  if(!TELEMETRY_ALLOWLIST.has(key))continue;
  if(entry===null||typeof entry==='boolean'||typeof entry==='number')output[key]=entry;
  else if(typeof entry==='string')output[key]=entry.length<=128?entry:'[REDACTED]';
 }
 return output;
}

export const THREAT_CONTROL_MATRIX=Object.freeze([
 {threat:'SOURCE_IMPERSONATION',control:'source binding and scoped idempotency',test:'source impersonation denial',owner:'Security Engineering',residualRisk:'P1'},
 {threat:'STALKING_MONITORING_ABUSE',control:'authoritative consent and tenant-case ABAC',test:'fabricated consent and cross-case denial',owner:'Privacy Engineering',residualRisk:'P1'},
 {threat:'ACCOUNT_TAKEOVER',control:'actor-bound anomaly hook and expiring break-glass',test:'actor mismatch and expired lease denial',owner:'Identity Security',residualRisk:'P1'},
 {threat:'INSIDER_MISUSE',control:'atomic durable alert audit and abuse grant',test:'invented receipt and adapter failure denial',owner:'Security Operations',residualRisk:'P1'},
 {threat:'EVIDENCE_EXFILTRATION',control:'restricted export deny and telemetry allowlist',test:'raw evidence export and nested telemetry denial',owner:'Data Protection',residualRisk:'P1'},
 {threat:'MODEL_AUTHORITY_ABUSE',control:'authoritative scoped human approval receipt',test:'synthetic approval and proposer self-approval denial',owner:'Responsible AI',residualRisk:'P1'}
] as const);

function validateCommon(r:AccessRequest):AccessDecision|null{
 if(!validScope(r)||!validId(r.actorId)||r.actorTenantId!==r.tenantId||r.actorCaseId!==r.caseId)return deny('scope_or_actor_mismatch');
 if(!validTime(r.now)||!rolePurposes[r.role].includes(r.purpose))return deny('role_or_time_denied');
 if(!lifecycleAllows(r.lifecycle,r.purpose))return deny('lifecycle_denied');
 return null;
}
function validBreakGlass(l:BreakGlassLease|null,r:AccessRequest):l is BreakGlassLease{return l!==null&&l.tenantId===r.tenantId&&l.caseId===r.caseId&&l.actorId===r.actorId&&l.role===r.role&&l.purpose===r.purpose&&validTime(l.issuedAt)&&validTime(l.expiresAt)&&Date.parse(r.now)>=Date.parse(l.issuedAt)&&Date.parse(r.now)<Date.parse(l.expiresAt)&&l.reviewedAt===null&&(l.revokedAt??null)===null&&validId(l.leaseId)&&validId(l.reasonCode)}
function lifecycleAllows(l:Lifecycle,p:Purpose):boolean{if(['REVOKED','EXPIRED','INACTIVE','DELETION_PENDING'].includes(l))return p==='RETENTION_ADMIN';if(l==='CONSENT_PENDING'||l==='LANGUAGE_SELECTION')return false;if(l==='LEGAL_HOLD')return p==='RETENTION_ADMIN'||p==='SECURITY_INVESTIGATION';return l==='ACTIVE'}
function requiresConsent(p:Purpose):boolean{return p==='SAFETY_CONTACT'||p==='INCIDENT_TRIAGE'||p==='OPERATOR_REVIEW'}
function validScope(v:Scope):boolean{return validId(v.tenantId)&&validId(v.caseId)}
function validId(v:string):boolean{return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v)}
function validTime(v:string):boolean{return Number.isFinite(Date.parse(v))}
function deny(reasonCode:string):AccessDecision{return{allowed:false,mode:'DENY',reasonCode,policyVersion:PRIVACY_POLICY_VERSION}}
function allow(mode:'MASKED'|'FULL',reasonCode:string,receiptId?:string):AccessDecision{return receiptId===undefined?{allowed:true,mode,reasonCode,policyVersion:PRIVACY_POLICY_VERSION}:{allowed:true,mode,reasonCode,policyVersion:PRIVACY_POLICY_VERSION,receiptId}}
