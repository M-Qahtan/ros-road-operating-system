#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE:?closure authorization read proof file must be set}"

if [[ ! -f "$ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE" \
  || -L "$ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE" \
  || -s "$ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE" ]]; then
  echo "Closure authorization read proof target must be a new empty regular file" >&2
  exit 2
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At >"$ROS_POSTGRES_CLOSURE_AUTHORIZATION_READ_PROOF_FILE" <<'SQL'
\set QUIET 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

CREATE TEMP TABLE closure_authorization_read_baseline AS
SELECT
  md5(to_jsonb(event)::text) AS event_hash,
  (SELECT count(*) FROM audit_logs audit
    WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id) AS audit_count,
  (SELECT count(*) FROM outbox_events outbox
    WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id) AS outbox_count,
  (SELECT count(*) FROM road_event_closure_authorization_journal journal
    WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id) AS journal_count,
  (SELECT md5(string_agg(to_jsonb(journal)::text, '|' ORDER BY journal.event_version))
    FROM road_event_closure_authorization_journal journal
    WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
      AND journal.case_id=event.id) AS journal_hash
FROM road_events event
WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
  AND event.id='10000000-0000-4000-8000-000000000007';

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM road_events event
  JOIN road_event_closure_authorization_journal authorization_journal
    ON authorization_journal.tenant_id=event.tenant_id
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
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007'
) THEN 'AUTHORIZED' ELSE 'WITHHELD' END AS exact_disposition \gset

SAVEPOINT missing_journal_read;
INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version,
  closure_authorized_by, closure_authorized_at, closure_authorization_reason
) VALUES (
  '10000000-0000-4000-8000-000000000008', 'riyadh-pilot', 'road-safety-response',
  'RECOVERY', 'S3', 77, 0.920, ARRAY['missing_closure_authorization_journal'], true,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-09-19T20:02:00Z', 1,
  '20000000-0000-4000-8000-000000000008', '2026-09-19T20:02:20Z',
  'Legacy authorization without independent journal evidence'
);
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM road_events event
  JOIN road_event_closure_authorization_journal authorization_journal
    ON authorization_journal.tenant_id=event.tenant_id
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
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000008'
) THEN 'AUTHORIZED' ELSE 'WITHHELD' END AS missing_disposition \gset
ROLLBACK TO SAVEPOINT missing_journal_read;

SAVEPOINT mismatched_read;
UPDATE road_events
SET closure_authorization_reason=closure_authorization_reason || '-mismatch'
WHERE tenant_id='riyadh-pilot' AND purpose='road-safety-response'
  AND id='10000000-0000-4000-8000-000000000007';

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM road_events event
  JOIN road_event_closure_authorization_journal authorization_journal
    ON authorization_journal.tenant_id=event.tenant_id
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
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007'
) THEN 'AUTHORIZED' ELSE 'WITHHELD' END AS mismatch_disposition \gset
ROLLBACK TO SAVEPOINT mismatched_read;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM road_events event
  JOIN road_event_closure_authorization_journal authorization_journal
    ON authorization_journal.tenant_id=event.tenant_id
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
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007'
) THEN 'AUTHORIZED' ELSE 'WITHHELD' END AS restored_disposition \gset

DO $$
DECLARE baseline closure_authorization_read_baseline%ROWTYPE;
DECLARE current_event_hash text;
DECLARE current_audit_count bigint;
DECLARE current_outbox_count bigint;
DECLARE current_journal_count bigint;
DECLARE current_journal_hash text;
BEGIN
  SELECT * INTO baseline FROM closure_authorization_read_baseline;
  SELECT md5(to_jsonb(event)::text),
    (SELECT count(*) FROM audit_logs audit
      WHERE audit.resource_type='RoadEvent' AND audit.resource_id=event.id),
    (SELECT count(*) FROM outbox_events outbox
      WHERE outbox.aggregate_type='RoadEvent' AND outbox.aggregate_id=event.id),
    (SELECT count(*) FROM road_event_closure_authorization_journal journal
      WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
        AND journal.case_id=event.id),
    (SELECT md5(string_agg(to_jsonb(journal)::text, '|' ORDER BY journal.event_version))
      FROM road_event_closure_authorization_journal journal
      WHERE journal.tenant_id=event.tenant_id AND journal.purpose=event.purpose
        AND journal.case_id=event.id)
  INTO current_event_hash, current_audit_count, current_outbox_count,
    current_journal_count, current_journal_hash
  FROM road_events event
  WHERE event.tenant_id='riyadh-pilot' AND event.purpose='road-safety-response'
    AND event.id='10000000-0000-4000-8000-000000000007';

  IF baseline.event_hash IS NULL OR current_event_hash<>baseline.event_hash
    OR current_audit_count<>baseline.audit_count
    OR current_outbox_count<>baseline.outbox_count
    OR current_journal_count<>baseline.journal_count
    OR current_journal_hash<>baseline.journal_hash THEN
    RAISE EXCEPTION 'Closure authorization read proof changed durable state';
  END IF;
END;
$$;
COMMIT;
\set QUIET 0
SELECT unnest(ARRAY[
  'CLOSURE_AUTHORIZATION_READ_MODEL', :'exact_disposition',
  'MISSING_JOURNAL', :'missing_disposition',
  'MISMATCH', :'mismatch_disposition',
  'ROLLBACK_RESTORED', :'restored_disposition',
  'ROAD_EVENT_AUDIT_OUTBOX_JOURNAL', 'UNCHANGED'
]);
SQL
