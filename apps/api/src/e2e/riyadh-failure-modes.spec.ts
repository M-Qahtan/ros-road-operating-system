import assert from 'node:assert/strict';
import test from 'node:test';
import { runRiyadhFailureModeSuite } from './riyadh-failure-modes.js';

test('Riyadh failure-mode suite keeps every modeled hazard in a deterministic safe state', () => {
  const results = runRiyadhFailureModeSuite('test-commit-sha');
  assert.equal(results.length, 12);
  assert.equal(results.every((result) => result.passed), true);
  assert.equal(new Set(results.map((result) => result.hazardId)).size, 12);
  assert.equal(results.every((result) => result.evidence.commitSha === 'test-commit-sha'), true);
});

test('late evidence remains append-only and does not reopen a closed event', () => {
  const result = runRiyadhFailureModeSuite('stable-sha').find((item) => item.hazardId === 'HZ-02');
  assert.ok(result);
  assert.equal(result.evidence.status, 'CLOSED');
  assert.equal(result.evidence.evidenceRevision, 5);
  assert.equal(result.evidence.reopened, false);
});

test('S3 and S4 actions remain under supervisor authority', () => {
  const result = runRiyadhFailureModeSuite('stable-sha').find((item) => item.hazardId === 'HZ-12');
  assert.ok(result);
  assert.equal(result.evidence.authorizedSupervisor, false);
  assert.equal(result.evidence.protectedSeverities, 'S3,S4');
  assert.equal(result.passed, true);
});

test('failure-mode evidence is replayable', () => {
  assert.deepEqual(runRiyadhFailureModeSuite('stable-sha'), runRiyadhFailureModeSuite('stable-sha'));
});
