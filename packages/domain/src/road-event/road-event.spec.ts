import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidRoadEventError,
  InvalidRoadEventTransitionError,
  RoadEvent,
  RoadEventClosureRequiresHumanAuthorizationError
} from './road-event.js';
import { allowedTransitions, RoadEventStatus } from './road-event-status.js';
import { SeverityLevel } from './severity.js';

const baseProps = {
  id: 'evt-1',
  occurredAt: new Date('2026-07-24T12:00:00.000Z'),
  latitude: 24.7136,
  longitude: 46.6753
};

test('RoadEvent allows every declared state transition', () => {
  for (const [current, nextStates] of Object.entries(allowedTransitions)) {
    for (const next of nextStates) {
      const event = new RoadEvent({ ...baseProps, status: current as RoadEventStatus });
      event.transitionTo(next);
      assert.equal(event.status, next);
    }
  }
});

test('RoadEvent blocks undeclared state transitions', () => {
  for (const current of Object.values(RoadEventStatus)) {
    for (const next of Object.values(RoadEventStatus)) {
      if (allowedTransitions[current].includes(next)) continue;
      const event = new RoadEvent({ ...baseProps, status: current });
      assert.throws(() => event.transitionTo(next), InvalidRoadEventTransitionError);
    }
  }
});

test('RoadEvent validates identity, time, coordinates and version', () => {
  assert.throws(() => new RoadEvent({ ...baseProps, id: ' ' }), InvalidRoadEventError);
  assert.throws(() => new RoadEvent({ ...baseProps, occurredAt: new Date('invalid') }), InvalidRoadEventError);
  assert.throws(() => new RoadEvent({ ...baseProps, latitude: 91 }), InvalidRoadEventError);
  assert.throws(() => new RoadEvent({ ...baseProps, longitude: -181 }), InvalidRoadEventError);
  assert.throws(() => new RoadEvent({ ...baseProps, version: 0 }), InvalidRoadEventError);
});

test('S3 and S4 events cannot close without explicit human authorization', () => {
  for (const level of [SeverityLevel.High, SeverityLevel.Critical]) {
    const event = new RoadEvent({
      ...baseProps,
      status: RoadEventStatus.Recovery,
      severity: {
        level,
        score: level === SeverityLevel.High ? 70 : 95,
        confidence: 0.9,
        reasonCodes: ['safety_escalation'],
        requiresHumanReview: true
      }
    });

    assert.throws(
      () => event.transitionTo(RoadEventStatus.Closed),
      RoadEventClosureRequiresHumanAuthorizationError
    );

    event.authorizeClosure({
      actorId: 'operator-1',
      reason: 'Scene verified safe and all response tasks completed',
      authorizedAt: new Date('2026-07-24T12:30:00.000Z')
    });
    event.transitionTo(RoadEventStatus.Closed);
    assert.equal(event.status, RoadEventStatus.Closed);
  }
});

test('severity reassessment invalidates earlier closure authorization', () => {
  const event = new RoadEvent({ ...baseProps, status: RoadEventStatus.Recovery });
  event.authorizeClosure({
    actorId: 'operator-1',
    reason: 'Initial verification',
    authorizedAt: new Date('2026-07-24T12:30:00.000Z')
  });
  event.assessSeverity({
    level: SeverityLevel.Critical,
    score: 95,
    confidence: 0.9,
    reasonCodes: ['secondary_hazard'],
    requiresHumanReview: true
  });

  assert.equal(event.closureAuthorization, undefined);
  assert.throws(
    () => event.transitionTo(RoadEventStatus.Closed),
    RoadEventClosureRequiresHumanAuthorizationError
  );
});

test('S3 and S4 severity assessments always require human review', () => {
  const event = new RoadEvent(baseProps);
  assert.throws(() => event.assessSeverity({
    level: SeverityLevel.High,
    score: 70,
    confidence: 0.9,
    reasonCodes: ['high_impact'],
    requiresHumanReview: false
  }), TypeError);
});

test('severity assessments are immutable after acceptance', () => {
  const reasonCodes = ['initial_detection'];
  const event = new RoadEvent({
    ...baseProps,
    severity: {
      level: SeverityLevel.Low,
      score: 25,
      confidence: 0.7,
      reasonCodes,
      requiresHumanReview: true
    }
  });
  reasonCodes.push('mutated_outside');
  assert.deepEqual(event.severity.reasonCodes, ['initial_detection']);
  assert.equal(Object.isFrozen(event.severity), true);
  assert.equal(Object.isFrozen(event.severity.reasonCodes), true);
});
