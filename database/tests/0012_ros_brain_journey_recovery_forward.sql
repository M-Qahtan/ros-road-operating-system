\set ON_ERROR_STOP on

BEGIN;

INSERT INTO ros_eye_safety_fusion_input_snapshots (
  tenant_id, purpose, case_id, input_version, policy_version, captured_at,
  case_revision, case_digest, severity_revision, severity_digest,
  contact_revision, contact_digest, evidence_revision, evidence_digest,
  indicator_revision, indicator_digest, snapshot_digest
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  2, 'ros-eye.input-snapshot.v1', '2026-09-08T20:03:00Z',
  1, repeat('a', 64), 1, repeat('b', 64), NULL, NULL,
  1, repeat('d', 64), 2, repeat('9', 64), repeat('2', 64)
);

INSERT INTO ros_eye_safety_fusion_recommendation_journal (
  tenant_id, purpose, case_id, input_version, source_snapshot_digest,
  snapshot_policy_version, bound_at, evaluated_at, deterministic_fingerprint,
  authority, mode, activation_authorized, human_review_status,
  rule_set_version, threshold_version, recommendation, binding
) VALUES (
  'riyadh-pilot', 'road-safety-response', '10000000-0000-4000-8000-000000000001',
  2, repeat('2', 64), 'ros-eye.input-snapshot.v1',
  '2026-09-08T20:03:02Z', '2026-09-08T20:03:01Z', 'sha256:' || repeat('7', 64),
  'RECOMMENDATION_ONLY', 'SHADOW_ONLY', false, 'PENDING',
  'ros-eye.safety-fusion.rules.v1', 'ros-eye.safety-fusion.thresholds.v1',
  jsonb_build_object(
    'tenantId', 'riyadh-pilot',
    'caseId', '10000000-0000-4000-8000-000000000001',
    'inputVersion', 2,
    'evaluatedAt', '2026-09-08T20:03:01Z',
    'deterministicFingerprint', 'sha256:' || repeat('7', 64),
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
    'inputVersion', 2,
    'recommendationFingerprint', 'sha256:' || repeat('7', 64),
    'sourceSnapshotDigest', repeat('2', 64),
    'boundAt', '2026-09-08T20:03:02Z'
  )
);

COMMIT;

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $$
BEGIN
  IF (SELECT count(*)
      FROM ros_eye_safety_fusion_input_snapshots
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'recovery did not preserve both append-only input snapshots';
  END IF;
  IF (SELECT count(*)
      FROM ros_eye_safety_fusion_recommendation_journal
      WHERE tenant_id = 'riyadh-pilot'
        AND purpose = 'road-safety-response'
        AND case_id = '10000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'recovery did not preserve both append-only recommendations';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM ros_eye_safety_fusion_recommendation_journal old_journal
    JOIN ros_eye_safety_fusion_input_snapshots old_snapshot
      USING (tenant_id, purpose, case_id, input_version)
    WHERE old_journal.tenant_id = 'riyadh-pilot'
      AND old_journal.purpose = 'road-safety-response'
      AND old_journal.case_id = '10000000-0000-4000-8000-000000000001'
      AND old_journal.input_version = 1
      AND old_snapshot.indicator_revision = 1
      AND old_snapshot.indicator_digest = repeat('e', 64)
      AND old_snapshot.indicator_revision < (
        SELECT max(revision)
        FROM human_safety_indicator_revision_ledger
        WHERE tenant_id = old_snapshot.tenant_id
          AND purpose = old_snapshot.purpose
          AND case_id = old_snapshot.case_id
      )
  ) THEN
    RAISE EXCEPTION 'recovery incorrectly made the historical recommendation current';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM ros_eye_safety_fusion_recommendation_journal current_journal
    JOIN ros_eye_safety_fusion_input_snapshots current_snapshot
      USING (tenant_id, purpose, case_id, input_version)
    WHERE current_journal.tenant_id = 'riyadh-pilot'
      AND current_journal.purpose = 'road-safety-response'
      AND current_journal.case_id = '10000000-0000-4000-8000-000000000001'
      AND current_journal.input_version = 2
      AND current_journal.source_snapshot_digest = current_snapshot.snapshot_digest
      AND current_snapshot.indicator_revision = 2
      AND current_snapshot.indicator_digest = repeat('9', 64)
      AND current_snapshot.indicator_revision = (
        SELECT max(revision)
        FROM human_safety_indicator_revision_ledger
        WHERE tenant_id = current_snapshot.tenant_id
          AND purpose = current_snapshot.purpose
          AND case_id = current_snapshot.case_id
      )
      AND current_journal.authority = 'RECOMMENDATION_ONLY'
      AND current_journal.mode = 'SHADOW_ONLY'
      AND current_journal.activation_authorized = false
      AND current_journal.human_review_status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'recovery did not create one current governed recommendation';
  END IF;
END;
$$;

COMMIT;
