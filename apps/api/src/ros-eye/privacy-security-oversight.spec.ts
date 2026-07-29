import assert from 'node:assert/strict';
import test from 'node:test';
import { BREAK_GLASS_MAX_MS, THREAT_CONTROL_MATRIX, createBreakGlassLease, evaluateAccess, mayExecuteRecommendation, redactForGeneralTelemetry, type AccessRequest } from './privacy-security-oversight.js';

const base:AccessRequest={tenantId:'tenant-riyadh',caseId:'case-001',actorId:'operator-001',actorTenantId:'tenant-riyadh',actorCaseId:'case-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',lifecycle:'ACTIVE',dataKind:'OPERATOR_VIEW',action:'READ',consentValidUntil:'2026-07-30T00:00:00.000Z',consentRevokedAt:null,now:'2026-07-29T20:00:00.000Z',breakGlass:null};

test('deny by default for cross tenant cross case and missing actor access',()=>{
 assert.equal(evaluateAccess({...base,actorTenantId:'tenant-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorCaseId:'case-other'}).allowed,false);
 assert.equal(evaluateAccess({...base,actorId:''}).reasonCode,'scope_or_actor_mismatch');
});

test('least privilege purpose mismatch and raw access without break glass fail closed',()=>{
 assert.equal(evaluateAccess({...base,role:'SYSTEM_WORKER',purpose:'OPERATOR_REVIEW'}).allowed,false);
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW'}).mode,'DENY');
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW'}).reasonCode,'minimum_necessary_denied');
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW',action:'EXPORT'}).allowed,false);
});

test('expired and revoked consent deny processing',()=>{
 assert.equal(evaluateAccess({...base,consentValidUntil:'2026-07-29T19:00:00.000Z'}).reasonCode,'consent_invalid');
 assert.equal(evaluateAccess({...base,consentRevokedAt:'2026-07-29T19:30:00.000Z'}).reasonCode,'consent_invalid');
});

test('break glass is actor bound scoped alerted reviewed and expires',()=>{
 const lease=createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-001',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'immediate_safety_review',issuedAt:'2026-07-29T20:00:00.000Z',alertId:'alert-001',durationMs:60_000});
 assert.ok(lease);
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW',breakGlass:lease}).mode,'FULL');
 assert.equal(evaluateAccess({...base,actorId:'operator-002',dataKind:'EVIDENCE_RAW',breakGlass:lease}).mode,'DENY');
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW',breakGlass:{...lease,reviewedAt:'2026-07-29T20:00:30.000Z'}}).mode,'DENY');
 assert.equal(evaluateAccess({...base,dataKind:'EVIDENCE_RAW',breakGlass:lease,now:'2026-07-29T20:01:01.000Z'}).mode,'DENY');
 assert.equal(createBreakGlassLease({tenantId:'tenant-riyadh',caseId:'case-001',leaseId:'lease-002',actorId:'operator-001',role:'SAFETY_OPERATOR',purpose:'OPERATOR_REVIEW',reasonCode:'review_required',issuedAt:'2026-07-29T20:00:00.000Z',alertId:'alert-002',durationMs:BREAK_GLASS_MAX_MS+1}),null);
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

test('general telemetry strips raw and precise fields',()=>{
 const redacted=redactForGeneralTelemetry({state:'ACTIVE',rawConversation:'secret',rawEvidence:'blob',preciseLocation:'24.7136,46.6753',rawToken:'token',phoneNumber:'0500000000',safeReason:'purpose_allowed'});
 assert.deepEqual(redacted,{state:'ACTIVE',safeReason:'purpose_allowed'});
});

test('threat model has owner control test and no accepted P0',()=>{
 assert.ok(THREAT_CONTROL_MATRIX.length>=6);
 for(const row of THREAT_CONTROL_MATRIX){assert.ok(row.owner);assert.ok(row.control);assert.ok(row.test);assert.notEqual(row.residualRisk,'P0');}
});
