import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runner = readFileSync('scripts/run-postgres-integration.sh', 'utf8');
const localHarness = readFileSync('scripts/run-local-postgres-brain-journey.sh', 'utf8');
const setup = readFileSync('database/tests/0010_ros_brain_journey_setup.sql', 'utf8');
const reconnect = readFileSync('database/tests/0011_ros_brain_journey_reconnect.sql', 'utf8');
const recoveryForward = readFileSync('database/tests/0012_ros_brain_journey_recovery_forward.sql', 'utf8');
const closureRace = readFileSync('scripts/run-postgres-closure-race.sh', 'utf8');
const contactClosureRace = readFileSync('scripts/run-postgres-contact-closure-race.sh', 'utf8');

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

test('local journey uses Docker or Podman container-owned clients and restarts before the recovery assertion', () => {
  assert.match(localHarness, /for candidate_engine in docker podman/);
  assert.match(localHarness, /--volume "\$\(pwd\):\/workspace:ro"/);
  assert.match(localHarness, /"\$ROS_POSTGRES_CONTAINER_ENGINE" exec "\$container_name" pg_isready/);
  assert.match(localHarness, /"\$ROS_POSTGRES_CONTAINER_ENGINE" exec --interactive --workdir \/workspace "\$container_name" psql/);
  assert.match(localHarness, /export -f pg_isready psql/);
  assert.match(localHarness, /ROS_POSTGRES_CONTAINER_ENGINE="\$container_engine"/);
  assert.match(localHarness, /ROS_POSTGRES_RESTART_BEFORE_TEST="0011_ros_brain_journey_reconnect\.sql"/);
  assert.match(runner, /"\$ROS_POSTGRES_CONTAINER_ENGINE" restart -- "\$ROS_POSTGRES_RESTART_CONTAINER"/);
  assert.ok(runner.indexOf('restart -- "$ROS_POSTGRES_RESTART_CONTAINER"') < runner.indexOf('echo "Running ${test_file}"'));
  assert.match(runner, /wait_for_postgres "after restart"/);
});

test('exported database client functions use only the exported container engine binding', () => {
  const exportedFunctions = localHarness.slice(
    localHarness.indexOf('pg_isready()'),
    localHarness.indexOf('export -f pg_isready psql'),
  );
  assert.match(exportedFunctions, /\$ROS_POSTGRES_CONTAINER_ENGINE/);
  assert.doesNotMatch(exportedFunctions, /"\$container_engine"/);
  assert.ok(
    localHarness.indexOf('export ROS_POSTGRES_CONTAINER_ENGINE="$container_engine"') <
      localHarness.indexOf('bash scripts/run-postgres-integration.sh'),
  );
});

test('restart checkpoint is mandatory and post-restart exact retry remains singular', () => {
  assert.match(runner, /restart_performed=false/);
  assert.match(runner, /restart checkpoint does not exist/);
  assert.match(runner, /restart checkpoint was not reached/);
  assert.match(reconnect, /ON CONFLICT \(tenant_id, purpose, case_id, input_version\) DO NOTHING/);
  assert.match(reconnect, /post-restart exact retry duplicated the recommendation/);
});

test('post-restart read verifies all five authoritative source states and the exact snapshot', () => {
  assert.match(reconnect, /RoadEvent case\/severity receipts were not durable after restart/);
  assert.match(reconnect, /authoritative Contact absence was not durable after restart/);
  assert.match(reconnect, /JOIN road_events event/);
  assert.match(reconnect, /Evidence receipt was not durable after restart/);
  assert.match(reconnect, /Human-Safety Indicator history was not durable after restart/);
  assert.match(reconnect, /snapshot\.case_digest = repeat\('a', 64\)/);
  assert.match(reconnect, /snapshot\.severity_digest = repeat\('b', 64\)/);
  assert.match(reconnect, /snapshot\.contact_revision IS NULL/);
  assert.match(reconnect, /snapshot\.evidence_digest = repeat\('d', 64\)/);
  assert.match(reconnect, /snapshot\.indicator_digest = repeat\('e', 64\)/);
  assert.match(reconnect, /journal\.source_snapshot_digest = snapshot\.snapshot_digest/);
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
  assert.match(localHarness, /scripts\/run-postgres-closure-race\.sh/);
  assert.match(localHarness, /"\$container_engine" inspect --format '\{\{\.Image\}\}'/);
  assert.match(localHarness, /containerEngine: process\.env\.ROS_RECEIPT_CONTAINER_ENGINE/);
  assert.match(localHarness, /SHOW server_version/);
  assert.match(localHarness, /SELECT postgis_lib_version\(\)/);
  assert.match(localHarness, /receipt provenance is incomplete/);
  assert.match(localHarness, /databaseSystemIdentifier/);
  assert.match(localHarness, /postmasterStartedAtBeforeRestart/);
  assert.match(localHarness, /postmasterStartedAtAfterRestart/);
  assert.match(localHarness, /restartVerified: true/);
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v7/);
  assert.match(localHarness, /externalArchiveReceipt: null/);
  assert.ok(
    localHarness.indexOf('bash scripts/run-postgres-integration.sh') <
      localHarness.indexOf('ROS_POSTGRES_BRAIN_JOURNEY_RECEIPT='),
  );
});

test('closure race overlaps row-lock participants and accepts exactly one safe winner', () => {
  assert.match(closureRace, /BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(closureRace, /FOR UPDATE/);
  assert.match(closureRace, /pg_advisory_lock\(20260909, 1\)/);
  assert.match(closureRace, /pg_sleep\(10\)/);
  assert.match(closureRace, /pg_stat_activity/);
  assert.match(closureRace, /wait_event_type='Lock'/);
  assert.match(closureRace, /was not observed waiting on the source row lock/);
  assert.match(closureRace, /SOURCE_SNAPSHOT_CHANGED/);
  assert.match(closureRace, /SERIALIZATION_FAILURE/);
  assert.match(closureRace, /RECOVERY\|2\|3/);
  assert.match(closureRace, /exactly one safe winner/);
  assert.match(runner, /bash scripts\/run-postgres-closure-race\.sh/);
});

test('reverse race lets closure win and rejects the waiting source append', () => {
  assert.match(closureRace, /pg_advisory_lock\(20260909, 2\)/);
  assert.match(closureRace, /ros_brain_source_race_participant/);
  assert.match(closureRace, /Source participant was not observed waiting on the closure row lock/);
  assert.match(closureRace, /INCIDENT_CLOSED/);
  assert.match(closureRace, /Structured indicators cannot be appended after incident closure/);
  assert.match(closureRace, /CLOSED\|3\|1/);
  assert.match(closureRace, /one safe winner in each ordering/);
});

test('v6 receipt consumes both exact durable closure-race dispositions', () => {
  assert.match(localHarness, /closure_race_proof_file="\$\(mktemp\)"/);
  assert.match(localHarness, /ROS_POSTGRES_CLOSURE_RACE_PROOF_FILE="\$closure_race_proof_file"/);
  assert.match(localHarness, /closure_race_proof\[0\].*SOURCE_UPDATE/);
  assert.match(localHarness, /closure_race_proof\[3\].*SOURCE_SNAPSHOT_CHANGED/);
  assert.match(localHarness, /closure_race_proof\[4\].*CLOSURE/);
  assert.match(localHarness, /closure_race_proof\[7\].*INCIDENT_CLOSED/);
  assert.match(localHarness, /closureRaceVerified: true/);
  assert.match(localHarness, /closureRaceWinner/);
  assert.match(localHarness, /closureRaceLoserResult/);
  assert.match(localHarness, /reverseRaceWinner/);
  assert.match(localHarness, /reverseRaceLoserResult/);
});

test('contact command and closure race in both row-lock orderings', () => {
  assert.match(contactClosureRace, /ros_brain_contact_closure_waiter/);
  assert.match(contactClosureRace, /ros_brain_contact_command_waiter/);
  assert.match(contactClosureRace, /SOURCE_SNAPSHOT_CHANGED/);
  assert.match(contactClosureRace, /INCIDENT_CLOSED/);
  assert.match(contactClosureRace, /RECOVERY\|2\|2\|2\|1\|1\|0/);
  assert.match(contactClosureRace, /CLOSED\|3\|1\|1\|0\|0\|1/);
  assert.match(runner, /bash scripts\/run-postgres-contact-closure-race\.sh/);
});

test('contact race treats session, revision, audit and pending outbox as one command write-set', () => {
  assert.match(contactClosureRace, /INSERT INTO ros_eye_contact_outbox/);
  assert.match(contactClosureRace, /UPDATE ros_eye_contact_outbox SET cancelled_at=/);
  assert.match(contactClosureRace, /INSERT INTO ros_eye_contact_audit/);
  assert.match(contactClosureRace, /contact-race-command-wins-audit/);
  assert.match(contactClosureRace, /contact-race-closure-wins-audit/);
});

test('v7 receipt consumes both exact contact-command race dispositions', () => {
  assert.match(localHarness, /contact_closure_race_proof_file="\$\(mktemp\)"/);
  assert.match(localHarness, /contact_closure_race_proof\[0\].*CONTACT_COMMAND/);
  assert.match(localHarness, /contact_closure_race_proof\[3\].*SOURCE_SNAPSHOT_CHANGED/);
  assert.match(localHarness, /contact_closure_race_proof\[4\].*CLOSURE/);
  assert.match(localHarness, /contact_closure_race_proof\[7\].*INCIDENT_CLOSED/);
  assert.match(localHarness, /contactClosureRaceVerified: true/);
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v7/);
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

test('post-restart recovery advances to a new current recommendation without rewriting history', () => {
  assert.match(recoveryForward, /input_version, policy_version/);
  assert.match(recoveryForward, /2, 'ros-eye\.input-snapshot\.v1'/);
  assert.match(recoveryForward, /indicator_revision = 1/);
  assert.match(recoveryForward, /indicator_revision = 2/);
  assert.match(recoveryForward, /historical recommendation current/);
  assert.match(recoveryForward, /one current governed recommendation/);
  assert.match(recoveryForward, /authority = 'RECOMMENDATION_ONLY'/);
  assert.match(recoveryForward, /mode = 'SHADOW_ONLY'/);
  assert.match(recoveryForward, /activation_authorized = false/);
  assert.match(recoveryForward, /human_review_status = 'PENDING'/);
  assert.ok('0011_ros_brain_journey_reconnect.sql' < '0012_ros_brain_journey_recovery_forward.sql');
});
