BEGIN;

CREATE TABLE ros_eye_safety_fusion_input_snapshots (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL REFERENCES road_events(id) ON DELETE RESTRICT,
  input_version integer NOT NULL CHECK (input_version > 0),
  policy_version text NOT NULL CHECK (policy_version = 'ros-eye.input-snapshot.v1'),
  captured_at timestamptz NOT NULL,
  case_revision integer NOT NULL CHECK (case_revision > 0),
  case_digest text NOT NULL CHECK (case_digest ~ '^[a-f0-9]{64}$'),
  severity_revision integer NOT NULL CHECK (severity_revision > 0),
  severity_digest text NOT NULL CHECK (severity_digest ~ '^[a-f0-9]{64}$'),
  contact_revision integer CHECK (contact_revision > 0),
  contact_digest text CHECK (contact_digest ~ '^[a-f0-9]{64}$'),
  evidence_revision integer NOT NULL CHECK (evidence_revision > 0),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  indicator_revision integer NOT NULL CHECK (indicator_revision > 0),
  indicator_digest text NOT NULL CHECK (indicator_digest ~ '^[a-f0-9]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, input_version),
  UNIQUE (tenant_id, purpose, case_id, snapshot_digest),
  CHECK ((contact_revision IS NULL) = (contact_digest IS NULL))
);

CREATE INDEX ros_eye_input_snapshots_latest_idx
  ON ros_eye_safety_fusion_input_snapshots (tenant_id, purpose, case_id, input_version DESC);

CREATE OR REPLACE FUNCTION reject_ros_eye_input_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ROS Eye input snapshots are append-only';
END;
$$;

CREATE TRIGGER ros_eye_input_snapshots_append_only
BEFORE UPDATE OR DELETE ON ros_eye_safety_fusion_input_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_input_snapshot_mutation();

COMMENT ON TABLE ros_eye_safety_fusion_input_snapshots IS
  'Tenant and purpose scoped immutable input receipts. Source modules own component revisions and canonical digests; this table grants no collection or action authority.';

COMMIT;
