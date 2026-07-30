import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
 BREAK_GLASS_MAX_MS, PRIVACY_POLICY_VERSION, PrivacyAccessOrchestrator, THREAT_CONTROL_MATRIX,
 createBreakGlassLease, evaluateAccess, mayExecuteRecommendation, redactForGeneralTelemetry,
 type AccessRequest, type BreakGlassGrantInput, type BreakGlassGrantReceipt,
 type BreakGlassGrantRepositoryPort, type BreakGlassGrantTransaction
} from './privacy-security-oversight.js';

const base:AccessRequest={tenantId:'tenant-riyadh',caseId:'case-001',actorId:'operator-001',actorTenantId:'tenant-riyadh',actorCaseId:'case-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',lifecycle:'ACTIVE',dataKind:'OPERATOR_VIEW',action:'READ',consentValidUntil:'2026-07-30T00:00:00.000Z',consentRevokedAt:null,now:'2026-07-29T20:00:00.000Z',breakGlass:null,idempotencyKey:'access-001'};
const ids={async create(namespace:string,material:string){return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0,24)}`;}};

class MemoryGrants implements BreakGlassGrantRepositoryPort,BreakGlassGrantTransaction{
 readonly receipts=new Map<string,BreakGlassGrantReceipt>(); readonly alerts=new Set<string>(); readonly audits=new Set<string>(); readonly abuse=new Set<string>();
 failAlert=false; failAudit=false; abuseResult:'ALLOW'|'RATE_LIMIT'|'ANOMALY_REVIEW'='ALLOW';
 async transaction<T>(work:(tx:BreakGlassGrantTransaction)=>Promise<T>):Promise<T>{return work(this)}
 async findAuthorized(input:{tenantId:string;caseId:string;grantId:string;actorId:string;leaseId:string}){const r=this.receipts.get(input.grantId);return r?.tenantId===input.tenantId&&r.caseId===input.caseId&&r.actorId===input.actorId&&r.leaseId===input.leaseId?r:null}
 async consumeAbuse(input:BreakGlassGrantInput){if(this.abuseResult!=='ALLOW')return this.abuseResult;this.abuse.add(input.grantId);return 'ALLOW' as const}
 async reserveAlert(input:BreakGlassGrantInput){if(this.failAlert)return{status:'FAILED' as const,receiptId:null};const receiptId=`alert-${input.grantId}`;const existed=this.alerts.has(receiptId);this.alerts.add(receiptId);return{status:existed?'EXISTS' as const:'RESERVED' as const,receiptId}}
 async appendAudit(input:BreakGlassGrantInput&{alertReceiptId:string}){if(this.failAudit)return{status:'FAILED' as const,eventId:null};if(!this.alerts.has(input.alertReceiptId))return{status:'FAILED' as const,eventId:null};const eventId=`audit-${input.grantId}`;const existed=this.audits.has(eventId);this.audits.add(eventId);return{status:existed?'IDEMPOTENT' as const:'APPENDED' as const,eventId}}
 async finalizeGrant(input:BreakGlassGrantInput&{alertReceiptId:string;auditEventId:string}){if(!this.abuse.has(input.grantId)||!this.alerts.has(input.alertReceiptId)||!this.audits.has(input.auditEventId))return{status:'CONFLICT' as const,receipt:null};const existing=this.receipts.get(input.grantId);if(existing)return{status:'IDEMPOTENT' as const,receipt:existing};const receipt:BreakGlassGrantReceipt={...input,status:'AUTHORIZED'};this.receipts.set(input.grantId,receipt);return{status:'AUTHORIZED' as const,receipt}}
}

function lease(){const value=createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-001',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'immediate_safety_review',issuedAt:'2026-07-29T20:00:00.000Z',durationMs:60_000});assert.ok(value);return value}
function raw(overrides:Partial<AccessRequest>={}):AccessRequest{return{...base,dataKind:'EVIDENCE_RAW',breakGlass:lease(),...overrides}}

test('deny by default for cross tenant cross case and missing actor access',()=>{
 assert.equal(evaluateAccess({...base,actorTenantId:'tenant-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorCaseId:'case-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorId:''}).reasonCode,'scope_or_actor_mismatch');
});

test('pure policy evaluator can never grant raw access',()=>{
 assert.equal(evaluateAccess(raw()).mode,'DENY');
 assert.equal(evaluateAccess(raw()).reasonCode,'break_glass_orchestration_required');
 assert.equal(evaluateAccess(raw({action:'EXPORT'})).reasonCode,'restricted_export_denied');
});

test('durable alert audit abuse and finalization are all required before FULL access',async()=>{
 const repo=new MemoryGrants();const service=new PrivacyAccessOrchestrator(repo,ids);
 const result=await service.authorizeAccess(raw());
 assert.equal(result.mode,'FULL');assert.equal(result.reasonCode,'break_glass_authorized');assert.ok(result.receiptId);
 assert.equal(repo.alerts.size,1);assert.equal(repo.audits.size,1);assert.equal(repo.abuse.size,1);assert.equal(repo.receipts.size,1);
});

test('alert persistence audit append and abuse failures deny without raw disclosure',async()=>{
 const alertRepo=new MemoryGrants();alertRepo.failAlert=true;
 assert.equal((await new PrivacyAccessOrchestrator(alertRepo,ids).authorizeAccess(raw())).reasonCode,'break_glass_alert_not_durable');
 const auditRepo=new MemoryGrants();auditRepo.failAudit=true;
 assert.equal((await new PrivacyAccessOrchestrator(auditRepo,ids).authorizeAccess(raw())).reasonCode,'break_glass_audit_not_durable');
 const abuseRepo=new MemoryGrants();abuseRepo.abuseResult='RATE_LIMIT';
 assert.equal((await new PrivacyAccessOrchestrator(abuseRepo,ids).authorizeAccess(raw())).reasonCode,'break_glass_rate_limited');
 assert.equal(alertRepo.receipts.size+auditRepo.receipts.size+abuseRepo.receipts.size,0);
});

test('duplicate and concurrent use are idempotent and audited once',async()=>{
 const repo=new MemoryGrants();const service=new PrivacyAccessOrchestrator(repo,ids);const request=raw();
 const results=await Promise.all([service.authorizeAccess(request),service.authorizeAccess(request)]);
 assert.equal(results.every(r=>r.mode==='FULL'),true);assert.equal(repo.alerts.size,1);assert.equal(repo.audits.size,1);assert.equal(repo.receipts.size,1);
});

test('invented receipts cannot authorize a grant',async()=>{
 const repo=new MemoryGrants();const input:BreakGlassGrantInput={tenantId:'tenant-riyadh',caseId:'case-001',grantId:'grant-invented',idempotencyKey:'access-001',actorId:'operator-001',leaseId:'lease-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',dataKind:'EVIDENCE_RAW',action:'READ',reasonCode:'immediate_safety_review',occurredAt:base.now,policyVersion:PRIVACY_POLICY_VERSION};
 const result=await repo.finalizeGrant({...input,alertReceiptId:'invented-alert',auditEventId:'invented-audit'});
 assert.equal(result.status,'CONFLICT');assert.equal(repo.receipts.size,0);
});

test('cross actor case tenant expiry review and revocation fail closed',async()=>{
 const service=new PrivacyAccessOrchestrator(new MemoryGrants(),ids);const current=lease();
 assert.equal((await service.authorizeAccess(raw({actorId:'operator-002'}))).mode,'DENY');
 assert.equal((await service.authorizeAccess(raw({actorCaseId:'case-other'}))).mode,'DENY');
 assert.equal((await service.authorizeAccess(raw({actorTenantId:'tenant-other'}))).mode,'DENY');
 assert.equal((await service.authorizeAccess(raw({now:'2026-07-29T20:01:01.000Z'}))).mode,'DENY');
 assert.equal((await service.authorizeAccess(raw({breakGlass:{...current,reviewedAt:'2026-07-29T20:00:30.000Z'}}))).mode,'DENY');
 assert.equal((await service.authorizeAccess(raw({breakGlass:{...current,revokedAt:'2026-07-29T20:00:20.000Z'}}))).mode,'DENY');
});

test('expired and revoked consent deny processing',()=>{
 assert.equal(evaluateAccess({...base,consentValidUntil:'2026-07-29T19:00:00.000Z'}).reasonCode,'consent_invalid');
 assert.equal(evaluateAccess({...base,consentRevokedAt:'2026-07-29T19:30:00.000Z'}).reasonCode,'consent_invalid');
});

test('break glass maximum duration is enforced',()=>{
 assert.equal(createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-002',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'review_required',issuedAt:'2026-07-29T20:00:00.000Z',durationMs:BREAK_GLASS_MAX_MS+1}),null);
});

test('legal hold permits preservation administration but deletion remains role constrained',()=>{
 assert.equal(evaluateAccess({...base,actorId:'retention-admin-001',role:'RETENTION_ADMIN',purpose:'RETENTION_ADMIN',lifecycle:'LEGAL_HOLD',dataKind:'EVIDENCE_METADATA',action:'READ',consentValidUntil:null}).allowed,true);
 assert.equal(evaluateAccess({...base,lifecycle:'LEGAL_HOLD'}).allowed,false);
});

test('high risk model recommendation never becomes autonomous authority',()=>{
 assert.equal(mayExecuteRecommendation({risk:'HIGH',humanApproved:false,explanationId:'explain-001',reversibleWhereSafe:true}),false);
 assert.equal(mayExecuteRecommendation({risk:'CRITICAL',humanApproved:true,explanationId:null,reversibleWhereSafe:true}),false);
 assert.equal(mayExecuteRecommendation({risk:'HIGH',humanApproved:true,explanationId:'explain-001',reversibleWhereSafe:true}),true);
});

test('general telemetry strips raw precise and exceptional-access receipts',()=>{
 const redacted=redactForGeneralTelemetry({state:'ACTIVE',rawConversation:'secret',rawEvidence:'blob',preciseLocation:'24.7136,46.6753',rawToken:'token',phoneNumber:'0500000000',alertReceiptId:'alert-secret',auditEventId:'audit-secret',safeReason:'purpose_allowed'});
 assert.deepEqual(redacted,{state:'ACTIVE',safeReason:'purpose_allowed'});
});

test('threat model has owner control test and no accepted P0',()=>{
 assert.ok(THREAT_CONTROL_MATRIX.length>=6);
 for(const row of THREAT_CONTROL_MATRIX){assert.ok(row.owner);assert.ok(row.control);assert.ok(row.test);assert.notEqual(row.residualRisk,'P0');}
});
