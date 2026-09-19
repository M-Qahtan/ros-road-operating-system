BEGIN;

ALTER TABLE ros_eye_safety_fusion_input_snapshots
  ADD CONSTRAINT ros_eye_input_snapshots_cognitive_binding_key
    UNIQUE (tenant_id, purpose, case_id, input_version, snapshot_digest, captured_at);

CREATE TABLE ros_eye_cognitive_input_snapshot_bindings (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  input_version integer NOT NULL CHECK (input_version > 0),
  policy_version text NOT NULL CHECK (policy_version = 'ros-eye.input-snapshot.v2'),
  base_snapshot_digest text NOT NULL CHECK (base_snapshot_digest ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  binding_policy_version text NOT NULL CHECK (binding_policy_version = 'ros-eye.cognitive-input-binding.v1'),
  cognitive_authority text NOT NULL CHECK (cognitive_authority = 'SOURCE_LEDGER'),
  cognitive_revision integer NOT NULL CHECK (cognitive_revision > 0),
  cognitive_digest text NOT NULL CHECK (cognitive_digest ~ '^[a-f0-9]{64}$'),
  cognitive_state_time timestamptz NOT NULL,
  cognitive_valid_until timestamptz NOT NULL,
  cognitive_requires_abstention boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, input_version),
  FOREIGN KEY (
    tenant_id, purpose, case_id, input_version, base_snapshot_digest, captured_at
  ) REFERENCES ros_eye_safety_fusion_input_snapshots (
    tenant_id, purpose, case_id, input_version, snapshot_digest, captured_at
  ) ON DELETE RESTRICT,
  CHECK (cognitive_state_time <= captured_at),
  CHECK (captured_at <= cognitive_valid_until),
  CHECK (cognitive_state_time < cognitive_valid_until)
);

CREATE TRIGGER ros_eye_cognitive_input_snapshot_bindings_append_only
BEFORE UPDATE OR DELETE ON ros_eye_cognitive_input_snapshot_bindings
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_input_snapshot_mutation();

COMMENT ON TABLE ros_eye_cognitive_input_snapshot_bindings IS
  'Required append-only v2 extension for an exact v1 input snapshot. Absence leaves the v1 row readable but never cognitive-bound; this receipt grants no collection, recommendation, or action authority.';

COMMIT;
