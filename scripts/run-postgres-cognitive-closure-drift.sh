#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE:?cognitive closure proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE" \
  || -L "$ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE" \
  || -s "$ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE" ]]; then
  echo "Cognitive closure proof target must be a new empty regular file" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At >"$ROS_POSTGRES_COGNITIVE_CLOSURE_PROOF_FILE" <<'SQL'
\set QUIET 1
BEGIN;

INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '10000000-0000-4000-8000-000000000007', 'riyadh-pilot', 'road-safety-response',
  'RECOVERY', 'S3', 78, 0.930, ARRAY['cognitive_closure_drift_proof'], true,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-09-19T20:00:00Z', 2
);

INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
   'CASE', 1, repeat('a', 64), '2026-09-19T20:00:00Z'),
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
   'CASE', 2, repeat('c', 64), '2026-09-19T20:01:00Z'),
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
   'SEVERITY', 1, repeat('b', 64), '2026-09-19T20:00:00Z');

INSERT INTO evidence_revision_ledger (
  tenant_id, purpose, case_id, revision, digest, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
  1, repeat('d', 64), '2026-09-19T20:00:00Z'
);

INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007', 1,
  '[{"kind":"DEVICE_AIRBAG","disposition":"PRESENT","confidence":0.93}]'::jsonb,
  repeat('e', 64), '20000000-0000-4000-8000-000000000007', 'SUPERVISOR',
  '30000000-0000-4000-8000-000000000007', '2026-09-19T20:00:00Z'
);

INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
   1, 'ros-eye.input-snapshot.v1', '2026-09-19T20:00:10Z',
   1, repeat('a', 64), 1, repeat('b', 64), NULL, NULL,
   1, repeat('d', 64), 1, repeat('e', 64), repeat('1', 64));

INSERT INTO ros_eye_cognitive_input_snapshot_bindings (
  tenant_id, purpose, case_id, input_version, policy_version,
  base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
  cognitive_revision, cognitive_digest, cognitive_state_time,
  cognitive_valid_until, cognitive_requires_abstention
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
   1, 'ros-eye.input-snapshot.v2', repeat('1', 64), '2026-09-19T20:00:10Z',
   'ros-eye.cognitive-input-binding.v1', 'SOURCE_LEDGER', 1, repeat('6', 64),
   '2026-09-19T20:00:05Z', '2026-09-19T20:05:00Z', false);

UPDATE road_events
SET closure_authorized_by='20000000-0000-4000-8000-000000000007',
    closure_authorized_at='2026-09-19T20:00:20Z',
    closure_authorization_reason='Supervisor reviewed exact cognitive source receipt',
    closure_source_input_version=1,
    closure_source_snapshot_digest=repeat('1', 64),
    closure_cognitive_policy_version='ros-eye.input-snapshot.v2',
    closure_cognitive_revision=1,
    closure_cognitive_digest=repeat('6', 64)
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000007';

-- The authorization above remains immutable history. These append-only rows model
-- a later owner-ledger state that must invalidate its use without rewriting it.
INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
  2, 'ros-eye.input-snapshot.v1', '2026-09-19T20:01:10Z',
  2, repeat('c', 64), 1, repeat('b', 64), NULL, NULL,
  1, repeat('d', 64), 1, repeat('e', 64), repeat('2', 64)
);

INSERT INTO ros_eye_cognitive_input_snapshot_bindings (
  tenant_id, purpose, case_id, input_version, policy_version,
  base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
  cognitive_revision, cognitive_digest, cognitive_state_time,
  cognitive_valid_until, cognitive_requires_abstention
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000007',
  2, 'ros-eye.input-snapshot.v2', repeat('2', 64), '2026-09-19T20:01:10Z',
  'ros-eye.cognitive-input-binding.v1', 'SOURCE_LEDGER', 2, repeat('7', 64),
  '2026-09-19T20:01:05Z', '2026-09-19T20:06:00Z', false
);

CREATE TEMP TABLE cognitive_closure_baseline AS
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

CREATE TEMP TABLE cognitive_closure_result (rejected boolean NOT NULL);

DO $$
DECLARE
  closure_snapshot_current boolean;
BEGIN
  BEGIN
    SELECT (
      EXISTS (
        SELECT 1 FROM road_event_revision_ledger original_case
        WHERE original_case.tenant_id=s.tenant_id AND original_case.purpose=s.purpose
          AND original_case.case_id=s.case_id AND original_case.component='CASE'
          AND original_case.revision=s.case_revision AND original_case.digest=s.case_digest
      )
      AND COALESCE((
        SELECT current_case.revision=s.case_revision + 1
          AND current_case.digest=repeat('c', 64)
        FROM road_event_revision_ledger current_case
        WHERE current_case.tenant_id=s.tenant_id AND current_case.purpose=s.purpose
          AND current_case.case_id=s.case_id AND current_case.component='CASE'
        ORDER BY current_case.revision DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT current_severity.revision=s.severity_revision
          AND current_severity.digest=s.severity_digest
        FROM road_event_revision_ledger current_severity
        WHERE current_severity.tenant_id=s.tenant_id AND current_severity.purpose=s.purpose
          AND current_severity.case_id=s.case_id AND current_severity.component='SEVERITY'
        ORDER BY current_severity.revision DESC LIMIT 1
      ), false)
      AND s.contact_revision IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ros_eye_contact_revision_ledger contact
        WHERE contact.tenant_id=s.tenant_id AND contact.purpose=s.purpose
          AND contact.case_id=s.case_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM ros_eye_contact_sessions session
        WHERE session.tenant_id=s.tenant_id AND session.case_id=s.case_id::text
      )
      AND COALESCE((
        SELECT evidence.revision=s.evidence_revision AND evidence.digest=s.evidence_digest
        FROM evidence_revision_ledger evidence
        WHERE evidence.tenant_id=s.tenant_id AND evidence.purpose=s.purpose
          AND evidence.case_id=s.case_id ORDER BY evidence.revision DESC LIMIT 1
      ), false)
      AND COALESCE((
        SELECT indicator.revision=s.indicator_revision AND indicator.digest=s.indicator_digest
        FROM human_safety_indicator_revision_ledger indicator
        WHERE indicator.tenant_id=s.tenant_id AND indicator.purpose=s.purpose
          AND indicator.case_id=s.case_id ORDER BY indicator.revision DESC LIMIT 1
      ), false)
      AND EXISTS (
        SELECT 1 FROM ros_eye_cognitive_input_snapshot_bindings cognitive_exact
        WHERE cognitive_exact.tenant_id=s.tenant_id AND cognitive_exact.purpose=s.purpose
          AND cognitive_exact.case_id=s.case_id AND cognitive_exact.input_version=s.input_version
          AND cognitive_exact.policy_version='ros-eye.input-snapshot.v2'
          AND cognitive_exact.base_snapshot_digest=s.snapshot_digest
          AND cognitive_exact.cognitive_revision=1
          AND cognitive_exact.cognitive_digest=repeat('6', 64)
          AND cognitive_exact.cognitive_requires_abstention=false
      )
      AND COALESCE((
        SELECT cognitive_latest.cognitive_revision=1
          AND cognitive_latest.cognitive_digest=repeat('6', 64)
          AND cognitive_latest.cognitive_requires_abstention=false
        FROM ros_eye_cognitive_input_snapshot_bindings cognitive_latest
        WHERE cognitive_latest.tenant_id=s.tenant_id AND cognitive_latest.purpose=s.purpose
          AND cognitive_latest.case_id=s.case_id
        ORDER BY cognitive_latest.input_version DESC LIMIT 1
      ), false)
    ) INTO closure_snapshot_current
    FROM ros_eye_safety_fusion_input_snapshots s
    WHERE s.tenant_id='riyadh-pilot' AND s.purpose='road-safety-response'
      AND s.case_id='10000000-0000-4000-8000-000000000007'
      AND s.input_version=1 AND s.snapshot_digest=repeat('1', 64)
    FOR SHARE OF s;

    IF closure_snapshot_current IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'COGNITIVE_CLOSURE_SNAPSHOT_CHANGED';
    END IF;

    UPDATE road_events SET status='CLOSED', version=3
    WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
      AND id='10000000-0000-4000-8000-000000000007' AND version=2;
    INSERT INTO audit_logs (
      actor_type, actor_id, action, resource_type, resource_id,
      before_state, after_state, reason, trace_id
    ) VALUES (
      'OPERATOR', '20000000-0000-4000-8000-000000000007', 'road_event.closed',
      'RoadEvent', '10000000-0000-4000-8000-000000000007',
      '{"version":2}'::jsonb, '{"version":3}'::jsonb,
      'cognitive closure drift proof', '30000000-0000-4000-8000-000000000008'
    );
    INSERT INTO outbox_events (
      aggregate_type, aggregate_id, event_type, payload, correlation_id, tenant_id, purpose
    ) VALUES (
      'RoadEvent', '10000000-0000-4000-8000-000000000007', 'RoadEventClosed',
      '{"version":3}'::jsonb, '40000000-0000-4000-8000-000000000007',
      'riyadh-pilot', 'road-safety-response'
    );
  EXCEPTION WHEN OTHERS THEN
    IF position('COGNITIVE_CLOSURE_SNAPSHOT_CHANGED' IN SQLERRM) = 0 THEN RAISE; END IF;
    INSERT INTO cognitive_closure_result VALUES (true);
  END;
END;
$$;

DO $$
DECLARE
  baseline cognitive_closure_baseline%ROWTYPE;
  current_event_hash text;
  current_authorization_hash text;
  current_audit_count bigint;
  current_outbox_count bigint;
BEGIN
  SELECT * INTO baseline FROM cognitive_closure_baseline;
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

  IF NOT COALESCE((SELECT rejected FROM cognitive_closure_result), false) THEN
    RAISE EXCEPTION 'Cognitive closure drift was not rejected';
  END IF;
  IF current_event_hash <> baseline.event_hash THEN
    RAISE EXCEPTION 'Cognitive closure rejection changed the RoadEvent';
  END IF;
  IF current_authorization_hash <> baseline.authorization_hash THEN
    RAISE EXCEPTION 'Cognitive closure rejection rewrote authorization history';
  END IF;
  IF current_audit_count <> baseline.audit_count THEN
    RAISE EXCEPTION 'Cognitive closure rejection wrote an audit row';
  END IF;
  IF current_outbox_count <> baseline.outbox_count THEN
    RAISE EXCEPTION 'Cognitive closure rejection wrote an outbox row';
  END IF;
END;
$$;

COMMIT;
\set QUIET 0
SELECT unnest(ARRAY[
  'COGNITIVE_CLOSURE_DRIFT', 'REJECTED',
  'ROAD_EVENT_AUDIT_OUTBOX', 'UNCHANGED',
  'AUTHORIZATION_HISTORY', 'UNCHANGED'
]);
SQL
