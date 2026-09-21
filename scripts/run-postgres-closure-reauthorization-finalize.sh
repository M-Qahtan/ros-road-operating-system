#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CLOSURE_REAUTHORIZATION_FINALIZE_PROOF_FILE:?closure reauthorization finalize proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_FINALIZE_PROOF_FILE" \
  || -L "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_FINALIZE_PROOF_FILE" \
  || -s "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_FINALIZE_PROOF_FILE" ]]; then
  echo "Closure reauthorization finalize proof target must be a new empty regular file" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At >"$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_FINALIZE_PROOF_FILE" <<'SQL'
\set QUIET 1
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

CREATE TEMP TABLE closure_finalize_baseline AS
SELECT
  md5(to_jsonb(event)::text) AS event_hash,
  (SELECT count(*) FROM audit_logs audit
    WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id) AS audit_count,
  (SELECT count(*) FROM outbox_events outbox
    WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id) AS outbox_count,
  (SELECT md5(to_jsonb(journal)::text)
    FROM road_event_closure_authorization_journal journal
    WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id AND journal.event_version=8) AS historical_journal_hash
FROM road_events event
WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
  AND event.id='10000000-0000-4000-8000-000000000009' AND event.version=10
FOR UPDATE;

DO $$
DECLARE changed integer;
BEGIN
  UPDATE road_events
  SET status='CLOSED', version=11
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000009' AND version=8;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'Historical revision-8 authorization unexpectedly closed the incident';
  END IF;
END;
$$;

DO $$
DECLARE baseline closure_finalize_baseline%ROWTYPE;
DECLARE current_event_hash text;
DECLARE current_audit_count bigint;
DECLARE current_outbox_count bigint;
BEGIN
  SELECT * INTO baseline FROM closure_finalize_baseline;
  IF baseline.event_hash IS NULL THEN
    RAISE EXCEPTION 'Restarted revision-10 closure fixture is missing';
  END IF;
  SELECT md5(to_jsonb(event)::text),
    (SELECT count(*) FROM audit_logs audit
      WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id),
    (SELECT count(*) FROM outbox_events outbox
      WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id)
  INTO current_event_hash, current_audit_count, current_outbox_count
  FROM road_events event
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000009';
  IF current_event_hash<>baseline.event_hash OR current_audit_count<>baseline.audit_count
    OR current_outbox_count<>baseline.outbox_count THEN
    RAISE EXCEPTION 'Historical closure retry changed the durable write-set';
  END IF;
END;
$$;

DO $$
DECLARE changed integer;
BEGIN
  UPDATE road_events event
  SET status='CLOSED', version=11
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000009' AND event.version=10
    AND EXISTS (
      SELECT 1 FROM road_event_closure_authorization_journal journal
      WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
        AND journal.case_id=event.id AND journal.event_version=event.version
        AND journal.authorized_by=event.closure_authorized_by
        AND journal.authorized_at=event.closure_authorized_at
        AND journal.authorization_reason=event.closure_authorization_reason
        AND journal.source_input_version=event.closure_source_input_version
        AND journal.source_snapshot_digest=event.closure_source_snapshot_digest
        AND journal.cognitive_policy_version=event.closure_cognitive_policy_version
        AND journal.cognitive_revision=event.closure_cognitive_revision
        AND journal.cognitive_digest=event.closure_cognitive_digest
    )
    AND COALESCE((
      SELECT cognitive.input_version=event.closure_source_input_version
        AND cognitive.policy_version=event.closure_cognitive_policy_version
        AND cognitive.base_snapshot_digest=event.closure_source_snapshot_digest
        AND cognitive.cognitive_revision=event.closure_cognitive_revision
        AND cognitive.cognitive_digest=event.closure_cognitive_digest
        AND cognitive.cognitive_requires_abstention=false
      FROM ros_eye_cognitive_input_snapshot_bindings cognitive
      WHERE cognitive.tenant_id=event.tenant_id AND cognitive.purpose=event.purpose
        AND cognitive.case_id=event.id
      ORDER BY cognitive.input_version DESC LIMIT 1
    ), false);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'Exact restarted revision-10 authorization did not close once';
  END IF;
END;
$$;

INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id
) VALUES (
  'SUPERVISOR', '20000000-0000-4000-8000-000000000009',
  'road_event.closed', 'RoadEvent', '10000000-0000-4000-8000-000000000009',
  '{"status":"RECOVERY","version":10}'::jsonb,
  '{"status":"CLOSED","version":11}'::jsonb,
  'Exact restarted revision-10 supervisor authorization consumed',
  '30000000-0000-4000-8000-000000000011'
);

INSERT INTO outbox_events (
  aggregate_type, aggregate_id, event_type, payload, correlation_id, tenant_id, purpose
) VALUES (
  'RoadEvent', '10000000-0000-4000-8000-000000000009', 'RoadEventClosed',
  '{"status":"CLOSED","version":11}'::jsonb,
  '40000000-0000-4000-8000-000000000011', 'riyadh-pilot', 'road-safety-response'
);

DO $$
DECLARE changed integer;
BEGIN
  UPDATE road_events
  SET status='CLOSED', version=11
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000009' AND version=10;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'Duplicate revision-10 closure unexpectedly wrote again';
  END IF;
END;
$$;

DO $$
DECLARE baseline closure_finalize_baseline%ROWTYPE;
DECLARE final_status road_event_status;
DECLARE final_version integer;
DECLARE journal_versions integer[];
DECLARE authorization_audit_versions integer[];
DECLARE closed_audit_count bigint;
DECLARE authorization_outbox_count bigint;
DECLARE closed_outbox_count bigint;
DECLARE historical_journal_hash text;
DECLARE current_authorization_count bigint;
BEGIN
  SELECT * INTO baseline FROM closure_finalize_baseline;
  SELECT status, version INTO final_status, final_version FROM road_events
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000009';
  SELECT array_agg(event_version ORDER BY event_version),
    min(md5(to_jsonb(journal)::text)) FILTER (WHERE event_version=8)
  INTO journal_versions, historical_journal_hash
  FROM road_event_closure_authorization_journal journal
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND case_id='10000000-0000-4000-8000-000000000009';
  SELECT array_agg((after_state->>'version')::integer ORDER BY (after_state->>'version')::integer)
  INTO authorization_audit_versions FROM audit_logs
  WHERE resource_type='RoadEvent' AND resource_id='10000000-0000-4000-8000-000000000009'
    AND action='road_event.closure_authorized';
  SELECT count(*) INTO closed_audit_count FROM audit_logs
  WHERE resource_type='RoadEvent' AND resource_id='10000000-0000-4000-8000-000000000009'
    AND action='road_event.closed';
  SELECT count(*) FILTER (WHERE event_type='RoadEventClosureAuthorized'),
    count(*) FILTER (WHERE event_type='RoadEventClosed')
  INTO authorization_outbox_count, closed_outbox_count FROM outbox_events
  WHERE aggregate_type='RoadEvent' AND aggregate_id='10000000-0000-4000-8000-000000000009';
  SELECT count(*) INTO current_authorization_count
  FROM road_events event
  JOIN road_event_closure_authorization_journal journal
    ON journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
    AND journal.case_id=event.id AND journal.event_version=event.version
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000009';
  IF final_status<>'CLOSED' OR final_version<>11 OR journal_versions<>ARRAY[8,10]
    OR authorization_audit_versions<>ARRAY[8,10] OR closed_audit_count<>1
    OR authorization_outbox_count<>1 OR closed_outbox_count<>1
    OR current_authorization_count<>0
    OR historical_journal_hash<>baseline.historical_journal_hash THEN
    RAISE EXCEPTION 'Post-restart exact closure finalization was incomplete or duplicated';
  END IF;
END;
$$;

COMMIT;
\set QUIET 0
SELECT unnest(ARRAY[
  'POST_RESTART_CLOSURE_FINALIZATION', 'VERIFIED',
  'HISTORICAL_AUTHORIZATION', 'REJECTED',
  'EXACT_AUTHORIZATION', 'CONSUMED',
  'DUPLICATE_RETRY', 'REJECTED',
  'AUTHORIZATION_HISTORY', '8,10',
  'FINAL_STATE', 'CLOSED|11'
]);
SQL
