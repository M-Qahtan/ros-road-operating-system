\set ON_ERROR_STOP on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $$
BEGIN
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
      AND (SELECT max(revision) FROM human_safety_indicator_revision_ledger
           WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
             AND case_id = snapshot.case_id) = 2
  ) THEN
    RAISE EXCEPTION 'committed invalidated recommendation was not durable across client reconnect';
  END IF;
END;
$$;

COMMIT;
