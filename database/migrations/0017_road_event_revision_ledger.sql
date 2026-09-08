BEGIN;

ALTER TABLE road_events
  ADD CONSTRAINT road_events_scoped_identity_unique
  UNIQUE (tenant_id, purpose, id);

CREATE TABLE road_event_revision_ledger (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  case_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('CASE', 'SEVERITY')),
  revision integer NOT NULL CHECK (revision > 0),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, purpose, case_id, component, revision),
  FOREIGN KEY (tenant_id, purpose, case_id)
    REFERENCES road_events(tenant_id, purpose, id)
    ON DELETE RESTRICT,
  CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  CHECK (length(btrim(purpose)) BETWEEN 1 AND 128)
);

CREATE INDEX road_event_revision_ledger_latest_idx
  ON road_event_revision_ledger
  (tenant_id, purpose, case_id, component, revision DESC);

CREATE OR REPLACE FUNCTION reject_road_event_revision_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RoadEvent authoritative revisions are append-only';
END;
$$;

CREATE TRIGGER road_event_revision_ledger_append_only
BEFORE UPDATE OR DELETE ON road_event_revision_ledger
FOR EACH ROW EXECUTE FUNCTION reject_road_event_revision_ledger_mutation();

COMMENT ON TABLE road_event_revision_ledger IS
  'RoadEvent-owned case and severity revision receipts. ROS Brain has read-only recommendation scope and receives no authority to mint, update, or delete these records.';

COMMIT;
