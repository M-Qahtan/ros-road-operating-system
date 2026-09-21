#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE:?closure reauthorization proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE" \
  || -L "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE" \
  || -s "$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE" ]]; then
  echo "Closure reauthorization proof target must be a new empty regular file" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At >"$ROS_POSTGRES_CLOSURE_REAUTHORIZATION_PROOF_FILE" <<'SQL'
\set QUIET 1
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '10000000-0000-4000-8000-000000000009', 'riyadh-pilot', 'road-safety-response',
  'RECOVERY', 'S3', 82, 0.910, ARRAY['closure_reauthorization_recovery'], true,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-09-21T00:20:00Z', 9
);

INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009',
   'CASE', 1, repeat('a', 64), '2026-09-21T00:20:00Z'),
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009',
   'SEVERITY', 1, repeat('b', 64), '2026-09-21T00:20:00Z');

INSERT INTO evidence_revision_ledger (
  tenant_id, purpose, case_id, revision, digest, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009',
  1, repeat('d', 64), '2026-09-21T00:20:00Z'
);

INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009', 1,
  '[{"kind":"DEVICE_AIRBAG","disposition":"PRESENT","confidence":0.91}]'::jsonb,
  repeat('e', 64), '20000000-0000-4000-8000-000000000009', 'SUPERVISOR',
  '30000000-0000-4000-8000-000000000009', '2026-09-21T00:20:00Z'
);

INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009',
  1, 'ros-eye.input-snapshot.v1', '2026-09-21T00:20:10Z',
  1, repeat('a', 64), 1, repeat('b', 64), NULL, NULL,
  1, repeat('d', 64), 1, repeat('e', 64), repeat('3', 64)
);

INSERT INTO ros_eye_cognitive_input_snapshot_bindings (
  tenant_id, purpose, case_id, input_version, policy_version,
  base_snapshot_digest, captured_at, binding_policy_version, cognitive_authority,
  cognitive_revision, cognitive_digest, cognitive_state_time,
  cognitive_valid_until, cognitive_requires_abstention
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009',
  1, 'ros-eye.input-snapshot.v2', repeat('3', 64), '2026-09-21T00:20:10Z',
  'ros-eye.cognitive-input-binding.v1', 'SOURCE_LEDGER', 1, repeat('8', 64),
  '2026-09-21T00:20:05Z', '2026-09-21T00:25:00Z', false
);

INSERT INTO road_event_closure_authorization_journal (
  tenant_id, purpose, case_id, event_version,
  authorized_by, authorized_at, authorization_reason,
  source_input_version, source_snapshot_digest,
  cognitive_policy_version, cognitive_revision, cognitive_digest,
  recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009', 8,
  '20000000-0000-4000-8000-000000000008', '2026-09-21T00:20:20Z',
  'Historical revision-8 supervisor authorization',
  1, repeat('3', 64), 'ros-eye.input-snapshot.v2', 1, repeat('8', 64),
  '2026-09-21T00:20:20Z'
);

INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id
) VALUES (
  'SUPERVISOR', '20000000-0000-4000-8000-000000000008',
  'road_event.closure_authorized', 'RoadEvent',
  '10000000-0000-4000-8000-000000000009',
  '{"version":7}'::jsonb, '{"version":8}'::jsonb,
  'Historical revision-8 supervisor authorization',
  '30000000-0000-4000-8000-000000000008'
);

CREATE TEMP TABLE closure_reauthorization_baseline AS
SELECT
  md5(to_jsonb(event)::text) AS event_hash,
  (SELECT count(*) FROM audit_logs audit
    WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id) AS audit_count,
  (SELECT count(*) FROM outbox_events outbox
    WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id) AS outbox_count,
  (SELECT count(*) FROM road_event_closure_authorization_journal journal
    WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id) AS journal_count,
  (SELECT md5(to_jsonb(journal)::text)
    FROM road_event_closure_authorization_journal journal
    WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id AND journal.event_version=8) AS historical_journal_hash
FROM road_events event
WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
  AND event.id='10000000-0000-4000-8000-000000000009';

SAVEPOINT stale_closure_attempt;
DO $$
DECLARE changed integer;
BEGIN
  UPDATE road_events
  SET status='CLOSED', version=9
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000009' AND version=8;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'Stale revision-8 closure unexpectedly changed the RoadEvent';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT stale_closure_attempt;

DO $$
DECLARE baseline closure_reauthorization_baseline%ROWTYPE;
DECLARE current_event_hash text;
DECLARE current_audit_count bigint;
DECLARE current_outbox_count bigint;
DECLARE current_journal_count bigint;
BEGIN
  SELECT * INTO baseline FROM closure_reauthorization_baseline;
  SELECT md5(to_jsonb(event)::text),
    (SELECT count(*) FROM audit_logs audit
      WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id),
    (SELECT count(*) FROM outbox_events outbox
      WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id),
    (SELECT count(*) FROM road_event_closure_authorization_journal journal
      WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
        AND journal.case_id=event.id)
  INTO current_event_hash, current_audit_count, current_outbox_count, current_journal_count
  FROM road_events event
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000009';
  IF current_event_hash<>baseline.event_hash OR current_audit_count<>baseline.audit_count
    OR current_outbox_count<>baseline.outbox_count OR current_journal_count<>baseline.journal_count THEN
    RAISE EXCEPTION 'Stale revision-8 closure changed the durable write-set';
  END IF;
END;
$$;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM road_events event
  JOIN road_event_closure_authorization_journal journal
    ON journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
    AND journal.case_id=event.id AND journal.event_version=event.version
    AND journal.authorized_by=event.closure_authorized_by
    AND journal.authorized_at=event.closure_authorized_at
    AND journal.authorization_reason=event.closure_authorization_reason
    AND journal.source_input_version=event.closure_source_input_version
    AND journal.source_snapshot_digest=event.closure_source_snapshot_digest
    AND journal.cognitive_policy_version=event.closure_cognitive_policy_version
    AND journal.cognitive_revision=event.closure_cognitive_revision
    AND journal.cognitive_digest=event.closure_cognitive_digest
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000009'
) THEN 'AUTHORIZED' ELSE 'WITHHELD' END AS refresh_disposition \gset

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM road_events event
    JOIN road_event_closure_authorization_journal journal
      ON journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id AND journal.event_version=event.version
      AND journal.authorized_by=event.closure_authorized_by
      AND journal.authorized_at=event.closure_authorized_at
      AND journal.authorization_reason=event.closure_authorization_reason
    WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
      AND event.id='10000000-0000-4000-8000-000000000009'
  ) THEN
    RAISE EXCEPTION 'Revision 9 exposed the historical revision-8 authorization';
  END IF;
END;
$$;

DO $$
DECLARE changed integer;
BEGIN
  UPDATE road_events
  SET version=10,
    closure_authorized_by='20000000-0000-4000-8000-000000000009',
    closure_authorized_at='2026-09-21T00:22:00Z',
    closure_authorization_reason='Replacement supervisor review for revision 9',
    closure_source_input_version=1,
    closure_source_snapshot_digest=repeat('3', 64),
    closure_cognitive_policy_version='ros-eye.input-snapshot.v2',
    closure_cognitive_revision=1,
    closure_cognitive_digest=repeat('8', 64)
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND id='10000000-0000-4000-8000-000000000009' AND version=9;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Exact revision-9 reauthorization did not update once'; END IF;
END;
$$;

INSERT INTO road_event_closure_authorization_journal (
  tenant_id, purpose, case_id, event_version,
  authorized_by, authorized_at, authorization_reason,
  source_input_version, source_snapshot_digest,
  cognitive_policy_version, cognitive_revision, cognitive_digest,
  recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000009', 10,
  '20000000-0000-4000-8000-000000000009', '2026-09-21T00:22:00Z',
  'Replacement supervisor review for revision 9',
  1, repeat('3', 64), 'ros-eye.input-snapshot.v2', 1, repeat('8', 64),
  '2026-09-21T00:22:00Z'
);

INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id
) VALUES (
  'SUPERVISOR', '20000000-0000-4000-8000-000000000009',
  'road_event.closure_authorized', 'RoadEvent',
  '10000000-0000-4000-8000-000000000009',
  '{"version":9}'::jsonb, '{"version":10}'::jsonb,
  'Replacement supervisor review for revision 9',
  '30000000-0000-4000-8000-000000000010'
);

INSERT INTO outbox_events (
  aggregate_type, aggregate_id, event_type, payload, correlation_id, tenant_id, purpose
) VALUES (
  'RoadEvent', '10000000-0000-4000-8000-000000000009',
  'RoadEventClosureAuthorized', '{"version":10}'::jsonb,
  '40000000-0000-4000-8000-000000000010',
  'riyadh-pilot', 'road-safety-response'
);

DO $$
DECLARE baseline closure_reauthorization_baseline%ROWTYPE;
DECLARE current_historical_hash text;
DECLARE current_disposition text;
DECLARE journal_versions integer[];
DECLARE audit_versions integer[];
DECLARE current_outbox_count bigint;
BEGIN
  SELECT * INTO baseline FROM closure_reauthorization_baseline;
  SELECT md5(to_jsonb(journal)::text) INTO current_historical_hash
  FROM road_event_closure_authorization_journal journal
  WHERE journal.tenant_id='riyadh-pilot' AND journal.purpose='road-safety-response'
    AND journal.case_id='10000000-0000-4000-8000-000000000009'
    AND journal.event_version=8;
  SELECT array_agg(event_version ORDER BY event_version) INTO journal_versions
  FROM road_event_closure_authorization_journal
  WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
    AND case_id='10000000-0000-4000-8000-000000000009';
  SELECT array_agg((after_state->>'version')::integer ORDER BY (after_state->>'version')::integer)
  INTO audit_versions FROM audit_logs
  WHERE resource_type='RoadEvent' AND resource_id='10000000-0000-4000-8000-000000000009'
    AND action='road_event.closure_authorized';
  SELECT count(*) INTO current_outbox_count FROM outbox_events
  WHERE aggregate_type='RoadEvent' AND aggregate_id='10000000-0000-4000-8000-000000000009'
    AND event_type='RoadEventClosureAuthorized';
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM road_events event
    JOIN road_event_closure_authorization_journal journal
      ON journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id AND journal.event_version=event.version
      AND journal.authorized_by=event.closure_authorized_by
      AND journal.authorized_at=event.closure_authorized_at
      AND journal.authorization_reason=event.closure_authorization_reason
      AND journal.source_input_version=event.closure_source_input_version
      AND journal.source_snapshot_digest=event.closure_source_snapshot_digest
      AND journal.cognitive_policy_version=event.closure_cognitive_policy_version
      AND journal.cognitive_revision=event.closure_cognitive_revision
      AND journal.cognitive_digest=event.closure_cognitive_digest
    WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
      AND event.id='10000000-0000-4000-8000-000000000009' AND event.version=10
  ) THEN 'AUTHORIZED' ELSE 'WITHHELD' END INTO current_disposition;
  IF current_disposition<>'AUTHORIZED'
    OR journal_versions<>ARRAY[8,10] OR audit_versions<>ARRAY[8,10]
    OR current_outbox_count<>1 OR current_historical_hash<>baseline.historical_journal_hash THEN
    RAISE EXCEPTION 'Closure reauthorization recovery did not preserve exact history and current authority';
  END IF;
END;
$$;

COMMIT;
\set QUIET 0
SELECT unnest(ARRAY[
  'CLOSURE_REAUTHORIZATION_RECOVERY', 'VERIFIED',
  'STALE_CLOSURE_ROLLBACK', 'UNCHANGED',
  'REFRESH_AUTHORIZATION', :'refresh_disposition',
  'REPLACEMENT_AUTHORIZATION', 'COMMITTED',
  'AUTHORIZATION_HISTORY', '8,10',
  'CURRENT_VERSION', '10'
]);
SQL
