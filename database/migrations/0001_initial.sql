CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE road_event_status AS ENUM (
  'DETECTED', 'VALIDATING', 'CONFIRMED', 'SAFETY_ASSESSMENT',
  'RESPONSE_COORDINATION', 'ROAD_CLEARANCE', 'RECOVERY', 'CLOSED',
  'FALSE_POSITIVE', 'DUPLICATE', 'UNDER_REVIEW', 'TRANSFERRED_TO_AUTHORITY'
);

CREATE TYPE severity_level AS ENUM ('S0', 'S1', 'S2', 'S3', 'S4');

CREATE TABLE road_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status road_event_status NOT NULL DEFAULT 'DETECTED',
  severity severity_level NOT NULL DEFAULT 'S0',
  severity_score SMALLINT NOT NULL DEFAULT 0 CHECK (severity_score BETWEEN 0 AND 100),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  impact_radius_meters INTEGER NOT NULL DEFAULT 50 CHECK (impact_radius_meters > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  assigned_operator_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX road_events_location_gix ON road_events USING GIST (location);
CREATE INDEX road_events_active_idx ON road_events (status, severity, detected_at DESC)
WHERE status NOT IN ('CLOSED', 'FALSE_POSITIVE', 'DUPLICATE');

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  accuracy_meters NUMERIC(8,2),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  quality_score SMALLINT CHECK (quality_score BETWEEN 0 AND 100),
  confidence NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, external_id)
);

CREATE INDEX signals_location_gix ON signals USING GIST (location);
CREATE INDEX signals_time_idx ON signals (occurred_at DESC);

CREATE TABLE road_event_signals (
  road_event_id UUID NOT NULL REFERENCES road_events(id),
  signal_id UUID NOT NULL REFERENCES signals(id),
  match_score NUMERIC(5,4) NOT NULL CHECK (match_score BETWEEN 0 AND 1),
  merge_reason TEXT[] NOT NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (road_event_id, signal_id)
);

CREATE TABLE road_event_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  road_event_id UUID NOT NULL REFERENCES road_events(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  trace_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX road_event_timeline_idx ON road_event_timeline (road_event_id, occurred_at);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  correlation_id UUID NOT NULL,
  causation_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX outbox_unpublished_idx ON outbox_events (occurred_at)
WHERE published_at IS NULL;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  trace_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
