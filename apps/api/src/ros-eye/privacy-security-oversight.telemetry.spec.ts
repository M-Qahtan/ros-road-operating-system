import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIVACY_POLICY_VERSION, redactForGeneralTelemetry } from './privacy-security-oversight.js';

const canonical={
 eventType:'privacy_decision',
 state:'ACTIVE',
 reasonCode:'policy_allow',
 policyVersion:PRIVACY_POLICY_VERSION,
 role:'SAFETY_OPERATOR',
 purpose:'OPERATOR_REVIEW',
 lifecycle:'ACTIVE',
 dataKind:'OPERATOR_VIEW',
 action:'READ',
 outcome:'ALLOW',
 attempt:1,
 durationMs:350
} as const;

test('general telemetry preserves only canonical registered codes and bounded integers',()=>{
 assert.deepEqual(redactForGeneralTelemetry(canonical),canonical);
 const circular:Record<string,unknown>={state:'ACTIVE'};circular.self=circular;
 assert.deepEqual(redactForGeneralTelemetry({...canonical,context:{rawEvidence:'secret'},events:[{medicalNarrative:'private'}],rawToken:'token',phoneNumber:'0500000000',circular}),canonical);
});

test('sensitive canaries embedded in allowlisted scalar fields drop the whole event',()=>{
 const canaries:ReadonlyArray<Readonly<Record<string,unknown>>>=[
  {eventType:'privacy_decision',reasonCode:'victim said chest pain; phone 0500000000'},
  {eventType:'privacy_decision',outcome:'precise_location=24.7136,46.6753'},
  {eventType:'token_sk-live-secret-fragment'},
  {eventType:'privacy_decision',state:'evidence_payload=binary-secret'},
  {eventType:'privacy_decision',policyVersion:'raw conversation fragment'}
 ];
 for(const candidate of canaries){
  const redacted=redactForGeneralTelemetry(candidate);
  assert.deepEqual(redacted,{});
  const serialized=JSON.stringify(redacted);
  for(const seeded of Object.values(candidate))if(typeof seeded==='string')assert.equal(serialized.includes(seeded),false);
 }
});

test('unknown vocabularies and malformed numeric fields fail closed',()=>{
 const malformed:ReadonlyArray<Readonly<Record<string,unknown>>>=[
  {eventType:'privacy_decision',reasonCode:'unknown_reason'},
  {eventType:'unknown_event'},
  {eventType:'privacy_decision',attempt:0},
  {eventType:'privacy_decision',attempt:101},
  {eventType:'privacy_decision',attempt:1.5},
  {eventType:'privacy_decision',durationMs:-1},
  {eventType:'privacy_decision',durationMs:3_600_001},
  {eventType:'privacy_decision',durationMs:Number.NaN},
  {eventType:'privacy_decision',durationMs:Number.POSITIVE_INFINITY},
  {eventType:'privacy_decision',durationMs:'350'}
 ];
 for(const candidate of malformed)assert.deepEqual(redactForGeneralTelemetry(candidate),{});
});
