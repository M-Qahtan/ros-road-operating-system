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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM ros_eye_safety_fusion_rule_sets
    WHERE rule_set_version = 'ros-eye.safety-fusion.rules.v1'
      AND status = 'ACTIVE'
      AND rollback_rule_set_version = 'ros-eye.safety-fusion.rules.safe-default.v0'
      AND protected_attribute_policy = 'PROHIBITED'
      AND regression_evidence_digest ~ '^sha256:[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'active governed safety-fusion rule set is missing';
  END IF;
END;
$$;

INSERT INTO ros_eye_safety_fusion_recommendations (
  tenant_id, case_id, input_version, evaluated_at,
  current_severity, recommended_severity, score, confidence, uncertainty,
  reason_codes, missing_evidence_flags, guard_results, requires_human_review,
  authority, autonomous_downgrade_permitted, autonomous_closure_permitted,
  autonomous_dispatch_permitted, policy_version, rule_set_version,
  threshold_version, deterministic_fingerprint
)
VALUES (
  'tenant-fusion-ci', 'case-fusion-ci', 1, '2026-07-31T00:00:00Z',
  'S2', 'S4', 8.5000, 0.8200, 0.2800,
  ARRAY['FUSION_DEVICE_AIRBAG','FUSION_NO_RESPONSE','FUSION_HUMAN_AUTHORITY_REQUIRED'],
  ARRAY[]::text[],
  '[{"kind":"DATA_QUALITY","disposition":"CLEAR","reasonCode":"clear","guardVersion":"v1","evaluatedInputVersion":1}]'::jsonb,
  true, 'RECOMMENDATION_ONLY', false, false, false,
  'ros-eye.safety-fusion.v1', 'ros-eye.safety-fusion.rules.v1',
  'ros-eye.safety-fusion.thresholds.v1',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'
);

INSERT INTO ros_eye_safety_fusion_recommendations (
  tenant_id, case_id, input_version, evaluated_at,
  current_severity, recommended_severity, score, confidence, uncertainty,
  reason_codes, missing_evidence_flags, guard_results, requires_human_review,
  authority, autonomous_downgrade_permitted, autonomous_closure_permitted,
  autonomous_dispatch_permitted, policy_version, rule_set_version,
  threshold_version, deterministic_fingerprint
)
VALUES (
  'tenant-fusion-ci', 'case-fusion-ci', 1, '2026-07-31T00:00:00Z',
  'S2', 'S4', 8.5000, 0.8200, 0.2800,
  ARRAY['FUSION_DEVICE_AIRBAG','FUSION_NO_RESPONSE','FUSION_HUMAN_AUTHORITY_REQUIRED'],
  ARRAY[]::text[], '[]'::jsonb, true, 'RECOMMENDATION_ONLY', false, false, false,
  'ros-eye.safety-fusion.v1', 'ros-eye.safety-fusion.rules.v1',
  'ros-eye.safety-fusion.thresholds.v1',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'
)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM ros_eye_safety_fusion_recommendations
      WHERE tenant_id = 'tenant-fusion-ci' AND case_id = 'case-fusion-ci') <> 1 THEN
    RAISE EXCEPTION 'recommendation idempotency invariant failed';
  END IF;
END;
$$;

SELECT pg_temp.expect_failure(
  'autonomous downgrade persistence',
  $sql$
    INSERT INTO ros_eye_safety_fusion_recommendations (
      tenant_id, case_id, input_version, evaluated_at,
      current_severity, recommended_severity, score, confidence, uncertainty,
      reason_codes, missing_evidence_flags, guard_results, requires_human_review,
      authority, autonomous_downgrade_permitted, autonomous_closure_permitted,
      autonomous_dispatch_permitted, policy_version, rule_set_version,
      threshold_version, deterministic_fingerprint
    ) VALUES (
      'tenant-fusion-ci','case-downgrade',1,'2026-07-31T00:00:00Z',
      'S4','S2',1,0.9,0.1,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,false,
      'RECOMMENDATION_ONLY',false,false,false,'ros-eye.safety-fusion.v1',
      'ros-eye.safety-fusion.rules.v1','ros-eye.safety-fusion.thresholds.v1',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222'
    )
  $sql$,
  'check constraint'
);

SELECT pg_temp.expect_failure(
  'high risk without human review',
  $sql$
    INSERT INTO ros_eye_safety_fusion_recommendations (
      tenant_id, case_id, input_version, evaluated_at,
      current_severity, recommended_severity, score, confidence, uncertainty,
      reason_codes, missing_evidence_flags, guard_results, requires_human_review,
      authority, autonomous_downgrade_permitted, autonomous_closure_permitted,
      autonomous_dispatch_permitted, policy_version, rule_set_version,
      threshold_version, deterministic_fingerprint
    ) VALUES (
      'tenant-fusion-ci','case-no-review',1,'2026-07-31T00:00:00Z',
      'S2','S3',3,0.8,0.2,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,false,
      'RECOMMENDATION_ONLY',false,false,false,'ros-eye.safety-fusion.v1',
      'ros-eye.safety-fusion.rules.v1','ros-eye.safety-fusion.thresholds.v1',
      'sha256:3333333333333333333333333333333333333333333333333333333333333333'
    )
  $sql$,
  'check constraint'
);

INSERT INTO ros_eye_safety_fusion_evidence_packages (
  evidence_id, candidate_head_sha, candidate_base_sha, tested_merge_sha,
  run_id, run_attempt, fixture_digest, results_digest, fixture_count,
  weighted_false_negative_score, under_triage_count,
  missed_human_review_count, deterministic_mismatch_count, generated_at
)
VALUES (
  'fusion-evidence-ci',
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333',
  '123456', 1,
  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  'sha256:5555555555555555555555555555555555555555555555555555555555555555',
  6, 0, 0, 0, 0, '2026-07-31T00:05:00Z'
);

SELECT pg_temp.expect_failure(
  'failed evaluation evidence',
  $sql$
    INSERT INTO ros_eye_safety_fusion_evidence_packages (
      evidence_id, candidate_head_sha, candidate_base_sha, tested_merge_sha,
      run_id, run_attempt, fixture_digest, results_digest, fixture_count,
      weighted_false_negative_score, under_triage_count,
      missed_human_review_count, deterministic_mismatch_count, generated_at
    ) VALUES (
      'fusion-evidence-failed',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccc',
      '123457',1,
      'sha256:6666666666666666666666666666666666666666666666666666666666666666',
      'sha256:7777777777777777777777777777777777777777777777777777777777777777',
      6,10,1,0,0,'2026-07-31T00:05:00Z'
    )
  $sql$,
  'check constraint'
);

SELECT pg_temp.expect_failure(
  'recommendation mutation',
  $sql$
    UPDATE ros_eye_safety_fusion_recommendations
    SET confidence = 0.1
    WHERE tenant_id = 'tenant-fusion-ci' AND case_id = 'case-fusion-ci'
  $sql$,
  'append-only'
);

SELECT pg_temp.expect_failure(
  'evidence package deletion',
  $sql$
    DELETE FROM ros_eye_safety_fusion_evidence_packages
    WHERE evidence_id = 'fusion-evidence-ci'
  $sql$,
  'append-only'
);

DO $$
DECLARE
  forbidden_count integer;
BEGIN
  SELECT count(*) INTO forbidden_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('ros_eye_safety_fusion_recommendations','ros_eye_safety_fusion_evidence_packages')
    AND column_name IN ('raw_conversation','medical_narrative','phone_number','precise_location','access_token','protected_attribute');
  IF forbidden_count <> 0 THEN RAISE EXCEPTION 'forbidden raw or protected fields exist in fusion persistence'; END IF;
END;
$$;

ROLLBACK;
