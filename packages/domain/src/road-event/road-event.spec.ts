import assert from 'node:assert/strict';
import test from 'node:test';
import { InvalidRoadEventTransitionError, RoadEvent } from './road-event.js';
import { RoadEventStatus } from './road-event-status.js';

test('RoadEvent follows the safety-first state machine', () => {
  const event = new RoadEvent({ id: 'evt-1', occurredAt: new Date(), latitude: 24.7136, longitude: 46.6753 });
  event.transitionTo(RoadEventStatus.Validating);
  event.transitionTo(RoadEventStatus.Confirmed);
  event.transitionTo(RoadEventStatus.SafetyAssessment);
  assert.equal(event.status, RoadEventStatus.SafetyAssessment);
});

test('RoadEvent blocks unsafe state jumps', () => {
  const event = new RoadEvent({ id: 'evt-2', occurredAt: new Date(), latitude: 24.7136, longitude: 46.6753 });
  assert.throws(() => event.transitionTo(RoadEventStatus.Closed), InvalidRoadEventTransitionError);
});
