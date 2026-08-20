ALTER TABLE outbox_events
  ADD COLUMN tenant_id TEXT,
  ADD COLUMN purpose TEXT;

UPDATE outbox_events AS o
SET tenant_id = r.tenant_id,
    purpose = r.purpose
FROM road_events AS r
WHERE o.aggregate_type = 'RoadEvent'
  AND o.aggregate_id = r.id
  AND r.tenant_id <> '__ros_legacy_unscoped__'
  AND r.purpose <> '__ros_legacy_unscoped__';

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_tenant_id_valid CHECK (
    tenant_id IS NULL OR length(btrim(tenant_id)) BETWEEN 1 AND 128
  ),
  ADD CONSTRAINT outbox_purpose_valid CHECK (
    purpose IS NULL OR length(btrim(purpose)) BETWEEN 1 AND 128
  ),
  ADD CONSTRAINT outbox_road_event_scope_required CHECK (
    aggregate_type <> 'RoadEvent' OR (tenant_id IS NOT NULL AND purpose IS NOT NULL)
  ) NOT VALID;

CREATE INDEX outbox_road_event_scope_idx
  ON outbox_events (tenant_id, purpose, occurred_at, id)
  WHERE aggregate_type = 'RoadEvent';

COMMENT ON COLUMN outbox_events.tenant_id IS
  'Trusted tenant scope copied from the aggregate at the transactional outbox boundary.';
COMMENT ON COLUMN outbox_events.purpose IS
  'Trusted purpose-of-use scope copied from the aggregate at the transactional outbox boundary.';
COMMENT ON CONSTRAINT outbox_road_event_scope_required ON outbox_events IS
  'Enforced for new/updated rows. Legacy unscoped RoadEvent messages remain invalid until reconciled and are excluded from delivery.';
