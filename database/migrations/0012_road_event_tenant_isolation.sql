ALTER TABLE road_events
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT road_events_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX road_events_tenant_active_idx
  ON road_events (tenant_id, status, severity, detected_at DESC)
  WHERE status NOT IN ('CLOSED', 'FALSE_POSITIVE', 'DUPLICATE');

ALTER TABLE signals
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT signals_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX signals_tenant_time_idx
  ON signals (tenant_id, occurred_at DESC);

ALTER TABLE road_event_signals
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT road_event_signals_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX road_event_signals_tenant_event_idx
  ON road_event_signals (tenant_id, road_event_id, attached_at);

ALTER TABLE road_event_timeline
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT road_event_timeline_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX road_event_timeline_tenant_event_idx
  ON road_event_timeline (tenant_id, road_event_id, occurred_at);

ALTER TABLE audit_logs
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT audit_logs_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX audit_logs_tenant_resource_idx
  ON audit_logs (tenant_id, resource_type, resource_id, occurred_at);

ALTER TABLE outbox_events
  ADD COLUMN tenant_id TEXT,
  ADD CONSTRAINT outbox_events_tenant_present
    CHECK (tenant_id IS NOT NULL AND length(trim(tenant_id)) BETWEEN 1 AND 128) NOT VALID;

CREATE INDEX outbox_events_tenant_unpublished_idx
  ON outbox_events (tenant_id, occurred_at)
  WHERE published_at IS NULL;

COMMENT ON COLUMN road_events.tenant_id IS
  'Authoritative resource owner. NULL is allowed only for pre-migration legacy rows, which tenant-scoped runtime queries must treat as inaccessible until explicit reconciliation.';

COMMENT ON CONSTRAINT road_events_tenant_present ON road_events IS
  'NOT VALID preserves legacy rows while enforcing tenant ownership on every new or updated RoadEvent.';

COMMENT ON CONSTRAINT signals_tenant_present ON signals IS
  'New signals must be tenant-owned before they can participate in tenant-scoped correlation.';

COMMENT ON CONSTRAINT audit_logs_tenant_present ON audit_logs IS
  'New audit records must carry the same tenant ownership as the resource operation.';
