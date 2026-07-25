\set ON_ERROR_STOP on

BEGIN;

TRUNCATE TABLE road_event_signals, road_event_timeline, signals, outbox_events, audit_logs, road_events CASCADE;

INSERT INTO road_events (
  id, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'DETECTED', 'S2', 45, 0.800, ARRAY['multi_signal_confirmation'], TRUE,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-07-25T02:55:00.000Z', 1
);

DO $$
DECLARE
  changed_rows INTEGER;
  stored_latitude DOUBLE PRECISION;
  stored_longitude DOUBLE PRECISION;
BEGIN
  SELECT ST_Y(location::geometry), ST_X(location::geometry)
    INTO stored_latitude, stored_longitude
    FROM road_events
    WHERE id = '11111111-1111-4111-8111-111111111111';

  IF abs(stored_latitude - 24.7136) > 0.000001 OR abs(stored_longitude - 46.6753) > 0.000001 THEN
    RAISE EXCEPTION 'PostGIS coordinates were not preserved';
  END IF;

  UPDATE road_events
    SET status = 'VALIDATING', version = 2
    WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 1;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RAISE EXCEPTION 'Expected the first optimistic update to affect one row'; END IF;

  UPDATE road_events
    SET status = 'CONFIRMED', version = 3
    WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 1;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 0 THEN RAISE EXCEPTION 'Stale optimistic update unexpectedly succeeded'; END IF;
END;
$$;

SAVEPOINT atomic_write;
UPDATE road_events
  SET status = 'CONFIRMED', version = 3
  WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 2;
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id
) VALUES (
  'OPERATOR', '22222222-2222-4222-8222-222222222222', 'road_event.confirmed',
  'RoadEvent', '11111111-1111-4111-8111-111111111111',
  '{"version":2}'::jsonb, '{"version":3}'::jsonb, 'integration rollback proof',
  '33333333-3333-4333-8333-333333333333'
);
INSERT INTO outbox_events (
  aggregate_type, aggregate_id, event_type, payload, correlation_id
) VALUES (
  'RoadEvent', '11111111-1111-4111-8111-111111111111', 'RoadEventConfirmed',
  '{"version":3}'::jsonb, '44444444-4444-4444-8444-444444444444'
);
ROLLBACK TO SAVEPOINT atomic_write;

DO $$
BEGIN
  IF (SELECT version FROM road_events WHERE id = '11111111-1111-4111-8111-111111111111') <> 2 THEN
    RAISE EXCEPTION 'RoadEvent update was not rolled back atomically';
  END IF;
  IF (SELECT count(*) FROM audit_logs) <> 0 OR (SELECT count(*) FROM outbox_events) <> 0 THEN
    RAISE EXCEPTION 'Audit or outbox write escaped the rolled-back transaction';
  END IF;
END;
$$;

UPDATE road_events
  SET status = 'CONFIRMED', version = 3
  WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 2;
INSERT INTO audit_logs (
  actor_type, actor_id, action, resource_type, resource_id,
  before_state, after_state, reason, trace_id
) VALUES (
  'OPERATOR', '22222222-2222-4222-8222-222222222222', 'road_event.confirmed',
  'RoadEvent', '11111111-1111-4111-8111-111111111111',
  '{"version":2}'::jsonb, '{"version":3}'::jsonb, 'integration commit proof',
  '33333333-3333-4333-8333-333333333333'
);
INSERT INTO outbox_events (
  aggregate_type, aggregate_id, event_type, payload, correlation_id
) VALUES (
  'RoadEvent', '11111111-1111-4111-8111-111111111111', 'RoadEventConfirmed',
  '{"version":3}'::jsonb, '44444444-4444-4444-8444-444444444444'
);

DO $$
BEGIN
  IF (SELECT version FROM road_events WHERE id = '11111111-1111-4111-8111-111111111111') <> 3 THEN
    RAISE EXCEPTION 'Committed RoadEvent version is incorrect';
  END IF;
  IF (SELECT count(*) FROM audit_logs) <> 1 OR (SELECT count(*) FROM outbox_events) <> 1 THEN
    RAISE EXCEPTION 'Atomic audit/outbox writes are missing';
  END IF;
END;
$$;

UPDATE road_events
SET status = 'RECOVERY', severity = 'S3', severity_score = 75,
    severity_requires_human_review = TRUE, reason_codes = ARRAY['high_impact'], version = 4
WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 3;

DO $$
BEGIN
  BEGIN
    UPDATE road_events
      SET status = 'CLOSED', version = 5
      WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 4;
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'Expected S3 closure without authorization to fail';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE road_events
SET status = 'CLOSED', version = 5,
    closure_authorized_by = '22222222-2222-4222-8222-222222222222',
    closure_authorized_at = '2026-07-25T03:10:00.000Z',
    closure_authorization_reason = 'Scene verified safe by supervisor'
WHERE id = '11111111-1111-4111-8111-111111111111' AND version = 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM road_events
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND status = 'CLOSED' AND version = 5
      AND closure_authorized_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Authorized high-severity closure was not persisted';
  END IF;

  BEGIN
    UPDATE audit_logs SET action = 'tampered';
    RAISE EXCEPTION USING ERRCODE = 'ZX002', MESSAGE = 'Expected append-only audit trigger to reject update';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END;
$$;

ROLLBACK;
