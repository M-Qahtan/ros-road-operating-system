BEGIN;

ALTER TABLE ros_eye_safety_fusion_recommendation_journal
  ADD COLUMN cognitive_snapshot_policy_version text,
  ADD COLUMN cognitive_revision integer,
  ADD COLUMN cognitive_digest text,
  ADD COLUMN cognitive_requires_abstention boolean,
  ADD CONSTRAINT ros_eye_recommendation_cognitive_binding_complete CHECK (
    (cognitive_snapshot_policy_version IS NULL AND cognitive_revision IS NULL
      AND cognitive_digest IS NULL AND cognitive_requires_abstention IS NULL)
    OR
    (cognitive_snapshot_policy_version = 'ros-eye.input-snapshot.v2'
      AND cognitive_revision > 0
      AND cognitive_digest ~ '^[a-f0-9]{64}$'
      AND cognitive_requires_abstention = false)
  );

CREATE OR REPLACE FUNCTION enforce_ros_eye_recommendation_journal_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot_row ros_eye_safety_fusion_input_snapshots%ROWTYPE;
  cognitive_row ros_eye_cognitive_input_snapshot_bindings%ROWTYPE;
  rule_row ros_eye_safety_fusion_rule_sets%ROWTYPE;
BEGIN
  SELECT * INTO snapshot_row
  FROM ros_eye_safety_fusion_input_snapshots
  WHERE tenant_id = NEW.tenant_id AND purpose = NEW.purpose
    AND case_id = NEW.case_id AND input_version = NEW.input_version
  FOR SHARE;

  IF NOT FOUND OR snapshot_row.snapshot_digest <> NEW.source_snapshot_digest
    OR snapshot_row.policy_version <> NEW.snapshot_policy_version THEN
    RAISE EXCEPTION 'recommendation snapshot binding is not authoritative';
  END IF;

  SELECT * INTO cognitive_row
  FROM ros_eye_cognitive_input_snapshot_bindings
  WHERE tenant_id = NEW.tenant_id AND purpose = NEW.purpose
    AND case_id = NEW.case_id AND input_version = NEW.input_version
  FOR SHARE;

  IF NOT FOUND OR cognitive_row.base_snapshot_digest <> NEW.source_snapshot_digest
    OR cognitive_row.captured_at <> snapshot_row.captured_at
    OR cognitive_row.policy_version <> NEW.cognitive_snapshot_policy_version
    OR cognitive_row.cognitive_revision <> NEW.cognitive_revision
    OR cognitive_row.cognitive_digest <> NEW.cognitive_digest
    OR cognitive_row.cognitive_requires_abstention
    OR NEW.cognitive_requires_abstention THEN
    RAISE EXCEPTION 'recommendation cognitive snapshot binding is not authoritative or requires abstention';
  END IF;

  SELECT * INTO rule_row
  FROM ros_eye_safety_fusion_rule_sets
  WHERE rule_set_version = NEW.rule_set_version
  FOR SHARE;

  IF NOT FOUND OR rule_row.status <> 'ACTIVE'
    OR rule_row.threshold_version <> NEW.threshold_version
    OR rule_row.registry_schema_version <> 'ros-eye.safety-fusion.registry.v1'
    OR rule_row.protected_attribute_policy <> 'PROHIBITED'
    OR rule_row.rollback_rule_set_version IS NULL
    OR rule_row.regression_evidence_digest !~ '^sha256:[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'recommendation rule governance is not active';
  END IF;

  IF NEW.recommendation->>'tenantId' <> NEW.tenant_id
    OR NEW.recommendation->>'caseId' <> NEW.case_id::text
    OR (NEW.recommendation->>'inputVersion')::integer <> NEW.input_version
    OR (NEW.recommendation->>'evaluatedAt')::timestamptz <> NEW.evaluated_at
    OR NEW.recommendation->>'deterministicFingerprint' <> NEW.deterministic_fingerprint
    OR NEW.recommendation->>'authority' <> 'RECOMMENDATION_ONLY'
    OR NEW.recommendation->>'policyVersion' <> 'ros-eye.safety-fusion.v1'
    OR NEW.recommendation->>'ruleSetVersion' <> NEW.rule_set_version
    OR NEW.recommendation->>'thresholdVersion' <> NEW.threshold_version
    OR NEW.recommendation->>'requiresHumanReview' <> 'true'
    OR NEW.recommendation->>'autonomousDowngradePermitted' <> 'false'
    OR NEW.recommendation->>'autonomousClosurePermitted' <> 'false'
    OR NEW.recommendation->>'autonomousDispatchPermitted' <> 'false'
    OR NEW.binding->>'policyVersion' <> NEW.snapshot_policy_version
    OR (NEW.binding->>'inputVersion')::integer <> NEW.input_version
    OR NEW.binding->>'recommendationFingerprint' <> NEW.deterministic_fingerprint
    OR NEW.binding->>'sourceSnapshotDigest' <> NEW.source_snapshot_digest
    OR (NEW.binding->>'boundAt')::timestamptz <> NEW.bound_at THEN
    RAISE EXCEPTION 'recommendation journal payload does not match constrained columns';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN ros_eye_safety_fusion_recommendation_journal.cognitive_snapshot_policy_version IS
  'Null only for immutable legacy v1 history. New writes require an exact non-abstaining v2 receipt.';

COMMIT;
