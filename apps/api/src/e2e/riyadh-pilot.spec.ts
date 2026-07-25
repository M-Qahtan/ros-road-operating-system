import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadEventStatus, SeverityLevel } from '@ros/domain';
import { runRiyadhPilotSimulation } from './riyadh-pilot.js';

test('Riyadh pilot completes the deterministic safety-first vertical slice', async () => {
  const result = await runRiyadhPilotSimulation();
  assert.equal(result.finalStatus, RoadEventStatus.Closed);
  assert.equal(result.dashboard.status, RoadEventStatus.Closed);
  assert.equal(result.dashboard.severity, SeverityLevel.High);
  assert.equal(result.dashboard.stale, false);
  assert.equal(result.attachedSignals, 2);
  assert.equal(result.duplicateSignalStable, true);
  assert.equal(result.duplicateCreateStable, true);
  assert.equal(result.notifications, 3);
  assert.equal(result.recoverySucceeded, true);
  assert.equal(result.evidenceVerified, true);
  assert.equal(result.closureBypassRejected, true);
  assert.ok(result.auditActions.includes('road_event.severity_reassessed'));
  assert.ok(result.auditActions.includes('road_event.closure_authorized'));
  assert.ok(result.auditActions.includes('road_event.closed'));
});

test('Riyadh pilot is replayable and produces stable business results', async () => {
  const first = await runRiyadhPilotSimulation();
  const second = await runRiyadhPilotSimulation();
  assert.deepEqual(
    { ...first, performanceMs: undefined },
    { ...second, performanceMs: undefined }
  );
});

test('create/list/detail baseline stays within a conservative local threshold', async () => {
  const result = await runRiyadhPilotSimulation();
  assert.ok(result.performanceMs.create < 250, `create took ${result.performanceMs.create}ms`);
  assert.ok(result.performanceMs.list < 100, `list took ${result.performanceMs.list}ms`);
  assert.ok(result.performanceMs.detail < 100, `detail took ${result.performanceMs.detail}ms`);
});
