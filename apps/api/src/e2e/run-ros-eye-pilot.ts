import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runRosEyePilotSimulation } from './ros-eye-pilot.js';

const result = await runRosEyePilotSimulation();
if (!result.passed || result.readiness.decision !== 'ENGINEERING_READY_FOR_CONTROLLED_PILOT_PREPARATION') {
  throw new Error('ROS Eye pilot-readiness simulation failed');
}

const root = resolve(process.env.ROS_EYE_PILOT_ARTIFACT_DIR ?? 'artifacts/ros-eye/pilot-readiness');
const resultPath = resolve(root, 'result.json');
const reportPath = resolve(root, 'pilot-readiness-report.json');
const evidencePath = resolve(root, 'evidence.json');
const candidateHeadSha = process.env.CANDIDATE_HEAD_SHA ?? 'local';
const candidateBaseSha = process.env.CANDIDATE_BASE_SHA ?? 'local';
const testedMergeSha = process.env.TESTED_MERGE_SHA ?? 'local';
const runId = process.env.GITHUB_RUN_ID ?? 'local';
const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
const resultDigest = `sha256:${createHash('sha256').update(JSON.stringify(result)).digest('hex')}`;
const hazardDigest = `sha256:${createHash('sha256').update(JSON.stringify(result.hazards)).digest('hex')}`;
const evidence = {
  schemaVersion: 'ros-eye.pilot-evidence.v1',
  generatedAt: new Date().toISOString(),
  candidateHeadSha,
  candidateBaseSha,
  testedMergeSha,
  runId,
  runAttempt,
  scenario: result.scenario,
  decision: result.readiness.decision,
  passed: result.passed,
  deterministicFingerprint: result.deterministicFingerprint,
  resultDigest,
  hazardDigest,
  hazardCount: result.hazards.length,
  passedHazards: result.hazards.filter((hazard) => hazard.status === 'PASS').length,
  publicRoadDeploymentAuthorized: false,
  realEmergencyIntegrationAuthorized: false
};
const report = {
  schemaVersion: 'ros-eye.pilot-readiness-report.v1',
  generatedAt: evidence.generatedAt,
  scenario: result.scenario,
  decision: result.readiness.decision,
  engineeringEvidence: {
    acceptedSignals: result.signalIngestion.acceptedSignals,
    duplicateReplayBlocked: result.signalIngestion.duplicateReplayBlocked,
    oneCaseCreated: result.signalIngestion.oneCaseCreated,
    operatorTakeover: result.contact.operatorTakeover,
    recommendedSeverity: result.recommendation.recommendedSeverity,
    recommendationAuthority: result.recommendation.authority,
    evidenceControlsPassed: Object.values(result.evidence).every((value) => typeof value === 'number' ? value > 0 : value === true),
    recoveryControlsPassed: Object.values(result.recovery).every(Boolean),
    roadEventFinalStatus: result.roadEvent.finalStatus,
    unauthorizedResolutionRejected: result.supervisorResolution.unauthorizedResolutionRejected,
    loadBaseline: result.loadBaseline,
    hazards: result.hazards
  },
  limitations: result.readiness.limitations,
  residualRisks: result.readiness.residualRisks,
  humanStaffingNeeds: result.readiness.humanStaffingNeeds,
  externalApprovalsRequired: result.readiness.externalApprovalsRequired,
  authorizationBoundary: {
    publicRoadDeploymentAuthorized: false,
    realEmergencyIntegrationAuthorized: false,
    statement: 'Engineering readiness supports only controlled pilot preparation. It does not authorize live public-road deployment or real emergency-service integration.'
  }
};

await mkdir(dirname(resultPath), { recursive: true });
await Promise.all([
  writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8'),
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
]);
console.log(JSON.stringify({
  level: 'info',
  message: 'ROS Eye pilot-readiness simulation passed',
  resultPath,
  reportPath,
  evidencePath,
  decision: result.readiness.decision,
  deterministicFingerprint: result.deterministicFingerprint,
  hazardCount: result.hazards.length
}));
