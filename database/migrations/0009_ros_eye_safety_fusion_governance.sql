BEGIN;

CREATE TABLE IF NOT EXISTS ros_eye_safety_fusion_rule_sets (
  rule_set_version text PRIMARY KEY,
  registry_schema_version text NOT NULL,
  threshold_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('CANDIDATE','ACTIVE','RETIRED')),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  regression_evidence_digest text NOT NULL CHECK (regression_evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  rollback_rule_set_version text,
  protected_attribute_policy text NOT NULL CHECK (protected_attribute_policy = 'PROHIBITED'),
  notes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status <> 'ACTIVE' OR rollback_rule_set_version IS NOT NULL),
  CHECK (rollback_rule_set_version IS NULL OR rollback_rule_set_version <> rule_set_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS ros_eye_safety_fusion_one_active_idx
  ON ros_eye_safety_fusion_rule_sets ((status))
  WHERE status = 'ACTIVE';

INSERT INTO ros_eye_safety_fusion_rule_sets (
  rule_set_version, registry_schema_version, threshold_version, status,
  approved_by, approved_at, regression_evidence_digest,
  rollback_rule_set_version, protected_attribute_policy, notes
)
VALUES (
  'ros-eye.safety-fusion.rules.safe-default.v0',
  'ros-eye.safety-fusion.registry.v1',
  'ros-eye.safety-fusion.thresholds.v1',
  'RETIRED',
  'ros-safety-governance',
  '2026-07-30T00:00:00Z',
  'sha256:8f97ee593320241c90f887b0f8a6b33dfca4a48025fdb40bc4d38f711cc221b4',
  NULL,
  'PROHIBITED',
  'Conservative rollback metadata. Recommendation-only and human-review preserving.'
)
ON CONFLICT (rule_set_version) DO NOTHING;

INSERT INTO ros_eye_safety_fusion_rule_sets (
  rule_set_version, registry_schema_version, threshold_version, status,
  approved_by, approved_at, regression_evidence_digest,
  rollback_rule_set_version, protected_attribute_policy, notes
)
VALUES (
  'ros-eye.safety-fusion.rules.v1',
  'ros-eye.safety-fusion.registry.v1',
  'ros-eye.safety-fusion.thresholds.v1',
  'ACTIVE',
  'ros-safety-governance',
  '2026-07-30T00:00:00Z',
  'sha256:91a86e13ed014be0803b749f39c947a96ddbd034c4292d3800a259ebfbc8891b',
  'ros-eye.safety-fusion.rules.safe-default.v0',
  'PROHIBITED',
  'Deterministic baseline. Human authority is mandatory for high-risk downgrade, resolution, diagnosis and dispatch.'
)
ON CONFLICT (rule_set_version) DO NOTHING;

ALTER TABLE ros_eye_safety_fusion_rule_sets
  DROP CONSTRAINT IF EXISTS ros_eye_safety_fusion_rollback_fk;
ALTER TABLE ros_eye_safety_fusion_rule_sets
  ADD CONSTRAINT ros_eye_safety_fusion_rollback_fk
  FOREIGN KEY (rollback_rule_set_version)
  REFERENCES ros_eye_safety_fusion_rule_sets(rule_set_version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS ros_eye_safety_fusion_recommendations (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  input_version integer NOT NULL CHECK (input_version > 0),
  evaluated_at timestamptz NOT NULL,
  current_severity text NOT NULL CHECK (current_severity IN ('S0','S1','S2','S3','S4')),
  recommended_severity text NOT NULL CHECK (recommended_severity IN ('S0','S1','S2','S3','S4')),
  score numeric(8,4) NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  uncertainty numeric(5,4) NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
  reason_codes text[] NOT NULL,
  missing_evidence_flags text[] NOT NULL,
  guard_results jsonb NOT NULL CHECK (jsonb_typeof(guard_results) = 'array'),
  requires_human_review boolean NOT NULL,
  authority text NOT NULL CHECK (authority = 'RECOMMENDATION_ONLY'),
  autonomous_downgrade_permitted boolean NOT NULL CHECK (autonomous_downgrade_permitted = false),
  autonomous_closure_permitted boolean NOT NULL CHECK (autonomous_closure_permitted = false),
  autonomous_dispatch_permitted boolean NOT NULL CHECK (autonomous_dispatch_permitted = false),
  policy_version text NOT NULL,
  rule_set_version text NOT NULL REFERENCES ros_eye_safety_fusion_rule_sets(rule_set_version),
  threshold_version text NOT NULL,
  deterministic_fingerprint text NOT NULL CHECK (deterministic_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, input_version, rule_set_version),
  UNIQUE (tenant_id, case_id, deterministic_fingerprint),
  CHECK (
    CASE recommended_severity WHEN 'S0' THEN 0 WHEN 'S1' THEN 1 WHEN 'S2' THEN 2 WHEN 'S3' THEN 3 ELSE 4 END
    >=
    CASE current_severity WHEN 'S0' THEN 0 WHEN 'S1' THEN 1 WHEN 'S2' THEN 2 WHEN 'S3' THEN 3 ELSE 4 END
  ),
  CHECK (recommended_severity NOT IN ('S3','S4') OR requires_human_review = true)
);

CREATE TABLE IF NOT EXISTS ros_eye_safety_fusion_evidence_packages (
  evidence_id text PRIMARY KEY,
  candidate_head_sha text NOT NULL CHECK (candidate_head_sha ~ '^[a-f0-9]{40}$'),
  candidate_base_sha text NOT NULL CHECK (candidate_base_sha ~ '^[a-f0-9]{40}$'),
  tested_merge_sha text NOT NULL CHECK (tested_merge_sha ~ '^[a-f0-9]{40}$'),
  run_id text NOT NULL CHECK (run_id ~ '^[1-9][0-9]*$'),
  run_attempt integer NOT NULL CHECK (run_attempt > 0),
  fixture_digest text NOT NULL CHECK (fixture_digest ~ '^sha256:[a-f0-9]{64}$'),
  results_digest text NOT NULL CHECK (results_digest ~ '^sha256:[a-f0-9]{64}$'),
  fixture_count integer NOT NULL CHECK (fixture_count > 0),
  weighted_false_negative_score numeric(10,4) NOT NULL CHECK (weighted_false_negative_score = 0),
  under_triage_count integer NOT NULL CHECK (under_triage_count = 0),
  missed_human_review_count integer NOT NULL CHECK (missed_human_review_count = 0),
  deterministic_mismatch_count integer NOT NULL CHECK (deterministic_mismatch_count = 0),
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (candidate_head_sha, tested_merge_sha, run_id, run_attempt)
);

CREATE OR REPLACE FUNCTION reject_ros_eye_safety_fusion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ROS Eye safety-fusion evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS ros_eye_safety_fusion_recommendations_append_only ON ros_eye_safety_fusion_recommendations;
CREATE TRIGGER ros_eye_safety_fusion_recommendations_append_only
BEFORE UPDATE OR DELETE ON ros_eye_safety_fusion_recommendations
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_safety_fusion_mutation();

DROP TRIGGER IF EXISTS ros_eye_safety_fusion_evidence_append_only ON ros_eye_safety_fusion_evidence_packages;
CREATE TRIGGER ros_eye_safety_fusion_evidence_append_only
BEFORE UPDATE OR DELETE ON ros_eye_safety_fusion_evidence_packages
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_safety_fusion_mutation();

COMMENT ON TABLE ros_eye_safety_fusion_rule_sets IS 'Versioned reviewed deterministic rule metadata. Protected attributes are prohibited and active rules require rollback metadata and regression evidence.';
COMMENT ON TABLE ros_eye_safety_fusion_recommendations IS 'Structured recommendation-only outputs. Raw conversation, medical narrative, phone numbers, tokens and precise location are prohibited.';
COMMENT ON TABLE ros_eye_safety_fusion_evidence_packages IS 'Commit/base/tested-merge/run-bound safety evaluation evidence. A package cannot be stored when false-negative or determinism gates fail.';

COMMIT;
