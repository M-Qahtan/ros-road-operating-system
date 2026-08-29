ALTER TABLE road_events
  ADD COLUMN reporter_actor_id uuid;

CREATE INDEX road_events_reporter_scope_idx
  ON road_events (tenant_id, purpose, reporter_actor_id, occurred_at DESC, id DESC)
  WHERE reporter_actor_id IS NOT NULL;

COMMENT ON COLUMN road_events.reporter_actor_id IS
  'Trusted OIDC subject that created a FIELD_USER report. NULL denotes a non-FIELD_USER or legacy report; FIELD_USER resource reads must match this value.';

ALTER TABLE ros_eye_contact_sessions
  ADD COLUMN owner_actor_id uuid;

CREATE INDEX ros_eye_contact_owner_idx
  ON ros_eye_contact_sessions (tenant_id, case_id, owner_actor_id)
  WHERE owner_actor_id IS NOT NULL;

COMMENT ON COLUMN ros_eye_contact_sessions.owner_actor_id IS
  'Immutable trusted reporter subject copied from the parent RoadEvent when contact orchestration opens. FIELD_USER callbacks must match this value.';

CREATE TABLE field_companion_devices (
  device_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  actor_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform = 'WEB'),
  app_version text NOT NULL CHECK (app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  status text NOT NULL CHECK (status = 'ACTIVE'),
  consent_policy_version text NOT NULL CHECK (consent_policy_version = 'ros-field-companion-device-registration-consent/v1'),
  client_consented_at timestamptz NOT NULL,
  consent_granted_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  CHECK (consent_granted_at >= registered_at),
  CHECK (last_seen_at >= registered_at)
);

CREATE INDEX field_companion_devices_actor_scope_idx
  ON field_companion_devices (tenant_id, purpose, actor_id, last_seen_at DESC);

COMMENT ON TABLE field_companion_devices IS
  'Durable trusted-principal registration and consent receipt only. It does not represent device attestation or store a push token.';

CREATE TABLE field_notification_deliveries (
  tenant_id text NOT NULL,
  purpose text NOT NULL,
  notification_id uuid NOT NULL REFERENCES road_events(id) ON DELETE RESTRICT,
  recipient_actor_id uuid NOT NULL,
  delivered_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  PRIMARY KEY (tenant_id, purpose, notification_id, recipient_actor_id),
  CHECK (acknowledged_at IS NULL OR acknowledged_at >= delivered_at)
);

CREATE INDEX field_notification_deliveries_recipient_idx
  ON field_notification_deliveries (tenant_id, purpose, recipient_actor_id, delivered_at DESC);

COMMENT ON TABLE field_notification_deliveries IS
  'Server-side tracking that a sanitized nearby hazard projection was returned to one trusted actor. It does not claim push or websocket delivery.';
