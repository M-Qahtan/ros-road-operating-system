export const PRIVACY_POLICY_VERSION = 'ros-eye.privacy-security.v1' as const;
export const BREAK_GLASS_MAX_MS = 900_000;

export type DataKind = 'SIGNAL'|'INDICATOR'|'CONVERSATION_METADATA'|'CONVERSATION_RAW'|'EVIDENCE_METADATA'|'EVIDENCE_RAW'|'PRECISE_LOCATION'|'RAW_TOKEN'|'OPERATOR_VIEW';
export type Purpose = 'SAFETY_CONTACT'|'INCIDENT_TRIAGE'|'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'|'RETENTION_ADMIN';
export type Lifecycle = 'INACTIVE'|'CONSENT_PENDING'|'ACTIVE'|'REVOKED'|'EXPIRED'|'LEGAL_HOLD'|'DELETION_PENDING';
export type Role = 'SYSTEM_WORKER'|'SAFETY_OPERATOR'|'SECURITY_REVIEWER'|'RETENTION_ADMIN'|'AUDITOR';
export type Action = 'READ'|'MASKED_READ'|'WRITE'|'DELETE'|'EXPORT';

export interface Scope { readonly tenantId:string; readonly caseId:string }
export interface BreakGlassLease extends Scope { readonly leaseId:string; readonly actorId:string; readonly role:'SAFETY_OPERATOR'|'SECURITY_REVIEWER'; readonly purpose:'OPERATOR_REVIEW'|'SECURITY_INVESTIGATION'; readonly reasonCode:string; readonly issuedAt:string; readonly expiresAt:string; readonly alertId:string; readonly reviewedAt:string|null }
export interface AccessRequest extends Scope { readonly actorId:string; readonly actorTenantId:string; readonly actorCaseId:string; readonly role:Role; readonly purpose:Purpose; readonly lifecycle:Lifecycle; readonly dataKind:DataKind; readonly action:Action; readonly consentValidUntil:string|null; readonly consentRevokedAt:string|null; readonly now:string; readonly breakGlass:BreakGlassLease|null }
export interface AccessDecision { readonly allowed:boolean; readonly mode:'DENY'|'MASKED'|'FULL'; readonly reasonCode:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION }

export interface RetentionCommand extends Scope { readonly resourceId:string; readonly dataKind:DataKind; readonly requestedAt:string; readonly reasonCode:string }
export interface RetentionPort { scheduleDeletion(command:RetentionCommand):Promise<'SCHEDULED'|'LEGAL_HOLD'|'NOT_FOUND'>; applyLegalHold(command:RetentionCommand & {holdUntil:string|null}):Promise<'HELD'|'NOT_FOUND'>; releaseLegalHold(command:RetentionCommand):Promise<'RELEASED'|'NOT_FOUND'>; purgeContentPreservingAudit(command:RetentionCommand):Promise<'PURGED'|'LEGAL_HOLD'|'NOT_FOUND'> }
export interface AbusePreventionPort { consume(input:Scope & {actorId:string; action:string; occurredAt:string}):Promise<'ALLOW'|'RATE_LIMIT'|'ANOMALY_REVIEW'>; signal(input:Scope & {actorId:string; signal:string; occurredAt:string}):Promise<void> }
export interface PrivacyAuditEvent extends Scope { readonly eventId:string; readonly eventType:string; readonly actorId:string; readonly role:Role; readonly purpose:Purpose; readonly reasonCode:string; readonly occurredAt:string; readonly policyVersion:typeof PRIVACY_POLICY_VERSION }
export interface PrivacyAuditPort { append(event:PrivacyAuditEvent):Promise<'APPENDED'|'IDEMPOTENT'> }

const minimum:Readonly<Record<Purpose,readonly DataKind[]>>={
 SAFETY_CONTACT:['SIGNAL','INDICATOR','CONVERSATION_METADATA'],
 INCIDENT_TRIAGE:['SIGNAL','INDICATOR','EVIDENCE_METADATA'],
 OPERATOR_REVIEW:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 SECURITY_INVESTIGATION:['SIGNAL','INDICATOR','CONVERSATION_METADATA','EVIDENCE_METADATA','OPERATOR_VIEW'],
 RETENTION_ADMIN:['CONVERSATION_METADATA','EVIDENCE_METADATA']
};
const rolePurposes:Readonly<Record<Role,readonly Purpose[]>>={SYSTEM_WORKER:['SAFETY_CONTACT','INCIDENT_TRIAGE'],SAFETY_OPERATOR:['OPERATOR_REVIEW'],SECURITY_REVIEWER:['SECURITY_INVESTIGATION'],RETENTION_ADMIN:['RETENTION_ADMIN'],AUDITOR:['SECURITY_INVESTIGATION']};

export function evaluateAccess(r:AccessRequest):AccessDecision{
 if(!validScope(r)||!validId(r.actorId)||r.actorTenantId!==r.tenantId||r.actorCaseId!==r.caseId)return deny('scope_or_actor_mismatch');
 if(!validTime(r.now)||!rolePurposes[r.role].includes(r.purpose))return deny('role_or_time_denied');
 if(!minimum[r.purpose].includes(r.dataKind)&&!validBreakGlass(r.breakGlass,r))return deny('minimum_necessary_denied');
 if(!lifecycleAllows(r.lifecycle,r.purpose))return deny('lifecycle_denied');
 if(requiresConsent(r.purpose)&&!validConsent(r))return deny('consent_invalid');
 if(r.dataKind==='RAW_TOKEN')return deny('raw_token_denied');
 if(r.action==='EXPORT'&&(r.dataKind==='EVIDENCE_RAW'||r.dataKind==='CONVERSATION_RAW'||r.dataKind==='PRECISE_LOCATION'))return deny('restricted_export_denied');
 if(r.action==='DELETE'&&r.role!=='RETENTION_ADMIN')return deny('delete_role_denied');
 if(['EVIDENCE_RAW','CONVERSATION_RAW','PRECISE_LOCATION'].includes(r.dataKind))return validBreakGlass(r.breakGlass,r)?allow('FULL','break_glass_scoped'):deny('break_glass_required');
 return allow(r.action==='MASKED_READ'?'MASKED':'FULL','policy_allow');
}

export function createBreakGlassLease(input:Omit<BreakGlassLease,'expiresAt'|'reviewedAt'> & {durationMs:number}):BreakGlassLease|null{
 if(!validScope(input)||!validTime(input.issuedAt)||input.durationMs<1||input.durationMs>BREAK_GLASS_MAX_MS)return null;
 if(!validId(input.reasonCode)||!validId(input.alertId)||!validId(input.actorId)||!validId(input.leaseId))return null;
 return {...input,expiresAt:new Date(Date.parse(input.issuedAt)+input.durationMs).toISOString(),reviewedAt:null};
}

export function mayExecuteRecommendation(input:{risk:'LOW'|'MODERATE'|'HIGH'|'CRITICAL';humanApproved:boolean;explanationId:string|null;reversibleWhereSafe:boolean}):boolean{
 if(input.risk==='HIGH'||input.risk==='CRITICAL')return input.humanApproved&&input.explanationId!==null&&input.reversibleWhereSafe;
 return input.explanationId!==null;
}

export function redactForGeneralTelemetry(value:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
 const forbidden=new Set(['rawConversation','rawEvidence','preciseLocation','latitude','longitude','rawToken','phoneNumber','medicalNarrative']);
 const output:Record<string,unknown>={};
 for(const [key,entry] of Object.entries(value)){if(forbidden.has(key))continue;output[key]=typeof entry==='string'&&entry.length>128?'[REDACTED]':entry;}
 return output;
}

export const THREAT_CONTROL_MATRIX=Object.freeze([
 {threat:'SOURCE_IMPERSONATION',control:'source binding and scoped idempotency',test:'source impersonation denial',owner:'Security Engineering',residualRisk:'P1'},
 {threat:'STALKING_MONITORING_ABUSE',control:'purpose lifecycle tenant-case ABAC',test:'purpose and cross-case denial',owner:'Privacy Engineering',residualRisk:'P1'},
 {threat:'ACCOUNT_TAKEOVER',control:'actor-bound anomaly hook and expiring break-glass',test:'actor mismatch and expired lease denial',owner:'Identity Security',residualRisk:'P1'},
 {threat:'INSIDER_MISUSE',control:'least privilege and immutable audit',test:'insider purpose denial',owner:'Security Operations',residualRisk:'P1'},
 {threat:'EVIDENCE_EXFILTRATION',control:'restricted export deny',test:'raw evidence export denial',owner:'Data Protection',residualRisk:'P1'},
 {threat:'MODEL_AUTHORITY_ABUSE',control:'human approval and explanation gate',test:'model non-authority',owner:'Responsible AI',residualRisk:'P1'}
] as const);

function validBreakGlass(l:BreakGlassLease|null,r:AccessRequest):boolean{return l!==null&&l.tenantId===r.tenantId&&l.caseId===r.caseId&&l.actorId===r.actorId&&l.role===r.role&&l.purpose===r.purpose&&validTime(l.issuedAt)&&validTime(l.expiresAt)&&Date.parse(r.now)>=Date.parse(l.issuedAt)&&Date.parse(r.now)<Date.parse(l.expiresAt)&&l.reviewedAt===null&&validId(l.leaseId)&&validId(l.reasonCode)&&validId(l.alertId)}
function lifecycleAllows(l:Lifecycle,p:Purpose):boolean{if(['REVOKED','EXPIRED','INACTIVE','DELETION_PENDING'].includes(l))return p==='RETENTION_ADMIN';if(l==='LEGAL_HOLD')return p==='RETENTION_ADMIN'||p==='SECURITY_INVESTIGATION';return l==='ACTIVE'}
function requiresConsent(p:Purpose):boolean{return p==='SAFETY_CONTACT'||p==='INCIDENT_TRIAGE'||p==='OPERATOR_REVIEW'}
function validConsent(r:AccessRequest):boolean{return r.consentRevokedAt===null&&r.consentValidUntil!==null&&validTime(r.consentValidUntil)&&Date.parse(r.consentValidUntil)>Date.parse(r.now)}
function validScope(v:Scope):boolean{return validId(v.tenantId)&&validId(v.caseId)}
function validId(v:string):boolean{return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(v)}
function validTime(v:string):boolean{return Number.isFinite(Date.parse(v))}
function deny(reasonCode:string):AccessDecision{return{allowed:false,mode:'DENY',reasonCode,policyVersion:PRIVACY_POLICY_VERSION}}
function allow(mode:'MASKED'|'FULL',reasonCode:string):AccessDecision{return{allowed:true,mode,reasonCode,policyVersion:PRIVACY_POLICY_VERSION}}
