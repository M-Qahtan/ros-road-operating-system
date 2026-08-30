import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SyntheticStagingConfigurationError,
  syntheticStagingEnabled
} from './synthetic-staging-profile.js';

export function syntheticStaging(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ROS_DEPLOYMENT_PROFILE: 'synthetic-staging',
    ROS_CLOUD_REGION: 'eu-central-1',
    ROS_CLOUD_JURISDICTION: 'Germany / European Union',
    ROS_PILOT_GEOGRAPHY: 'Riyadh, Saudi Arabia',
    ROS_STAGING_DATA_CLASSIFICATION: 'SYNTHETIC_NON_SENSITIVE_ONLY',
    ROS_REAL_INCIDENT_DATA_ALLOWED: 'false',
    ...overrides
  };
}

test('synthetic staging requires the complete immutable hosting and data boundary', () => {
  assert.equal(syntheticStagingEnabled(syntheticStaging()), true);
  assert.equal(syntheticStagingEnabled({ NODE_ENV: 'production' }), false);

  for (const [name, value] of [
    ['NODE_ENV', 'staging'],
    ['ROS_CLOUD_REGION', 'me-central-1'],
    ['ROS_CLOUD_JURISDICTION', 'Saudi Arabia'],
    ['ROS_PILOT_GEOGRAPHY', 'Frankfurt, Germany'],
    ['ROS_STAGING_DATA_CLASSIFICATION', 'PRODUCTION'],
    ['ROS_REAL_INCIDENT_DATA_ALLOWED', 'true']
  ] as const) {
    assert.throws(
      () => syntheticStagingEnabled(syntheticStaging({ [name]: value })),
      SyntheticStagingConfigurationError
    );
  }
});

test('unknown deployment profiles fail closed instead of becoming ordinary production', () => {
  assert.throws(
    () => syntheticStagingEnabled({ NODE_ENV: 'production', ROS_DEPLOYMENT_PROFILE: 'synthetic-ish' }),
    /ROS_DEPLOYMENT_PROFILE is unsupported/
  );
});
