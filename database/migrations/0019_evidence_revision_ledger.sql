BEGIN;

CREATE TABLE evidence_revision_ledger (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
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

CREATE INDEX evidence_revision_ledger_latest_idx
  ON evidence_revision_ledger
  (tenant_id, purpose, case_id, revision DESC);

CREATE OR REPLACE FUNCTION reject_evidence_revision_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence authoritative revisions are append-only';
END;
$$;

CREATE TRIGGER evidence_revision_ledger_append_only
BEFORE UPDATE OR DELETE ON evidence_revision_ledger
FOR EACH ROW EXECUTE FUNCTION reject_evidence_revision_ledger_mutation();

COMMENT ON TABLE evidence_revision_ledger IS
  'Evidence-owned case-level revision receipts binding metadata and integrity state. ROS Brain has read-only access and no upload, download, scan, retention, or mutation authority.';

COMMIT;
