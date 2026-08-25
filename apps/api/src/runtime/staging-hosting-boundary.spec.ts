import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROS_PILOT_GEOGRAPHY,
  ROS_STAGING_CLOUD_JURISDICTION,
  ROS_STAGING_DATA_CLASSIFICATION,
  ROS_STAGING_REAL_INCIDENT_DATA_ALLOWED,
  ROS_STAGING_REGION,
  ROS_STAGING_SAUDI_HOSTED
} from './staging-plan-only-runner.js';

test('temporary cloud staging hosting boundary remains explicit and fail-closed by policy', () => {
  assert.equal(ROS_STAGING_REGION, 'me-central-1');
  assert.equal(ROS_STAGING_CLOUD_JURISDICTION, 'United Arab Emirates');
  assert.equal(ROS_PILOT_GEOGRAPHY, 'Riyadh, Saudi Arabia');
  assert.equal(ROS_STAGING_SAUDI_HOSTED, false);
  assert.equal(ROS_STAGING_DATA_CLASSIFICATION, 'SYNTHETIC_NON_SENSITIVE_ONLY');
  assert.equal(ROS_STAGING_REAL_INCIDENT_DATA_ALLOWED, false);
});
