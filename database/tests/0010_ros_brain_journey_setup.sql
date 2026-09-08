\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_failure(
  p_label text,
  p_statement text,
  p_expected_fragment text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  failed_as_expected boolean := false;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_fragment IN SQLERRM) > 0 THEN
      failed_as_expected := true;
    ELSE
      RAISE EXCEPTION '% failed with unexpected error: %', p_label, SQLERRM;
    END IF;
  END;
  IF NOT failed_as_expected THEN RAISE EXCEPTION '% unexpectedly succeeded', p_label; END IF;
END;
$$;

BEGIN;

INSERT INTO road_event_revision_ledger (
  tenant_id, purpose, case_id, component, revision, digest, recorded_at
) VALUES
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
   'CASE', 1, repeat('a', 64), '2026-09-08T20:00:00Z'),
  ('riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
   'SEVERITY', 1, repeat('b', 64), '2026-09-08T20:00:00Z');

INSERT INTO evidence_revision_ledger (
  tenant_id, purpose, case_id, revision, digest, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  1, repeat('d', 64), '2026-09-08T20:00:00Z'
);

INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001', 1,
  '[{"kind":"DEVICE_AIRBAG","disposition":"PRESENT","confidence":0.91}]'::jsonb,
  repeat('e', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000001', '2026-09-08T20:00:00Z'
);

INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  1, 'ros-eye.input-snapshot.v1', '2026-09-08T20:00:01Z',
  1, repeat('a', 64), 1, repeat('b', 64), NULL, NULL,
  1, repeat('d', 64), 1, repeat('e', 64), repeat('1', 64)
);

INSERT INTO ros_eye_safety_fusion_recommendation_journal (
  tenant_id, purpose, case_id, input_version, source_snapshot_digest,
  snapshot_policy_version, bound_at, evaluated_at, deterministic_fingerprint,
  authority, mode, activation_authorized, human_review_status,
  rule_set_version, threshold_version, recommendation, binding
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  1, repeat('1', 64), 'ros-eye.input-snapshot.v1',
  '2026-09-08T20:00:03Z', '2026-09-08T20:00:02Z', 'sha256:' || repeat('f', 64),
  'RECOMMENDATION_ONLY', 'SHADOW_ONLY', false, 'PENDING',
  'ros-eye.safety-fusion.rules.v1', 'ros-eye.safety-fusion.thresholds.v1',
  jsonb_build_object(
    'tenantId', 'riyadh-pilot',
    'caseId', '10000000-0000-4000-8000-000000000001',
    'inputVersion', 1,
    'evaluatedAt', '2026-09-08T20:00:02Z',
    'deterministicFingerprint', 'sha256:' || repeat('f', 64),
    'authority', 'RECOMMENDATION_ONLY',
    'policyVersion', 'ros-eye.safety-fusion.v1',
    'ruleSetVersion', 'ros-eye.safety-fusion.rules.v1',
    'thresholdVersion', 'ros-eye.safety-fusion.thresholds.v1',
    'requiresHumanReview', true,
    'autonomousDowngradePermitted', false,
    'autonomousClosurePermitted', false,
    'autonomousDispatchPermitted', false
  ),
  jsonb_build_object(
    'policyVersion', 'ros-eye.input-snapshot.v1',
    'inputVersion', 1,
    'recommendationFingerprint', 'sha256:' || repeat('f', 64),
    'sourceSnapshotDigest', repeat('1', 64),
    'boundAt', '2026-09-08T20:00:03Z'
  )
);

COMMIT;

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
      AND journal.source_snapshot_digest = snapshot.snapshot_digest
      AND journal.human_review_status = 'PENDING'
      AND journal.mode = 'SHADOW_ONLY'
      AND journal.activation_authorized = false
      AND snapshot.case_revision = (
        SELECT max(revision) FROM road_event_revision_ledger
        WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
          AND case_id = snapshot.case_id AND component = 'CASE'
      )
      AND snapshot.severity_revision = (
        SELECT max(revision) FROM road_event_revision_ledger
        WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
          AND case_id = snapshot.case_id AND component = 'SEVERITY'
      )
      AND snapshot.evidence_revision = (
        SELECT max(revision) FROM evidence_revision_ledger
        WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
          AND case_id = snapshot.case_id
      )
      AND snapshot.indicator_revision = (
        SELECT max(revision) FROM human_safety_indicator_revision_ledger
        WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
          AND case_id = snapshot.case_id
      )
  ) THEN
    RAISE EXCEPTION 'current governed recommendation was not readable';
  END IF;
END;
$$;

COMMIT;

BEGIN;

INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001', 2,
  '[{"kind":"DEVICE_AIRBAG","disposition":"ABSENT","confidence":0.96}]'::jsonb,
  repeat('9', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000002', '2026-09-08T20:01:00Z'
);

COMMIT;

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
      AND snapshot.indicator_revision < (
        SELECT max(revision) FROM human_safety_indicator_revision_ledger
        WHERE tenant_id = snapshot.tenant_id AND purpose = snapshot.purpose
          AND case_id = snapshot.case_id
      )
      AND journal.human_review_status = 'PENDING'
      AND journal.activation_authorized = false
  ) THEN
    RAISE EXCEPTION 'indicator correction did not invalidate the prior binding';
  END IF;
END;
$$;

SELECT pg_temp.expect_failure(
  'recommendation journal mutation',
  $sql$
    UPDATE ros_eye_safety_fusion_recommendation_journal
    SET human_review_status = 'APPROVED'
    WHERE tenant_id = 'riyadh-pilot'
      AND purpose = 'road-safety-response'
      AND case_id = '10000000-0000-4000-8000-000000000001'
  $sql$,
  'append-only'
);

BEGIN;

INSERT INTO human_safety_indicator_revision_ledger (
  tenant_id, purpose, case_id, revision, indicator_set, digest,
  recorded_by, recorded_by_role, trace_id, recorded_at
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001', 3,
  '[{"kind":"DEVICE_AIRBAG","disposition":"UNKNOWN","confidence":0.50}]'::jsonb,
  repeat('8', 64), '20000000-0000-4000-8000-000000000001', 'OPERATOR',
  '30000000-0000-4000-8000-000000000003', '2026-09-08T20:02:00Z'
);

ROLLBACK;

DO $$
BEGIN
  IF (SELECT max(revision) FROM human_safety_indicator_revision_ledger
      WHERE tenant_id = 'riyadh-pilot' AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'rolled-back indicator revision remained visible';
  END IF;
  IF (SELECT count(*) FROM ros_eye_safety_fusion_recommendation_journal
      WHERE tenant_id = 'riyadh-pilot' AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'rollback or failed mutation changed the journal';
  END IF;
END;
$$;
