BEGIN;

CREATE TABLE IF NOT EXISTS road_event_access_scopes (
  road_event_id uuid PRIMARY KEY REFERENCES road_events(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL CHECK (
    char_length(tenant_id) BETWEEN 1 AND 128
    AND tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  purpose text NOT NULL CHECK (
    char_length(purpose) BETWEEN 1 AND 128
    AND purpose ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS road_event_access_scopes_tenant_purpose_idx
  ON road_event_access_scopes (tenant_id, purpose, road_event_id);

CREATE OR REPLACE FUNCTION reject_road_event_access_scope_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'road_event_access_scopes is immutable';
END;
$$;

DROP TRIGGER IF EXISTS road_event_access_scopes_immutable ON road_event_access_scopes;
CREATE TRIGGER road_event_access_scopes_immutable
BEFORE UPDATE OR DELETE ON road_event_access_scopes
FOR EACH ROW EXECUTE FUNCTION reject_road_event_access_scope_mutation();

COMMENT ON TABLE road_event_access_scopes IS
  'Immutable RoadEvent tenant/purpose binding. RoadEvents without a binding are intentionally inaccessible to scoped runtime reads or mutations.';

COMMIT;
