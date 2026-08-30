import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const compute = await readFile('infrastructure/staging/aws/compute.tf', 'utf8');
const variables = await readFile('infrastructure/staging/aws/variables.tf', 'utf8');
const tfvars = await readFile('infrastructure/staging/aws/terraform.tfvars.example', 'utf8');

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function canonicalTerraformCorsOrigin(origin) {
  const match = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::([1-9][0-9]{0,4}))?$/.exec(origin);
  if (match === null || origin !== origin.toLowerCase()) return false;
  const port = match[1] === undefined ? undefined : Number(match[1]);
  return port === undefined || (port <= 65_535 && port !== 443);
}

const acceptedCorsOrigins = ['https://dashboard.ros.example', 'https://dashboard.ros.example:8443'];
const rejectedCorsOrigins = [
  'https://EXAMPLE.com',
  'https://example.com:443',
  'https://example.com:65536',
  'https://127.1',
  'https://example.com/path'
];

const requirements = [
  [occurrences(compute, '{ name = "ROS_WORKER_ID_SOURCE", value = "ecs-task-metadata-v4" }') === 2, 'ECS_WORKER_ID_SOURCE'],
  [occurrences(compute, '{ name = "ROS_WORKER_ID_PREFIX", value = var.name_prefix }') === 2, 'ECS_WORKER_ID_PREFIX'],
  [!compute.includes('{ name = "ROS_OUTBOX_WORKER_ID"'), 'STATIC_OUTBOX_ID_FORBIDDEN'],
  [!compute.includes('{ name = "ROS_CONTACT_WORKER_ID"'), 'STATIC_CONTACT_ID_FORBIDDEN'],
  [compute.includes('{ name = "ROS_DEPLOYMENT_PROFILE", value = "synthetic-staging" }'), 'SYNTHETIC_PROFILE'],
  [compute.includes('{ name = "ROS_STAGING_DATA_CLASSIFICATION", value = var.staging_data_classification }'), 'DATA_BOUNDARY'],
  [compute.includes('{ name = "ROS_REAL_INCIDENT_DATA_ALLOWED", value = tostring(var.real_incident_data_allowed) }'), 'REAL_DATA_BOUNDARY'],
  [compute.includes('{ name = "ROS_CONTACT_CHANNEL_PROFILE", value = "in-app-only" }'), 'IN_APP_CONTACT'],
  [compute.includes('{ name = "ROS_MALWARE_SCANNER_PROFILE", value = "quarantine-all" }'), 'FAIL_CLOSED_SCANNER'],
  [compute.includes('{ name = "ROS_CORS_ALLOWED_ORIGINS", value = join(",", var.cors_allowed_origins) }'), 'CORS_BINDING'],
  [variables.includes('variable "cors_allowed_origins"'), 'CORS_VARIABLE'],
  [variables.includes('origin == lower(origin)') && variables.includes('<= 65535') && variables.includes('!= 443'), 'CORS_RUNTIME_CANONICALITY'],
  [acceptedCorsOrigins.every(canonicalTerraformCorsOrigin), 'CORS_CANONICAL_ACCEPTANCE'],
  [rejectedCorsOrigins.every((origin) => !canonicalTerraformCorsOrigin(origin)), 'CORS_CANONICAL_REJECTION'],
  [variables.includes('>=1.4.0 so ECS task metadata v4 is available'), 'FARGATE_METADATA_VERSION'],
  [tfvars.includes('cors_allowed_origins = []'), 'CORS_SAFE_EXAMPLE']
];

const failures = requirements.filter(([passed]) => !passed).map(([, code]) => code);
assert.deepEqual(failures, [], `staging runtime composition violations:\n${failures.join('\n')}`);
console.log(`ROS staging runtime composition PASS (${requirements.length} fail-closed requirements).`);
