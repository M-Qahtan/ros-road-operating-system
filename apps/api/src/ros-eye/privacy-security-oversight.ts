export const PRIVACY_POLICY_VERSION = 'ros-eye.privacy-security.v2' as const;
export const BREAK_GLASS_MAX_MS = 900_000;

export type DataKind = 'SIGNAL'|'INDICATOR'|'CONVERSATION_METADATA'|'CONVERSATION_RAW'|'EVIDENCE_METADATA'|'EVIDENCE_RAW'|'PRECISE_LOCATION'|'RAW_TOKEN'|'OPERATOR_VIEW';
export type Purpose = 'SAFETY_CONTACT'|'INCIDENT_TRIAGE'|'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'|'RETENTION_ADMIN';
export type Lifecycle = 'INACTIVE'|'CONSENT_PENDING'|'ACTIVE'|'REVOKED'|'EXPIRED'|'LEGAL_HOLD'|'DELETION_PENDING';
export type Role = 'SYSTEM_WORKER'|'SAFETY_OPERATOR'|'SECURITY_REVIEWER'|'RETENTION_ADMIN'|'AUDITOR';
export type Action = 'READ'|'MASKED_READ'|'WRITE'|'DELETE'|'EXPORT';

export interface Scope { readonly tenantId:string; readonly caseId:string }
export interface BreakGlassLease extends Scope { readonly leaseId:string; readonly actorId:string; readonly role:'SAFETY_OPERATOR'|'SECURITY_REVIEWER'; readonly purpose:'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'; readonly reasonCode:string; readonly issuedAt:string; readonly expiresAt:string; readonly reviewedAt:string|null; readonly revokedAt?:string|null }
export interface AccessRequest extends Scope { readonly actorId:string; readonly actorTenantId:string; readonly actorCaseId:string; readonly role:Role; readonly purpose:Purpose; readonly lifecycle:Lifecycle; readonly dataKind:DataKind; readonly action:Action; readonly consentValidUntil:string|null; readonly consentRevokedAt:string|null; readonly now:string; readonly breakGlass:BreakGlassLease|null; readonly idempotencyKey?:string }
export interface AccessDecision { readonly allowed:boolean; readonly mode:'DENY'|'MASKED'|'FULL'; readonly reasonCode:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION; readonly receiptId?:string }

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

const minimum:Readonly<Record<Purpose,readonly DataKind[]>>={
 SAFETY_CONTACT:['SIGNAL','INDICATOR','CONVERSATION_METADATA'],
 INCIDENT_TRIAGE:['SIGNAL','INDICATOR','EVIDENCE_METADATA'],
 OPERATOR_REVIEW:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 SECURITY_INVESTIGATION:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 RETENTION_ADMIN:['CONVERSATION_METADATA','EVIDENCE_METADATA']
};
const rolePurposes:Readonly<Record<Role,readonly Purpose[]>>={SYSTEM_WORKER:['SAFETY_CONTACT','INCIDENT_TRIAGE'],SAFETY_OPERATOR:['OPERATOR_REVIEW'],SECURITY_REVIEWER:['SECURITY_INVESTIGATION'],RETENTION_ADMIN:['RETENTION_ADMIN'],AUDITOR:['SECURITY_INVESTIGATION']};
const restrictedRaw:readonly DataKind[]=['EVIDENCE_RAW','CONVERSATION_RAW','PRECISE_LOCATION'];

/** Pure policy evaluation never grants raw access. Raw access must pass authorizeAccess(). */
export function evaluateAccess(r:AccessRequest):AccessDecision{
 const common=validateCommon(r); if(common!==null)return common;
 if(r.dataKind==='RAW_TOKEN')return deny('raw_token_denied');
 if(r.action==='EXPORT'&&restrictedRaw.includes(r.dataKind))return deny('restricted_export_denied');
 if(r.action==='DELETE'&&r.role!=='RETENTION_ADMIN')return deny('delete_role_denied');
 if(restrictedRaw.includes(r.dataKind))return deny('break_glass_orchestration_required');
 if(!minimum[r.purpose].includes(r.dataKind))return deny('minimum_necessary_denied');
 return allow(r.action==='MASKED_READ'?'MASKED':'FULL','policy_allow');
}

export class PrivacyAccessOrchestrator {
 constructor(private readonly grants:BreakGlassGrantRepositoryPort,private readonly ids:PrivacyIdFactoryPort){}
 async authorizeAccess(r:AccessRequest):Promise<AccessDecision>{
  const normal=evaluateAccess(r);
  if(!restrictedRaw.includes(r.dataKind))return normal;
  if(r.action==='EXPORT')return deny('restricted_export_denied');
  const common=validateCommon(r); if(common!==null)return common;
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
}

export function createBreakGlassLease(input:Omit<BreakGlassLease,'expiresAt'|'reviewedAt'|'revokedAt'> & {durationMs:number}):BreakGlassLease|null{
 if(!validScope(input)||!validTime(input.issuedAt)||input.durationMs<1||input.durationMs>BREAK_GLASS_MAX_MS)return null;
 if(!validId(input.reasonCode)||!validId(input.actorId)||!validId(input.leaseId))return null;
 return {...input,expiresAt:new Date(Date.parse(input.issuedAt)+input.durationMs).toISOString(),reviewedAt:null,revokedAt:null};
}

export function mayExecuteRecommendation(input:{risk:'LOW'|'MODERATE'|'HIGH'|'CRITICAL';humanApproved:boolean;explanationId:string|null;reversibleWhereSafe:boolean}):boolean{
 if(input.risk==='HIGH'||input.risk==='CRITICAL')return input.humanApproved&&input.explanationId!==null&&input.reversibleWhereSafe;
 return input.explanationId!==null;
}

export function redactForGeneralTelemetry(value:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
 const forbidden=new Set(['rawConversation','rawEvidence','preciseLocation','latitude','longitude','rawToken','phoneNumber','medicalNarrative','alertReceiptId','auditEventId']);
 const output:Record<string,unknown>={};
 for(const [key,entry] of Object.entries(value)){if(forbidden.has(key))continue;output[key]=typeof entry==='string'&&entry.length>128?'[REDACTED]':entry;}
 return output;
}

export const THREAT_CONTROL_MATRIX=Object.freeze([
 {threat:'SOURCE_IMPERSONATION',control:'source binding and scoped idempotency',test:'source impersonation denial',owner:'Security Engineering',residualRisk:'P1'},
 {threat:'STALKING_MONITORING_ABUSE',control:'purpose lifecycle tenant-case ABAC',test:'purpose and cross-case denial',owner:'Privacy Engineering',residualRisk:'P1'},
 {threat:'ACCOUNT_TAKEOVER',control:'actor-bound anomaly hook and expiring break-glass',test:'actor mismatch and expired lease denial',owner:'Identity Security',residualRisk:'P1'},
 {threat:'INSIDER_MISUSE',control:'atomic durable alert audit and abuse grant',test:'invented receipt and adapter failure denial',owner:'Security Operations',residualRisk:'P1'},
 {threat:'EVIDENCE_EXFILTRATION',control:'restricted export deny',test:'raw evidence export denial',owner:'Data Protection',residualRisk:'P1'},
 {threat:'MODEL_AUTHORITY_ABUSE',control:'human approval and explanation gate',test:'model non-authority',owner:'Responsible AI',residualRisk:'P1'}
] as const);

function validateCommon(r:AccessRequest):AccessDecision|null{
 if(!validScope(r)||!validId(r.actorId)||r.actorTenantId!==r.tenantId||r.actorCaseId!==r.caseId)return deny('scope_or_actor_mismatch');
 if(!validTime(r.now)||!rolePurposes[r.role].includes(r.purpose))return deny('role_or_time_denied');
 if(!lifecycleAllows(r.lifecycle,r.purpose))return deny('lifecycle_denied');
 if(requiresConsent(r.purpose)&&!validConsent(r))return deny('consent_invalid');
 return null;
}
function validBreakGlass(l:BreakGlassLease|null,r:AccessRequest):l is BreakGlassLease{return l!==null&&l.tenantId===r.tenantId&&l.caseId===r.caseId&&l.actorId===r.actorId&&l.role===r.role&&l.purpose===r.purpose&&validTime(l.issuedAt)&&validTime(l.expiresAt)&&Date.parse(r.now)>=Date.parse(l.issuedAt)&&Date.parse(r.now)<Date.parse(l.expiresAt)&&l.reviewedAt===null&&(l.revokedAt??null)===null&&validId(l.leaseId)&&validId(l.reasonCode)}
function lifecycleAllows(l:Lifecycle,p:Purpose):boolean{if(['REVOKED','EXPIRED','INACTIVE','DELETION_PENDING'].includes(l))return p==='RETENTION_ADMIN';if(l==='LEGAL_HOLD')return p==='RETENTION_ADMIN'||p==='SECURITY_INVESTIGATION';return l==='ACTIVE'}
function requiresConsent(p:Purpose):boolean{return p==='SAFETY_CONTACT'||p==='INCIDENT_TRIAGE'||p==='OPERATOR_REVIEW'}
function validConsent(r:AccessRequest):boolean{return r.consentRevokedAt===null&&r.consentValidUntil!==null&&validTime(r.consentValidUntil)&&Date.parse(r.consentValidUntil)>Date.parse(r.now)}
function validScope(v:Scope):boolean{return validId(v.tenantId)&&validId(v.caseId)}
function validId(v:string):boolean{return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v)}
function validTime(v:string):boolean{return Number.isFinite(Date.parse(v))}
function deny(reasonCode:string):AccessDecision{return{allowed:false,mode:'DENY',reasonCode,policyVersion:PRIVACY_POLICY_VERSION}}
function allow(mode:'MASKED'|'FULL',reasonCode:string,receiptId?:string):AccessDecision{return receiptId===undefined?{allowed:true,mode,reasonCode,policyVersion:PRIVACY_POLICY_VERSION}:{allowed:true,mode,reasonCode,policyVersion:PRIVACY_POLICY_VERSION,receiptId}}
