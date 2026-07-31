import assert from 'node:assert/strict';
import test from 'node:test';
import { runRosEyePilotSimulation } from './ros-eye-pilot.js';

test('ROS Eye full vertical slice finishes every P0/P1 hazard in its safe state', async () => {
  const result = await runRosEyePilotSimulation();
  assert.equal(result.passed, true);
  assert.ok(result.hazards.length >= 14);
  assert.deepEqual([...new Set(result.hazards.map((hazard) => hazard.status))], ['PASS']);
  assert.equal(result.readiness.decision, 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION');
  assert.equal(result.readiness.publicRoadDeploymentAuthorized, false);
  assert.equal(result.readiness.realEmergencyIntegrationAuthorized, false);
});

test('multimodal inputs correlate to one case and replay/conflict fail safely', async () => {
  const result = await runRosEyePilotSimulation();
  assert.equal(result.signalIngestion.acceptedSignals, 2);
  assert.equal(result.signalIngestion.oneCaseCreated, true);
  assert.equal(result.signalIngestion.duplicateReplayBlocked, true);
  assert.equal(result.signalIngestion.conflictingSourceMovedToReview, true);
  assert.ok(result.signalIngestion.quarantineRecords >= 2);
});

test('contact interruption no-response and delayed callback end under operator control', async () => {
  const result = await runRosEyePilotSimulation();
  assert.equal(result.contact.primaryChannelAttempted, true);
  assert.equal(result.contact.fallbackChannelAttempted, true);
  assert.equal(result.contact.noResponseEscalated, true);
  assert.equal(result.contact.operatorTakeover, true);
  assert.equal(result.contact.duplicateCallbackIgnored, true);
  assert.equal(result.contact.delayedCallbackIgnoredAfterTakeover, true);
  assert.equal(result.contact.logicalDeliveries, 1);
});

test('fusion remains explainable recommendation-only and cannot under-triage S3', async () => {
  const result = await runRosEyePilotSimulation();
  assert.ok(['S3', 'S4'].includes(result.recommendation.recommendedSeverity));
  assert.equal(result.recommendation.requiresHumanReview, true);
  assert.equal(result.recommendation.authority, 'RECOMMENDATION_ONLY');
  assert.equal(result.recommendation.autonomousDowngradePermitted, false);
  assert.equal(result.recommendation.autonomousClosurePermitted, false);
  assert.equal(result.recommendation.autonomousDispatchPermitted, false);
  assert.ok(result.recommendation.reasonCodes.includes('FUSION_HUMAN_AUTHORITY_REQUIRED'));
});

test('evidence, dependency failure, restart, stale view and supervisor authority are enforced', async () => {
  const result = await runRosEyePilotSimulation();
  assert.deepEqual(result.evidence, {
    trustedEvidenceAvailable: true,
    checksumMismatchQuarantined: true,
    crossCaseAccessDenied: true,
    objectStorageOutageDegradedSafely: true,
    immutableAuditCount: 3
  });
  assert.ok(Object.values(result.recovery).every(Boolean));
  assert.equal(result.supervisorResolution.unauthorizedResolutionRejected, true);
  assert.equal(result.supervisorResolution.authorizedResolutionRecorded, true);
  assert.equal(result.supervisorResolution.roadReopeningRemainsHumanAuthorized, true);
});

test('duplicate load baseline remains bounded without duplicate case or contact', async () => {
  const result = await runRosEyePilotSimulation();
  assert.equal(result.loadBaseline.duplicateInputs, 2000);
  assert.equal(result.loadBaseline.acceptedLogicalSignals, 2);
  assert.equal(result.loadBaseline.duplicateCasesCreated, 0);
  assert.equal(result.loadBaseline.duplicateContactsCreated, 0);
  assert.equal(result.loadBaseline.bounded, true);
});

test('pilot simulation is deterministic apart from measured elapsed time', async () => {
  const first = await runRosEyePilotSimulation();
  const second = await runRosEyePilotSimulation();
  assert.equal(first.deterministicFingerprint, second.deterministicFingerprint);
  assert.deepEqual(first.hazards, second.hazards);
  assert.equal(first.recommendation.deterministicFingerprint, second.recommendation.deterministicFingerprint);
});

test('pilot evidence contains no raw personal medical location or credential content', async () => {
  const result = await runRosEyePilotSimulation();
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'phoneNumber', 'medicalNarrative', 'accessToken', 'refreshToken', 'authorizationHeader',
    'patientName', 'nationalId', 'rawConversation', 'preciseLatitude', 'preciseLongitude'
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  }
  assert.match(serialized, /publicRoadDeploymentAuthorized/);
  assert.match(serialized, /realEmergencyIntegrationAuthorized/);
});
