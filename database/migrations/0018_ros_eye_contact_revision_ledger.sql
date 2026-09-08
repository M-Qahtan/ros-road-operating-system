BEGIN;

CREATE TABLE ros_eye_contact_revision_ledger (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status = 'PRESENT'),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, revision),
  FOREIGN KEY (tenant_id, purpose, case_id)
    REFERENCES road_events(tenant_id, purpose, id)
    ON DELETE RESTRICT,
  CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  CHECK (length(btrim(purpose)) BETWEEN 1 AND 128)
);

CREATE INDEX ros_eye_contact_revision_ledger_latest_idx
  ON ros_eye_contact_revision_ledger
  (tenant_id, purpose, case_id, revision DESC);

CREATE OR REPLACE FUNCTION reject_ros_eye_contact_revision_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Contact authoritative revisions are append-only';
END;
$$;

CREATE TRIGGER ros_eye_contact_revision_ledger_append_only
BEFORE UPDATE OR DELETE ON ros_eye_contact_revision_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_contact_revision_ledger_mutation();

COMMENT ON TABLE ros_eye_contact_revision_ledger IS
  'Contact-owned case-level revision receipts. Absence is established only by an exact scoped read of the authoritative contact table. ROS Brain has read-only access and no contact authority.';

COMMIT;
