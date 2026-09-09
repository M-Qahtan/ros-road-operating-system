\set ON_ERROR_STOP on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $$
BEGIN
  IF (SELECT count(*)
      FROM road_event_revision_ledger
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 2
    OR (SELECT count(*)
      FROM road_event_revision_ledger
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001'
        AND ((component = 'CASE' AND revision = 1 AND digest = repeat('a', 64))
          OR (component = 'SEVERITY' AND revision = 1 AND digest = repeat('b', 64)))) <> 2 THEN
    RAISE EXCEPTION 'RoadEvent case/severity receipts were not durable after restart';
  END IF;
  IF (SELECT count(*)
      FROM ros_eye_contact_sessions session
      JOIN road_events event
        ON event.tenant_id = session.tenant_id
       AND event.id::text = session.case_id
      WHERE event.tenant_id = 'riyadh-pilot'
        AND event.purpose = 'road-safety-response'
        AND event.id = '10000000-0000-4000-8000-000000000001') <> 0
    OR (SELECT count(*)
        FROM ros_eye_contact_revision_ledger
        WHERE tenant_id = 'riyadh-pilot'
          AND purpose = 'road-safety-response'
          AND case_id = '10000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'authoritative Contact absence was not durable after restart';
  END IF;
  IF (SELECT count(*)
      FROM evidence_revision_ledger
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 1
    OR NOT EXISTS (
    SELECT 1
    FROM evidence_revision_ledger
    WHERE tenant_id = 'riyadh-pilot'
      AND purpose = 'road-safety-response'
      AND case_id = '10000000-0000-4000-8000-000000000001'
      AND revision = 1
      AND digest = repeat('d', 64)
  ) THEN
    RAISE EXCEPTION 'Evidence receipt was not durable after restart';
  END IF;
  IF (SELECT count(*)
      FROM human_safety_indicator_revision_ledger
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 2
    OR (SELECT count(*)
      FROM human_safety_indicator_revision_ledger
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001'
        AND ((revision = 1 AND digest = repeat('e', 64))
          OR (revision = 2 AND digest = repeat('9', 64)))) <> 2 THEN
    RAISE EXCEPTION 'Human-Safety Indicator history was not durable after restart';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM ros_eye_safety_fusion_recommendation_journal journal
    JOIN ros_eye_safety_fusion_input_snapshots snapshot
      USING (tenant_id, purpose, case_id, input_version)
    WHERE journal.tenant_id = 'riyadh-pilot'
      AND journal.purpose = 'road-safety-response'
      AND journal.case_id = '10000000-0000-4000-8000-000000000001'
      AND journal.authority = 'RECOMMENDATION_ONLY'
      AND journal.mode = 'SHADOW_ONLY'
      AND journal.activation_authorized = false
      AND journal.human_review_status = 'PENDING'
      AND snapshot.indicator_revision = 1
      AND snapshot.case_revision = 1
      AND snapshot.case_digest = repeat('a', 64)
      AND snapshot.severity_revision = 1
      AND snapshot.severity_digest = repeat('b', 64)
      AND snapshot.contact_revision IS NULL
      AND snapshot.contact_digest IS NULL
      AND snapshot.evidence_revision = 1
      AND snapshot.evidence_digest = repeat('d', 64)
      AND snapshot.indicator_digest = repeat('e', 64)
      AND snapshot.snapshot_digest = repeat('1', 64)
      AND journal.source_snapshot_digest = snapshot.snapshot_digest
      AND (SELECT max(revision) FROM human_safety_indicator_revision_ledger
           WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
             AND case_id = snapshot.case_id) = 2
  ) THEN
    RAISE EXCEPTION 'committed invalidated recommendation was not durable across client reconnect';
  END IF;
END;
$$;

COMMIT;

BEGIN;

INSERT INTO ros_eye_safety_fusion_recommendation_journal (
  tenant_id, purpose, case_id, input_version, source_snapshot_digest,
  snapshot_policy_version, bound_at, evaluated_at, deterministic_fingerprint,
  authority, mode, activation_authorized, human_review_status,
  rule_set_version, threshold_version, recommendation, binding
)
SELECT
  tenant_id, purpose, case_id, input_version, source_snapshot_digest,
  snapshot_policy_version, bound_at, evaluated_at, deterministic_fingerprint,
  authority, mode, activation_authorized, human_review_status,
  rule_set_version, threshold_version, recommendation, binding
FROM ros_eye_safety_fusion_recommendation_journal
WHERE tenant_id = 'riyadh-pilot'
  AND purpose = 'road-safety-response'
  AND case_id = '10000000-0000-4000-8000-000000000001'
  AND input_version = 1
ON CONFLICT (tenant_id, purpose, case_id, input_version) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*)
      FROM ros_eye_safety_fusion_recommendation_journal
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001'
        AND input_version = 1) <> 1 THEN
    RAISE EXCEPTION 'post-restart exact retry duplicated the recommendation';
  END IF;
END;
$$;

COMMIT;
