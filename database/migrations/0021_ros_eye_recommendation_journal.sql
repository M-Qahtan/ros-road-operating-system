BEGIN;

CREATE TABLE ros_eye_safety_fusion_recommendation_journal (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  input_version integer NOT NULL CHECK (input_version > 0),
  source_snapshot_digest text NOT NULL CHECK (source_snapshot_digest ~ '^[a-f0-9]{64}$'),
  snapshot_policy_version text NOT NULL CHECK (snapshot_policy_version = 'ros-eye.input-snapshot.v1'),
  bound_at timestamptz NOT NULL,
  evaluated_at timestamptz NOT NULL CHECK (evaluated_at <= bound_at),
  deterministic_fingerprint text NOT NULL CHECK (deterministic_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  authority text NOT NULL CHECK (authority = 'RECOMMENDATION_ONLY'),
  mode text NOT NULL CHECK (mode = 'SHADOW_ONLY'),
  activation_authorized boolean NOT NULL CHECK (activation_authorized = false),
  human_review_status text NOT NULL CHECK (human_review_status = 'PENDING'),
  rule_set_version text NOT NULL REFERENCES ros_eye_safety_fusion_rule_sets(rule_set_version),
  threshold_version text NOT NULL,
  recommendation jsonb NOT NULL CHECK (jsonb_typeof(recommendation) = 'object'),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, input_version),
  UNIQUE (tenant_id, purpose, case_id, deterministic_fingerprint),
  FOREIGN KEY (tenant_id, purpose, case_id, input_version)
    REFERENCES ros_eye_safety_fusion_input_snapshots(tenant_id, purpose, case_id, input_version)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_ros_eye_recommendation_journal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ROS Eye recommendation journal is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ros_eye_recommendation_journal_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot_row ros_eye_safety_fusion_input_snapshots%ROWTYPE;
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

CREATE TRIGGER ros_eye_recommendation_journal_binding_guard
BEFORE INSERT ON ros_eye_safety_fusion_recommendation_journal
FOR EACH ROW EXECUTE FUNCTION enforce_ros_eye_recommendation_journal_binding();

CREATE TRIGGER ros_eye_recommendation_journal_append_only
BEFORE UPDATE OR DELETE ON ros_eye_safety_fusion_recommendation_journal
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_recommendation_journal_mutation();

COMMENT ON TABLE ros_eye_safety_fusion_recommendation_journal IS
  'Immutable Tenant and Purpose scoped shadow recommendations bound to persisted input snapshots. Every row remains pending human review and grants no activation, dispatch, closure, downgrade, collection, or actuation authority.';

COMMIT;
