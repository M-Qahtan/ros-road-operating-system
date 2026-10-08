\set ON_ERROR_STOP on
-- Read-only, fail-closed round-trip assertions on source and restored CI databases.
DO $ros_restore$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'restore round-trip: PostGIS extension missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM road_events
    WHERE id = 'eeee0000-0000-4000-8000-000000000176'
      AND tenant_id = 'ros-recovery-ci'
      AND purpose = 'incident-triage-simulation'
      AND status = 'DETECTED' AND severity = 'S2' AND version = 7
      AND severity_requires_human_review
      AND reason_codes = ARRAY['restore_roundtrip_probe']::text[]
      AND abs(ST_X(location::geometry) - 46.6753) < 0.000001
      AND abs(ST_Y(location::geometry) - 24.7136) < 0.000001
  ) THEN RAISE EXCEPTION 'restore round-trip: scoped RoadEvent/PostGIS data missing or altered'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events
    WHERE id = 'eeee0000-0000-4000-8000-000000000177'
      AND aggregate_type = 'RoadEvent'
      AND aggregate_id = 'eeee0000-0000-4000-8000-000000000176'
      AND tenant_id = 'ros-recovery-ci'
      AND purpose = 'incident-triage-simulation'
      AND payload @> '{"version":7,"drill":true}'::jsonb
      AND published_at IS NULL AND dead_lettered_at IS NULL
  ) THEN RAISE EXCEPTION 'restore round-trip: scoped transactional Outbox record missing or altered'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE id = 'eeee0000-0000-4000-8000-000000000178'
      AND action = 'restore.roundtrip.probe'
      AND resource_id = 'eeee0000-0000-4000-8000-000000000176'
      AND trace_id = 'eeee0000-0000-4000-8000-000000000181'
      AND after_state @> '{"version":7,"status":"DETECTED"}'::jsonb
  ) THEN RAISE EXCEPTION 'restore round-trip: durable Audit record missing or altered'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM idempotency_records
    WHERE scope = 'ros-recovery-ci' AND idempotency_key = 'restore-probe-176'
      AND fingerprint = encode(digest('restore-probe-176','sha256'),'hex')
      AND response @> '{"outcome":"seeded"}'::jsonb
  ) THEN RAISE EXCEPTION 'restore round-trip: immutable replay record missing or altered'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM idempotency_reservations
    WHERE scope = 'ros-recovery-ci' AND idempotency_key = 'restore-fence-176'
      AND fence_token = 'eeee0000-0000-4000-8000-000000000179'
  ) THEN RAISE EXCEPTION 'restore round-trip: durable idempotency fence missing or altered'; END IF;
END
$ros_restore$;
