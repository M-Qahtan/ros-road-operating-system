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

test('failure-mode evidence is replayable', () => {
  assert.deepEqual(runRiyadhFailureModeSuite('stable-sha'), runRiyadhFailureModeSuite('stable-sha'));
});
