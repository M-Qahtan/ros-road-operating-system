#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE:?cognitive closure recovery proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE" \
  || -L "$ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE" \
  || -s "$ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE" ]]; then
  echo "Cognitive closure recovery proof target must be a new empty regular file" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At >"$ROS_POSTGRES_COGNITIVE_CLOSURE_RECOVERY_PROOF_FILE" <<'SQL'
\set QUIET 1
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $$
BEGIN
  PERFORM 1 FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000007'
  FOR UPDATE;
END;
$$;

CREATE TEMP TABLE cognitive_closure_recovery_baseline AS
SELECT
  md5(to_jsonb(event)::text) AS event_hash,
  md5(concat_ws('|', event.closure_authorized_by::text,
    event.closure_authorized_at::text, event.closure_authorization_reason,
    event.closure_source_input_version::text, event.closure_source_snapshot_digest,
    event.closure_cognitive_policy_version, event.closure_cognitive_revision::text,
    event.closure_cognitive_digest)) AS authorization_hash,
  (SELECT count(*) FROM audit_logs audit
    WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id) AS audit_count,
  (SELECT count(*) FROM outbox_events outbox
    WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id) AS outbox_count
FROM road_events event
WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
  AND event.id='10000000-0000-4000-8000-000000000007';

DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE road_events event
  SET status='CLOSED', version=3
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007' AND event.version=2
    AND EXISTS (
      SELECT 1 FROM ros_eye_cognitive_input_snapshot_bindings cognitive_exact
      WHERE cognitive_exact.tenant_id=event.tenant_id
        AND cognitive_exact.purpose=event.purpose
        AND cognitive_exact.case_id=event.id
        AND cognitive_exact.input_version=event.closure_source_input_version
        AND cognitive_exact.policy_version=event.closure_cognitive_policy_version
        AND cognitive_exact.base_snapshot_digest=event.closure_source_snapshot_digest
        AND cognitive_exact.cognitive_revision=event.closure_cognitive_revision
        AND cognitive_exact.cognitive_digest=event.closure_cognitive_digest
        AND cognitive_exact.cognitive_requires_abstention=false
    )
    AND EXISTS (
      SELECT 1 FROM road_event_closure_authorization_journal authorization_journal
      WHERE authorization_journal.tenant_id=event.tenant_id
        AND authorization_journal.purpose=event.purpose
        AND authorization_journal.case_id=event.id
        AND authorization_journal.event_version=event.version
        AND authorization_journal.authorized_by=event.closure_authorized_by
        AND authorization_journal.authorized_at=event.closure_authorized_at
        AND authorization_journal.authorization_reason=event.closure_authorization_reason
        AND authorization_journal.source_input_version=event.closure_source_input_version
        AND authorization_journal.source_snapshot_digest=event.closure_source_snapshot_digest
        AND authorization_journal.cognitive_policy_version=event.closure_cognitive_policy_version
        AND authorization_journal.cognitive_revision=event.closure_cognitive_revision
        AND authorization_journal.cognitive_digest=event.closure_cognitive_digest
    )
    AND COALESCE((
      SELECT cognitive_latest.input_version=event.closure_source_input_version
        AND cognitive_latest.policy_version=event.closure_cognitive_policy_version
        AND cognitive_latest.base_snapshot_digest=event.closure_source_snapshot_digest
        AND cognitive_latest.cognitive_revision=event.closure_cognitive_revision
        AND cognitive_latest.cognitive_digest=event.closure_cognitive_digest
        AND cognitive_latest.cognitive_requires_abstention=false
      FROM ros_eye_cognitive_input_snapshot_bindings cognitive_latest
      WHERE cognitive_latest.tenant_id=event.tenant_id
        AND cognitive_latest.purpose=event.purpose
        AND cognitive_latest.case_id=event.id
      ORDER BY cognitive_latest.input_version DESC LIMIT 1
    ), false);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'Post-restart cognitive drift permitted closure';
  END IF;
END;
$$;

DO $$
DECLARE
  baseline cognitive_closure_recovery_baseline%ROWTYPE;
  current_event_hash text;
  current_authorization_hash text;
  current_audit_count bigint;
  current_outbox_count bigint;
BEGIN
  SELECT * INTO baseline FROM cognitive_closure_recovery_baseline;
  IF baseline.event_hash IS NULL THEN
    RAISE EXCEPTION 'Post-restart cognitive closure fixture is missing';
  END IF;

  SELECT md5(to_jsonb(event)::text),
    md5(concat_ws('|', event.closure_authorized_by::text,
      event.closure_authorized_at::text, event.closure_authorization_reason,
      event.closure_source_input_version::text, event.closure_source_snapshot_digest,
      event.closure_cognitive_policy_version, event.closure_cognitive_revision::text,
      event.closure_cognitive_digest)),
    (SELECT count(*) FROM audit_logs audit
      WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id),
    (SELECT count(*) FROM outbox_events outbox
      WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id)
  INTO current_event_hash, current_authorization_hash, current_audit_count, current_outbox_count
  FROM road_events event
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007';

  IF current_event_hash <> baseline.event_hash
    OR current_audit_count <> baseline.audit_count
    OR current_outbox_count <> baseline.outbox_count THEN
    RAISE EXCEPTION 'Post-restart cognitive closure retry changed the write-set';
  END IF;
  IF current_authorization_hash <> baseline.authorization_hash THEN
    RAISE EXCEPTION 'Post-restart cognitive closure retry rewrote authorization history';
  END IF;
END;
$$;

COMMIT;
\set QUIET 0
SELECT unnest(ARRAY[
  'COGNITIVE_CLOSURE_RECOVERY', 'RETRY_REJECTED',
  'ROAD_EVENT_AUDIT_OUTBOX', 'UNCHANGED',
  'AUTHORIZATION_HISTORY', 'UNCHANGED'
]);
SQL
