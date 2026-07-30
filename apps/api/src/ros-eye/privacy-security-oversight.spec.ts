import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
 BREAK_GLASS_MAX_MS, PRIVACY_POLICY_VERSION, PrivacyAccessOrchestrator, RecommendationExecutionOrchestrator, THREAT_CONTROL_MATRIX,
 createBreakGlassLease, evaluateAccess, redactForGeneralTelemetry,
 type AccessRequest, type BreakGlassGrantInput, type BreakGlassGrantReceipt, type BreakGlassGrantRepositoryPort,
 type BreakGlassGrantTransaction, type ConsentAuthorityPort, type ConsentGrantReceipt,
 type RecommendationApprovalReceipt, type RecommendationAuthorityPort, type RecommendationExecutionRequest
} from './privacy-security-oversight.js';

const base:AccessRequest={tenantId:'tenant-riyadh',caseId:'case-001',actorId:'operator-001',actorTenantId:'tenant-riyadh',actorCaseId:'case-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',lifecycle:'ACTIVE',dataKind:'OPERATOR_VIEW',action:'READ',now:'2026-07-29T20:00:00.000Z',breakGlass:null,sessionId:'session-001',subjectId:'subject-001',consentGrantId:'consent-001',idempotencyKey:'access-001'};
const ids={async create(namespace:string,material:string){return `${namespace}-${createHash('sha256').update(material).digest('hex').slice(0,24)}`;}};

class MemoryConsent implements ConsentAuthorityPort{
 grant:ConsentGrantReceipt|null={tenantId:'tenant-riyadh',caseId:'case-001',grantId:'consent-001',sessionId:'session-001',subjectId:'subject-001',purposes:['OPERATOR_REVIEW'],dataKinds:['OPERATOR_VIEW','EVIDENCE_RAW'],actions:['READ'],disclosureLanguage:'ar-SA',contactState:'CONTACTING',protocolVersion:'human-contact-v1',consentPolicyVersion:'consent-v1',grantedAt:'2026-07-29T19:59:00.000Z',expiresAt:'2026-07-29T20:10:00.000Z',revokedAt:null,status:'ACTIVE'};
 async findConsentGrant(input:{tenantId:string;caseId:string;grantId:string;sessionId:string;subjectId:string}){const g=this.grant;return g!==null&&g.tenantId===input.tenantId&&g.caseId===input.caseId&&g.grantId===input.grantId&&g.sessionId===input.sessionId&&g.subjectId===input.subjectId?g:null}
}

class MemoryGrants implements BreakGlassGrantRepositoryPort,BreakGlassGrantTransaction{
 readonly receipts=new Map<string,BreakGlassGrantReceipt>(); readonly alerts=new Set<string>(); readonly audits=new Set<string>(); readonly abuse=new Set<string>();
 failAlert=false; failAudit=false; abuseResult:'ALLOW'|'RATE_LIMIT'|'ANOMALY_REVIEW'='ALLOW';
 async transaction<T>(work:(tx:BreakGlassGrantTransaction)=>Promise<T>):Promise<T>{return work(this)}
 async findAuthorized(input:{tenantId:string;caseId:string;grantId:string;actorId:string;leaseId:string}){const r=this.receipts.get(input.grantId);return r?.tenantId===input.tenantId&&r.caseId===input.caseId&&r.actorId===input.actorId&&r.leaseId===input.leaseId?r:null}
 async consumeAbuse(input:BreakGlassGrantInput){if(this.abuseResult!=='ALLOW')return this.abuseResult;this.abuse.add(input.grantId);return 'ALLOW' as const}
 async reserveAlert(input:BreakGlassGrantInput){if(this.failAlert)return{status:'FAILED' as const,receiptId:null};const receiptId=`alert-${input.grantId}`;const existed=this.alerts.has(receiptId);this.alerts.add(receiptId);return{status:existed?'EXISTS' as const:'RESERVED' as const,receiptId}}
 async appendAudit(input:BreakGlassGrantInput&{alertReceiptId:string}){if(this.failAudit||!this.alerts.has(input.alertReceiptId))return{status:'FAILED' as const,eventId:null};const eventId=`audit-${input.grantId}`;const existed=this.audits.has(eventId);this.audits.add(eventId);return{status:existed?'IDEMPOTENT' as const:'APPENDED' as const,eventId}}
 async finalizeGrant(input:BreakGlassGrantInput&{alertReceiptId:string;auditEventId:string}){if(!this.abuse.has(input.grantId)||!this.alerts.has(input.alertReceiptId)||!this.audits.has(input.auditEventId))return{status:'CONFLICT' as const,receipt:null};const existing=this.receipts.get(input.grantId);if(existing)return{status:'IDEMPOTENT' as const,receipt:existing};const receipt:BreakGlassGrantReceipt={...input,status:'AUTHORIZED'};this.receipts.set(input.grantId,receipt);return{status:'AUTHORIZED' as const,receipt}}
}

class MemoryRecommendationAuthority implements RecommendationAuthorityPort{
 approval:RecommendationApprovalReceipt|null={tenantId:'tenant-riyadh',caseId:'case-001',approvalId:'approval-001',recommendationId:'recommendation-001',recommendationVersion:1,actionId:'action-001',risk:'CRITICAL',approverId:'supervisor-001',approverRole:'SAFETY_OPERATOR',proposerId:'model-worker-001',explanationArtifactHash:'sha256:explanation-001',policyVersion:PRIVACY_POLICY_VERSION,approvedAt:'2026-07-29T19:59:00.000Z',expiresAt:'2026-07-29T20:05:00.000Z',revokedAt:null,status:'APPROVED'};
 result:'AUTHORIZED'|'IDEMPOTENT'|'DENIED'|'AUDIT_FAILED'='AUTHORIZED';
 async findApproval(input:{tenantId:string;caseId:string;approvalId:string;recommendationId:string;recommendationVersion:number;actionId:string}){const a=this.approval;return a!==null&&a.tenantId===input.tenantId&&a.caseId===input.caseId&&a.approvalId===input.approvalId&&a.recommendationId===input.recommendationId&&a.recommendationVersion===input.recommendationVersion&&a.actionId===input.actionId?a:null}
 async authorizeExecution(_input:RecommendationExecutionRequest&{approval:RecommendationApprovalReceipt|null}){return this.result}
}

function lease(){const value=createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-001',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'immediate_safety_review',issuedAt:'2026-07-29T20:00:00.000Z',durationMs:60_000});assert.ok(value);return value}
function raw(overrides:Partial<AccessRequest>={}):AccessRequest{return{...base,dataKind:'EVIDENCE_RAW',breakGlass:lease(),...overrides}}
function service(repo=new MemoryGrants(),consent=new MemoryConsent()){return new PrivacyAccessOrchestrator(repo,ids,consent)}

 test('deny by default for cross tenant cross case and missing actor access',()=>{
 assert.equal(evaluateAccess({...base,actorTenantId:'tenant-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorCaseId:'case-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorId:''}).reasonCode,'scope_or_actor_mismatch');
});

test('pure evaluator never trusts caller consent or grants raw access',()=>{
 assert.equal(evaluateAccess(base).reasonCode,'authoritative_consent_required');
 assert.equal(evaluateAccess(raw()).mode,'DENY');
 assert.equal(evaluateAccess(raw({action:'EXPORT'})).reasonCode,'restricted_export_denied');
});

test('authoritative consent is bound to session subject purpose data action and sequence',async()=>{
 assert.equal((await service().authorizeAccess(base)).allowed,true);
 for(const request of [
  {...base,consentGrantId:'fabricated-001'},
  {...base,sessionId:'session-other'},
  {...base,subjectId:'subject-other'},
  {...base,lifecycle:'CONSENT_PENDING' as const},
  {...base,lifecycle:'LANGUAGE_SELECTION' as const}
 ])assert.equal((await service().authorizeAccess(request)).allowed,false);
 const wrongPurpose=new MemoryConsent();wrongPurpose.grant={...wrongPurpose.grant!,purposes:['SAFETY_CONTACT']};
 assert.equal((await service(new MemoryGrants(),wrongPurpose).authorizeAccess(base)).allowed,false);
 const missing=new MemoryConsent();missing.grant=null;
 assert.equal((await service(new MemoryGrants(),missing).authorizeAccess(base)).reasonCode,'consent_record_missing');
});

test('consent expiry revocation and incomplete sequence deny',async()=>{
 const consent=new MemoryConsent();consent.grant={...consent.grant!,expiresAt:'2026-07-29T19:59:59.000Z'};
 assert.equal((await service(new MemoryGrants(),consent).authorizeAccess(base)).allowed,false);
 consent.grant={...consent.grant!,expiresAt:'2026-07-29T20:05:00.000Z',revokedAt:'2026-07-29T19:59:30.000Z',status:'REVOKED'};
 assert.equal((await service(new MemoryGrants(),consent).authorizeAccess(base)).allowed,false);
 consent.grant={...consent.grant!,revokedAt:null,status:'ACTIVE',contactState:'CONTACTING',disclosureLanguage:''};
 assert.equal((await service(new MemoryGrants(),consent).authorizeAccess(base)).allowed,false);
});

test('durable alert audit abuse and finalization are all required before FULL access',async()=>{
 const repo=new MemoryGrants();const result=await service(repo).authorizeAccess(raw());
 assert.equal(result.mode,'FULL');assert.ok(result.receiptId);
 assert.equal(repo.alerts.size,1);assert.equal(repo.audits.size,1);assert.equal(repo.abuse.size,1);assert.equal(repo.receipts.size,1);
});

test('alert audit and abuse failures deny without raw disclosure',async()=>{
 const alertRepo=new MemoryGrants();alertRepo.failAlert=true;assert.equal((await service(alertRepo).authorizeAccess(raw())).reasonCode,'break_glass_alert_not_durable');
 const auditRepo=new MemoryGrants();auditRepo.failAudit=true;assert.equal((await service(auditRepo).authorizeAccess(raw())).reasonCode,'break_glass_audit_not_durable');
 const abuseRepo=new MemoryGrants();abuseRepo.abuseResult='RATE_LIMIT';assert.equal((await service(abuseRepo).authorizeAccess(raw())).reasonCode,'break_glass_rate_limited');
 assert.equal(alertRepo.receipts.size+auditRepo.receipts.size+abuseRepo.receipts.size,0);
});

test('duplicate and concurrent break-glass use are idempotent and audited once',async()=>{
 const repo=new MemoryGrants();const access=service(repo);const results=await Promise.all([access.authorizeAccess(raw()),access.authorizeAccess(raw())]);
 assert.equal(results.every(r=>r.mode==='FULL'),true);assert.equal(repo.alerts.size,1);assert.equal(repo.audits.size,1);assert.equal(repo.receipts.size,1);
});

test('invented receipts and cross actor case tenant expiry review revocation fail closed',async()=>{
 const repo=new MemoryGrants();const input:BreakGlassGrantInput={tenantId:'tenant-riyadh',caseId:'case-001',grantId:'grant-invented',idempotencyKey:'access-001',actorId:'operator-001',leaseId:'lease-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',dataKind:'EVIDENCE_RAW',action:'READ',reasonCode:'immediate_safety_review',occurredAt:base.now,policyVersion:PRIVACY_POLICY_VERSION};
 assert.equal((await repo.finalizeGrant({...input,alertReceiptId:'invented-alert',auditEventId:'invented-audit'})).status,'CONFLICT');
 const current=lease();const access=service();
 for(const request of [raw({actorId:'operator-002'}),raw({actorCaseId:'case-other'}),raw({actorTenantId:'tenant-other'}),raw({now:'2026-07-29T20:01:01.000Z'}),raw({breakGlass:{...current,reviewedAt:'2026-07-29T20:00:30.000Z'}}),raw({breakGlass:{...current,revokedAt:'2026-07-29T20:00:20.000Z'}})])assert.equal((await access.authorizeAccess(request)).mode,'DENY');
});

test('break glass maximum duration and legal hold boundaries are enforced',async()=>{
 assert.equal(createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-002',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'review_required',issuedAt:'2026-07-29T20:00:00.000Z',durationMs:BREAK_GLASS_MAX_MS+1}),null);
 const retention={...base,actorId:'retention-admin-001',role:'RETENTION_ADMIN' as const,purpose:'RETENTION_ADMIN' as const,lifecycle:'LEGAL_HOLD' as const,dataKind:'EVIDENCE_METADATA' as const,action:'READ' as const,sessionId:null,subjectId:null,consentGrantId:null};
 assert.equal((await service().authorizeAccess(retention)).allowed,true);
 assert.equal((await service().authorizeAccess({...base,lifecycle:'LEGAL_HOLD'})).allowed,false);
});

test('authoritative human approval prevents model self-authorization and replay',async()=>{
 const authority=new MemoryRecommendationAuthority();const orchestrator=new RecommendationExecutionOrchestrator(authority);
 const request:RecommendationExecutionRequest={tenantId:'tenant-riyadh',caseId:'case-001',recommendationId:'recommendation-001',recommendationVersion:1,actionId:'action-001',risk:'CRITICAL',proposerId:'model-worker-001',approvalId:'approval-001',explanationArtifactHash:'sha256:explanation-001',now:'2026-07-29T20:00:00.000Z',idempotencyKey:'execute-001'};
 assert.equal(await orchestrator.authorize(request),true);
 assert.equal(await orchestrator.authorize({...request,approvalId:'self-issued'}),false);
 authority.approval={...authority.approval!,approverId:'model-worker-001'};assert.equal(await orchestrator.authorize(request),false);
 authority.approval={...authority.approval!,approverId:'supervisor-001',actionId:'action-other'};assert.equal(await orchestrator.authorize(request),false);
 authority.approval={...authority.approval!,actionId:'action-001',revokedAt:'2026-07-29T19:59:30.000Z',status:'REVOKED'};assert.equal(await orchestrator.authorize(request),false);
 authority.approval={...authority.approval!,revokedAt:null,status:'APPROVED'};authority.result='AUDIT_FAILED';assert.equal(await orchestrator.authorize(request),false);
});

test('general telemetry is an explicit scalar allowlist and strips nested aliases',()=>{
 const circular:Record<string,unknown>={state:'ACTIVE'};circular.self=circular;
 const redacted=redactForGeneralTelemetry({eventType:'privacy_decision',state:'ACTIVE',reasonCode:'purpose_allowed',context:{rawEvidence:'secret',preciseLocation:'24.7,46.6'},events:[{medicalNarrative:'private'}],RawConversation:'secret',evidencePayload:'blob',location:'precise',rawToken:'token',phoneNumber:'0500000000',circular});
 assert.deepEqual(redacted,{eventType:'privacy_decision',state:'ACTIVE',reasonCode:'purpose_allowed'});
});

test('threat model has owner control test and no accepted P0',()=>{
 assert.ok(THREAT_CONTROL_MATRIX.length>=6);
 for(const row of THREAT_CONTROL_MATRIX){assert.ok(row.owner);assert.ok(row.control);assert.ok(row.test);assert.notEqual(row.residualRisk,'P0');}
});
