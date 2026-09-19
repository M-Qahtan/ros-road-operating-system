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
const cognitiveClosureDrift = readFileSync('scripts/run-postgres-cognitive-closure-drift.sh', 'utf8');

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
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v23/);
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

test('fault after the full contact command write-set rolls the transaction back exactly', () => {
  assert.match(contactClosureRace, /CONTACT_COMMAND_FAULT_INJECTED/);
  assert.match(contactClosureRace, /RECOVERY\|2\|1\|1\|0\|0\|1/);
  assert.match(contactClosureRace, /partial write-set/);
  assert.match(contactClosureRace, /ATOMIC_ROLLBACK VERIFIED/);
});

test('forward retry after rollback commits once and duplicate retry is rejected', () => {
  assert.match(contactClosureRace, /Forward retry did not commit one complete write-set/);
  assert.match(contactClosureRace, /CONTACT_VERSION_CONFLICT/);
  assert.match(contactClosureRace, /Duplicate retry changed the committed recovery state/);
  assert.match(contactClosureRace, /FORWARD_RETRY COMMITTED/);
  assert.match(contactClosureRace, /DUPLICATE_RETRY REJECTED/);
});

test('v23 receipt consumes contact races, rollback and exact forward retry proof', () => {
  assert.match(localHarness, /contact_closure_race_proof_file="\$\(mktemp\)"/);
  assert.match(localHarness, /contact_closure_race_proof\[0\].*CONTACT_COMMAND/);
  assert.match(localHarness, /contact_closure_race_proof\[3\].*SOURCE_SNAPSHOT_CHANGED/);
  assert.match(localHarness, /contact_closure_race_proof\[4\].*CLOSURE/);
  assert.match(localHarness, /contact_closure_race_proof\[7\].*INCIDENT_CLOSED/);
  assert.match(localHarness, /contact_closure_race_proof\[8\].*ATOMIC_ROLLBACK/);
  assert.match(localHarness, /contact_closure_race_proof\[9\].*VERIFIED/);
  assert.match(localHarness, /contact_closure_race_proof\[10\].*FORWARD_RETRY/);
  assert.match(localHarness, /contact_closure_race_proof\[13\].*REJECTED/);
  assert.match(localHarness, /contactClosureRaceVerified: true/);
  assert.match(localHarness, /contactAtomicRollback/);
  assert.match(localHarness, /contactForwardRetry/);
  assert.match(localHarness, /contactDuplicateRetry/);
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v23/);
});

test('v23 rejects cognitive closure drift without changing the durable write-set or authorization history', () => {
  assert.match(cognitiveClosureDrift, /BEGIN;/);
  assert.match(cognitiveClosureDrift, /ORDER BY cognitive_latest\.input_version DESC LIMIT 1/);
  assert.match(cognitiveClosureDrift, /COGNITIVE_CLOSURE_SNAPSHOT_CHANGED/);
  assert.match(cognitiveClosureDrift, /Cognitive closure rejection changed the RoadEvent/);
  assert.match(cognitiveClosureDrift, /Cognitive closure rejection wrote an audit row/);
  assert.match(cognitiveClosureDrift, /Cognitive closure rejection wrote an outbox row/);
  assert.match(cognitiveClosureDrift, /Cognitive closure rejection rewrote authorization history/);
  assert.match(localHarness, /ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE/);
  assert.match(localHarness, /cognitiveClosureDrift/);
  assert.match(localHarness, /cognitiveClosureWriteSet/);
  assert.match(localHarness, /cognitiveClosureAuthorizationHistory/);
  assert.match(localHarness, /ros-brain\.local-postgres-journey-receipt\.v23/);
});

test('forward contact recovery survives a second PostgreSQL restart exactly', () => {
  assert.match(localHarness, /contact_recovery_identity_before_restart/);
  assert.match(localHarness, /contact_recovery_identity_after_restart/);
  assert.match(localHarness, /restart -- "\$container_name"/);
  assert.match(localHarness, /wait_for_postgres "after contact recovery restart"/);
  assert.match(localHarness, /RECOVERY\|2\|2\|2\|1\|1\|0/);
  assert.match(localHarness, /Contact recovery did not survive a PostgreSQL restart/);
  assert.match(localHarness, /contactRecoveryRestartVerified: true/);
  assert.match(localHarness, /contactRecoveryState/);
  assert.match(localHarness, /contactRecoveryPostmasterStartedAtBeforeRestart/);
  assert.match(localHarness, /contactRecoveryPostmasterStartedAtAfterRestart/);
  assert.ok(
    localHarness.indexOf('bash scripts/run-postgres-integration.sh') <
      localHarness.indexOf('wait_for_postgres "after contact recovery restart"'),
  );
});

test('duplicate contact retry remains rejected without writes after restart', () => {
  assert.match(localHarness, /post_restart_duplicate_log="\$\(mktemp\)"/);
  assert.match(localHarness, /POST_RESTART_CONTACT_VERSION_CONFLICT/);
  assert.match(localHarness, /Post-restart duplicate contact retry bypassed its durable version boundary/);
  assert.match(localHarness, /post_restart_duplicate_state" != "\$contact_recovery_state/);
  assert.match(localHarness, /Post-restart duplicate contact retry changed durable state/);
  assert.match(localHarness, /contactPostRestartDuplicateRetry: "REJECTED"/);
  assert.match(localHarness, /contactPostRestartDuplicateState/);
});

test('wrong-purpose contact retry is rejected before mutation after restart', () => {
  assert.match(localHarness, /post_restart_wrong_purpose_log="\$\(mktemp\)"/);
  assert.match(localHarness, /purpose='traffic-coordination'/);
  assert.match(localHarness, /IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_PARENT_SCOPE_MISMATCH'/);
  assert.match(localHarness, /Wrong-purpose contact retry was not rejected at the durable parent scope boundary/);
  assert.match(localHarness, /post_restart_wrong_purpose_state" != "\$contact_recovery_state/);
  assert.match(localHarness, /contactWrongPurposeRetry: "REJECTED"/);
  assert.match(localHarness, /contactWrongPurposeState/);
});

test('wrong-tenant contact retry is rejected before mutation after restart', () => {
  assert.match(localHarness, /post_restart_wrong_tenant_log="\$\(mktemp\)"/);
  assert.match(localHarness, /tenant_id='foreign-tenant' AND purpose='road-safety-response'/);
  assert.match(localHarness, /IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_TENANT_SCOPE_MISMATCH'/);
  assert.match(localHarness, /Wrong-tenant contact retry was not rejected at the durable parent scope boundary/);
  assert.match(localHarness, /post_restart_wrong_tenant_state" != "\$contact_recovery_state/);
  assert.match(localHarness, /contactWrongTenantRetry: "REJECTED"/);
  assert.match(localHarness, /contactWrongTenantState/);
});

test('wrong-case contact retry is rejected before mutation after restart', () => {
  assert.match(localHarness, /post_restart_wrong_case_log="\$\(mktemp\)"/);
  assert.match(localHarness, /id='10000000-0000-4000-8000-000000000006' FOR UPDATE/);
  assert.match(localHarness, /IF NOT FOUND THEN RAISE EXCEPTION 'POST_RESTART_CASE_SCOPE_MISMATCH'/);
  assert.match(localHarness, /Wrong-case contact retry was not rejected at the durable parent scope boundary/);
  assert.match(localHarness, /post_restart_wrong_case_state" != "\$contact_recovery_state/);
  assert.match(localHarness, /contactWrongCaseRetry: "REJECTED"/);
  assert.match(localHarness, /contactWrongCaseState/);
});

test('stale parent version rejects contact retry without writes after restart', () => {
  assert.match(localHarness, /post_restart_stale_parent_log="\$\(mktemp\)"/);
  assert.match(localHarness, /IF parent_version<>1 THEN RAISE EXCEPTION 'POST_RESTART_PARENT_VERSION_CONFLICT'/);
  assert.match(localHarness, /Stale-parent contact retry was not rejected at the durable RoadEvent version boundary/);
  assert.match(localHarness, /post_restart_stale_parent_state" != "\$contact_recovery_state/);
  assert.match(localHarness, /contactStaleParentRetry: "REJECTED"/);
  assert.match(localHarness, /contactStaleParentState/);
});

test('closed parent remains terminal for contact commands after restart', () => {
  assert.match(localHarness, /post_restart_closed_parent_log="\$\(mktemp\)"/);
  assert.match(localHarness, /id='10000000-0000-4000-8000-000000000004' FOR UPDATE/);
  assert.match(localHarness, /IF parent_status='CLOSED' THEN RAISE EXCEPTION 'POST_RESTART_INCIDENT_CLOSED'/);
  assert.match(localHarness, /Closed-parent contact retry was not rejected after PostgreSQL restart/);
  assert.match(localHarness, /post_restart_closed_parent_state" != 'CLOSED\|3\|1\|1\|0\|0\|1'/);
  assert.match(localHarness, /contactClosedParentRetry: "REJECTED"/);
  assert.match(localHarness, /contactClosedParentState/);
});

test('closed parent cannot claim or reserve pending Contact delivery after restart', () => {
  assert.match(localHarness, /closed_parent_outbox_claim_result/);
  assert.match(localHarness, /parent\.status <> 'CLOSED'/);
  assert.match(localHarness, /NOT_CLAIMED/);
  assert.match(localHarness, /closed_parent_outbox_reservation_result/);
  assert.match(localHarness, /NOT_RESERVED\|PROVIDER_NOT_ENTERED/);
  assert.match(localHarness, /closed_parent_outbox_state" != '1\|1\|1'/);
  assert.match(localHarness, /contactClosedParentOutboxClaim: "NOT_CLAIMED"/);
  assert.match(localHarness, /contactClosedParentDeliveryReservation: "NOT_RESERVED"/);
  assert.match(localHarness, /contactClosedParentProviderCallback: "NOT_ENTERED"/);
  assert.match(localHarness, /contactClosedParentOutboxState/);
});

test('closed parent rejects delivery and retry finalization after provider return', () => {
  assert.match(localHarness, /closed_parent_outbox_finalization_result/);
  assert.match(localHarness, /delivery_token='closed-parent-finalization-token'/);
  assert.match(localHarness, /SET delivered_at=clock_timestamp\(\)/);
  assert.match(localHarness, /SET attempt_count=message\.attempt_count \+ 1/);
  assert.match(localHarness, /DELIVERY_NOT_RECORDED\|RETRY_NOT_RECORDED\|PARENT_CLOSED\|RESERVATION_UNCHANGED/);
  assert.match(localHarness, /closed_parent_outbox_state_after_finalization" != '1\|1\|1'/);
  assert.match(localHarness, /contactClosedParentDeliveredFinalization: "NOT_RECORDED"/);
  assert.match(localHarness, /contactClosedParentRetryFinalization: "NOT_RECORDED"/);
  assert.match(localHarness, /contactClosedParentReservationAfterFinalization: "UNCHANGED"/);
  assert.match(localHarness, /contactClosedParentOutboxStateAfterFinalization/);
});

test('provider-reported success with closed-parent zero writes binds human review disposition', () => {
  assert.match(localHarness, /closed_parent_provider_result='SENT'/);
  assert.match(localHarness, /closed_parent_provider_disposition='CONFLICT'/);
  assert.match(localHarness, /closed_parent_provider_disposition='HUMAN_REVIEW'/);
  assert.match(localHarness, /Durably audited ambiguous provider success did not escalate to human review/);
  assert.match(localHarness, /contactClosedParentProviderResult/);
  assert.match(localHarness, /contactClosedParentProviderDisposition/);
});

test('ambiguous provider success is append-only, idempotent and token-free before human review', () => {
  assert.match(localHarness, /record_closed_parent_ambiguity\(\)/);
  assert.match(localHarness, /DELIVERY_RESULT_AMBIGUOUS/);
  assert.match(localHarness, /delivery-result-ambiguous-pending-contact-action/);
  assert.match(localHarness, /provider_sent_after_delivery_fence/);
  assert.match(localHarness, /ON CONFLICT DO NOTHING/);
  assert.match(localHarness, /closed_parent_ambiguity_audit_replay/);
  assert.match(localHarness, /1\|1\|TOKEN_EXCLUDED/);
  assert.match(localHarness, /contactAmbiguityAuditFirst/);
  assert.match(localHarness, /contactAmbiguityAuditReplay/);
  assert.match(localHarness, /contactAmbiguityAuditState/);
  assert.ok(
    localHarness.indexOf('closed_parent_ambiguity_audit_first') <
      localHarness.indexOf("closed_parent_provider_disposition='HUMAN_REVIEW'"),
  );
});

test('restarted worker recovers durable ambiguity without provider entry or outbox mutation', () => {
  assert.match(localHarness, /closed_parent_ambiguity_recovery_result/);
  assert.match(localHarness, /HUMAN_REVIEW\|PROVIDER_NOT_ENTERED/);
  assert.match(localHarness, /audit\.event_id='delivery-result-ambiguous-' \|\| message\.message_id/);
  assert.match(localHarness, /audit\.event_type='DELIVERY_RESULT_AMBIGUOUS'/);
  assert.match(localHarness, /closed_parent_outbox_state_after_recovery/);
  assert.match(localHarness, /md5\(to_jsonb\(message\)::text\)/);
  assert.match(localHarness, /closed_parent_outbox_hash_before_recovery/);
  assert.match(localHarness, /closed_parent_outbox_hash_after_recovery/);
  assert.match(localHarness, /Ambiguity recovery mutated Contact outbox state/);
  assert.match(localHarness, /contactAmbiguityRecovery/);
  assert.match(localHarness, /contactAmbiguityRecoveryOutboxState/);
  assert.match(localHarness, /contactAmbiguityRecoveryOutboxHashBefore/);
  assert.match(localHarness, /contactAmbiguityRecoveryOutboxHashAfter/);
});

test('closed-parent ambiguity remains operator-visible without mutating Contact state', () => {
  assert.match(localHarness, /closed_parent_human_safety_state/);
  assert.match(localHarness, /HUMAN_REVIEW\|PARENT_CLOSED/);
  assert.match(localHarness, /parent\.purpose='TRAFFIC_COORDINATION'/);
  assert.match(localHarness, /delivery-result-ambiguous-pending-contact-action/);
  assert.match(localHarness, /Durable Contact ambiguity was hidden by the closed parent state/);
  assert.match(localHarness, /closed_parent_outbox_hash_after_human_safety_read/);
  assert.match(localHarness, /Human Safety ambiguity visibility mutated Contact outbox state/);
  assert.match(localHarness, /contactAmbiguityHumanSafetyState/);
  assert.match(localHarness, /contactAmbiguityHumanSafetyOutboxHash/);
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
  assert.match(
    localHarness,
    /postmaster_started_at_after_restart" != "\$contact_recovery_postmaster_started_at_before_restart/,
  );
  assert.match(
    localHarness,
    /contact_recovery_postmaster_started_at_after_restart" != "\$postmaster_started_at/,
  );
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
