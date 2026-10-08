\set ON_ERROR_STOP on
-- Isolated CI recovery marker. NEVER run against production or shared databases.
BEGIN;
INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence,
  reason_codes, severity_requires_human_review, location, occurred_at, version
) VALUES (
  'eeee0000-0000-4000-8000-000000000176', 'ros-recovery-ci',
  'incident-triage-simulation', 'DETECTED', 'S2', 42, 0.800,
  ARRAY['restore_roundtrip_probe'], TRUE,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-10-08T00:00:00Z', 7
);
INSERT INTO outbox_events (
  id, aggregate_type, aggregate_id, event_type, payload, correlation_id,
  trace_id, tenant_id, purpose, occurred_at
) VALUES (
  'eeee0000-0000-4000-8000-000000000177', 'RoadEvent',
  'eeee0000-0000-4000-8000-000000000176', 'RestoreProbe',
  '{"version":7,"drill":true}'::jsonb,
  'eeee0000-0000-4000-8000-000000000180',
  'eeee0000-0000-4000-8000-000000000181',
  'ros-recovery-ci', 'incident-triage-simulation', '2026-10-08T00:00:00Z'
);
INSERT INTO audit_logs (
  id, actor_type, action, resource_type, resource_id,
  after_state, reason, trace_id, occurred_at
) VALUES (
  'eeee0000-0000-4000-8000-000000000178', 'SYSTEM',
  'restore.roundtrip.probe', 'RoadEvent',
  'eeee0000-0000-4000-8000-000000000176',
  '{"version":7,"status":"DETECTED"}'::jsonb,
  'isolated CI recovery drill only',
  'eeee0000-0000-4000-8000-000000000181', '2026-10-08T00:00:00Z'
);
INSERT INTO idempotency_records (
  scope, idempotency_key, fingerprint, response, created_at
) VALUES (
  'ros-recovery-ci', 'restore-probe-176',
  encode(digest('restore-probe-176','sha256'),'hex'),
  '{"outcome":"seeded"}'::jsonb, '2026-10-08T00:00:00Z'
);
INSERT INTO idempotency_reservations (
  scope, idempotency_key, fence_token, acquired_at
) VALUES (
  'ros-recovery-ci', 'restore-fence-176',
  'eeee0000-0000-4000-8000-000000000179', '2026-10-08T00:00:00Z'
);
COMMIT;
