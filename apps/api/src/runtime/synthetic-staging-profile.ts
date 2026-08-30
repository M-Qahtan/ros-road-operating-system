const EXPECTED_BOUNDARY = Object.freeze({
  NODE_ENV: 'production',
  ROS_CLOUD_REGION: 'eu-central-1',
  ROS_CLOUD_JURISDICTION: 'Germany / European Union',
  ROS_PILOT_GEOGRAPHY: 'Riyadh, Saudi Arabia',
  ROS_STAGING_DATA_CLASSIFICATION: 'SYNTHETIC_NON_SENSITIVE_ONLY',
  ROS_REAL_INCIDENT_DATA_ALLOWED: 'false'
} as const);

export class SyntheticStagingConfigurationError extends Error {
  override readonly name = 'SyntheticStagingConfigurationError';
}

/**
 * Allows deliberately constrained adapters inside a production-hardened
 * process only for the Frankfurt synthetic/non-sensitive staging slice.
 */
export function syntheticStagingEnabled(environment: NodeJS.ProcessEnv): boolean {
  const profile = environment.ROS_DEPLOYMENT_PROFILE?.trim();
  if (profile === undefined || profile === '') return false;
  if (profile !== 'synthetic-staging') {
    throw new SyntheticStagingConfigurationError('ROS_DEPLOYMENT_PROFILE is unsupported');
  }
  for (const [name, expected] of Object.entries(EXPECTED_BOUNDARY)) {
    if (environment[name]?.trim() !== expected) {
      throw new SyntheticStagingConfigurationError(
        `synthetic staging boundary requires ${name}=${expected}`
      );
    }
  }
  return true;
}
