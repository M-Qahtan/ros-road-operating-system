BEGIN;

CREATE TABLE human_safety_indicator_revision_ledger (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  indicator_set jsonb NOT NULL CHECK (jsonb_typeof(indicator_set) = 'array' AND jsonb_array_length(indicator_set) > 0),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  recorded_by uuid NOT NULL,
  recorded_by_role text NOT NULL CHECK (recorded_by_role IN ('OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD')),
  trace_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, revision),
  FOREIGN KEY (tenant_id, purpose, case_id)
    REFERENCES road_events(tenant_id, purpose, id)
    ON DELETE RESTRICT,
  CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  CHECK (length(btrim(purpose)) BETWEEN 1 AND 128)
);

CREATE INDEX human_safety_indicator_revision_latest_idx
  ON human_safety_indicator_revision_ledger (tenant_id, purpose, case_id, revision DESC);

CREATE OR REPLACE FUNCTION reject_human_safety_indicator_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Human Safety indicator revisions are append-only';
END;
$$;

CREATE TRIGGER human_safety_indicator_revision_append_only
BEFORE UPDATE OR DELETE ON human_safety_indicator_revision_ledger
FOR EACH ROW EXECUTE FUNCTION reject_human_safety_indicator_revision_mutation();

COMMENT ON TABLE human_safety_indicator_revision_ledger IS
  'Human-Safety-owned structured indicator history. Recording requires human authority; ROS Brain receives only read-only revision receipts and no collection, severity, closure, or actuation authority.';

COMMIT;
