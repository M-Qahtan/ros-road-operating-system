BEGIN;

CREATE TABLE road_event_closure_authorization_journal (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  authorized_by uuid NOT NULL,
  authorized_at timestamptz NOT NULL,
  authorization_reason text NOT NULL CHECK (length(trim(authorization_reason)) > 0),
  source_input_version integer,
  source_snapshot_digest text,
  cognitive_policy_version text,
  cognitive_revision integer,
  cognitive_digest text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, event_version),
  FOREIGN KEY (tenant_id, purpose, case_id)
    REFERENCES road_events(tenant_id, purpose, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, purpose, case_id, source_input_version, source_snapshot_digest
  ) REFERENCES ros_eye_safety_fusion_input_snapshots (
    tenant_id, purpose, case_id, input_version, snapshot_digest
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    tenant_id, purpose, case_id, source_input_version,
    cognitive_policy_version, cognitive_revision, cognitive_digest
  ) REFERENCES ros_eye_cognitive_input_snapshot_bindings (
    tenant_id, purpose, case_id, input_version,
    policy_version, cognitive_revision, cognitive_digest
  ) ON DELETE RESTRICT,
  CONSTRAINT closure_authorization_journal_source_complete CHECK (
    (source_input_version IS NULL
      AND source_snapshot_digest IS NULL
      AND cognitive_policy_version IS NULL
      AND cognitive_revision IS NULL
      AND cognitive_digest IS NULL)
    OR (
      source_input_version IS NOT NULL
      AND source_snapshot_digest IS NOT NULL
      AND cognitive_policy_version IS NOT NULL
      AND cognitive_revision IS NOT NULL
      AND cognitive_digest IS NOT NULL
      AND source_input_version > 0
      AND source_snapshot_digest ~ '^[a-f0-9]{64}$'
      AND cognitive_policy_version = 'ros-eye.input-snapshot.v2'
      AND cognitive_revision > 0
      AND cognitive_digest ~ '^[a-f0-9]{64}$'
    )
  )
);

CREATE OR REPLACE FUNCTION reject_closure_authorization_journal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RoadEvent closure authorization journal is append-only';
END;
$$;

CREATE TRIGGER road_event_closure_authorization_journal_append_only
BEFORE UPDATE OR DELETE ON road_event_closure_authorization_journal
FOR EACH ROW EXECUTE FUNCTION reject_closure_authorization_journal_mutation();

COMMENT ON TABLE road_event_closure_authorization_journal IS
  'Append-only human closure authorizations. Each scoped event version preserves the exact source identity reviewed by a human; no row grants autonomous closure or activation authority.';

COMMIT;
