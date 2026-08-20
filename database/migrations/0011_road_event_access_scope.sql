ALTER TABLE road_events
  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '__ros_legacy_unscoped__',
  ADD COLUMN purpose TEXT NOT NULL DEFAULT '__ros_legacy_unscoped__';

ALTER TABLE road_events
  ALTER COLUMN tenant_id DROP DEFAULT,
  ALTER COLUMN purpose DROP DEFAULT,
  ADD CONSTRAINT road_events_tenant_id_nonempty CHECK (length(btrim(tenant_id)) BETWEEN 1 AND 128),
  ADD CONSTRAINT road_events_purpose_nonempty CHECK (length(btrim(purpose)) BETWEEN 1 AND 128);

CREATE INDEX road_events_scope_time_idx
  ON road_events (tenant_id, purpose, occurred_at DESC, id DESC);

COMMENT ON COLUMN road_events.tenant_id IS
  'Server-side authorization scope. Legacy rows use an application-invalid sentinel and remain inaccessible until explicitly backfilled.';
COMMENT ON COLUMN road_events.purpose IS
  'Purpose-of-use authorization scope. Reads and writes must match both tenant_id and purpose.';
