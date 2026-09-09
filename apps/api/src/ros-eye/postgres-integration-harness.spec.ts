import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runner = readFileSync('scripts/run-postgres-integration.sh', 'utf8');
const localHarness = readFileSync('scripts/run-local-postgres-brain-journey.sh', 'utf8');
const setup = readFileSync('database/tests/0010_ros_brain_journey_setup.sql', 'utf8');
const reconnect = readFileSync('database/tests/0011_ros_brain_journey_reconnect.sql', 'utf8');

test('PostgreSQL integration runner fails explicitly before claiming an unexecuted test', () => {
  assert.match(runner, /command -v "\$required_command"/);
  assert.match(runner, /no integration test was executed/);
  assert.match(runner, /for migration in database\/migrations\/\*\.sql/);
  assert.match(runner, /for test_file in database\/tests\/\*\.sql/);
  assert.ok(runner.indexOf('Running ${test_file}') < runner.indexOf('integration checks passed'));
  assert.match(localHarness, /postgis\/postgis:16-3\.4/);
  assert.match(localHarness, /trap cleanup EXIT/);
  assert.doesNotMatch(localHarness, /--publish|--network host/);
  assert.match(localHarness, /bash scripts\/run-postgres-integration\.sh/);
});

test('local journey uses container-owned clients and restarts before the recovery assertion', () => {
  assert.match(localHarness, /command -v docker/);
  assert.match(localHarness, /--volume "\$\(pwd\):\/workspace:ro"/);
  assert.match(localHarness, /docker exec "\$container_name" pg_isready/);
  assert.match(localHarness, /docker exec --interactive --workdir \/workspace "\$container_name" psql/);
  assert.match(localHarness, /export -f pg_isready psql/);
  assert.match(localHarness, /ROS_POSTGRES_RESTART_BEFORE_TEST="0011_ros_brain_journey_reconnect\.sql"/);
  assert.match(runner, /docker restart -- "\$ROS_POSTGRES_RESTART_CONTAINER"/);
  assert.ok(runner.indexOf('docker restart --') < runner.indexOf('echo "Running ${test_file}"'));
  assert.match(runner, /wait_for_postgres "after restart"/);
});

test('restart checkpoint is mandatory and post-restart exact retry remains singular', () => {
  assert.match(runner, /restart_performed=false/);
  assert.match(runner, /restart checkpoint does not exist/);
  assert.match(runner, /restart checkpoint was not reached/);
  assert.match(reconnect, /ON CONFLICT \(tenant_id, purpose, case_id, input_version\) DO NOTHING/);
  assert.match(reconnect, /post-restart exact retry duplicated the recommendation/);
});

test('restart proof preserves the cluster identity and replaces the postmaster', () => {
  assert.match(runner, /SELECT system_identifier::text \|\| '\|' \|\| pg_postmaster_start_time\(\)::text/);
  assert.match(runner, /before_system_identifier/);
  assert.match(runner, /before_postmaster_started_at/);
  assert.match(runner, /did not preserve the cluster and replace the postmaster/);
  assert.ok(runner.indexOf('restart_identity_after=') < runner.indexOf('restart_performed=true'));
  assert.match(runner, /restart proof target must be a new empty regular file/);
  assert.ok(runner.indexOf('restart checkpoint was not reached') < runner.indexOf("printf '%s\\n'"));
});

test('live journey receipt is bound to a clean candidate and emitted only after success', () => {
  assert.match(localHarness, /git status --porcelain --untracked-files=normal/);
  assert.match(localHarness, /journey_manifest_sha256/);
  assert.match(localHarness, /docker inspect --format '\{\{\.Image\}\}'/);
  assert.match(localHarness, /SHOW server_version/);
  assert.match(localHarness, /SELECT postgis_lib_version\(\)/);
  assert.match(localHarness, /receipt provenance is incomplete/);
  assert.match(localHarness, /databaseSystemIdentifier/);
  assert.match(localHarness, /postmasterStartedAtBeforeRestart/);
  assert.match(localHarness, /postmasterStartedAtAfterRestart/);
  assert.match(localHarness, /restartVerified: true/);
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v3/);
  assert.match(localHarness, /externalArchiveReceipt: null/);
  assert.ok(
    localHarness.indexOf('bash scripts/run-postgres-integration.sh') <
      localHarness.indexOf('ROS_POSTGRES_BRAIN_JOURNEY_RECEIPT='),
  );
});

test('live receipt consumes the exact validated before-and-after restart proof', () => {
  assert.match(localHarness, /restart_proof_file="\$\(mktemp\)"/);
  assert.match(localHarness, /ROS_POSTGRES_RESTART_PROOF_FILE="\$restart_proof_file"/);
  assert.match(localHarness, /mapfile -t restart_proof/);
  assert.match(localHarness, /system_identifier_before_restart/);
  assert.match(localHarness, /system_identifier_after_restart/);
  assert.match(localHarness, /postmaster_started_at_before_restart/);
  assert.match(localHarness, /postmaster_started_at_after_restart/);
  assert.match(localHarness, /system_identifier_after_restart" != "\$database_system_identifier/);
  assert.match(localHarness, /postmaster_started_at_after_restart" != "\$postmaster_started_at/);
});

test('ordered SQL journey covers current read, source invalidation, rollback and a new client connection', () => {
  assert.match(setup, /ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(setup, /FOR (?:SHARE|UPDATE)/);
  assert.match(setup, /indicator correction did not invalidate the prior binding/);
  assert.match(setup, /ROLLBACK/);
  assert.match(setup, /rolled-back indicator revision remained visible/);
  assert.match(setup, /human_review_status = 'PENDING'/);
  assert.match(setup, /activation_authorized = false/);
  assert.match(reconnect, /durable across client reconnect/);
  assert.ok('0010_ros_brain_journey_setup.sql' < '0011_ros_brain_journey_reconnect.sql');
});
