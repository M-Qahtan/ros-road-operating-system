\set ON_ERROR_STOP on

BEGIN;

INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'riyadh-pilot', 'road-safety-response',
  'DETECTED', 'S1', 20, 0.700, ARRAY['evidence_test'], TRUE,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-07-25T04:00:00.000Z', 1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO evidence_objects (
  id, road_event_id, object_key, original_filename, content_type,
  declared_size_bytes, declared_checksum_sha256, status,
  upload_expires_at, retain_until, legal_hold, created_by, created_at
) VALUES (
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'road-events/70000000-0000-4000-8000-000000000001/evidence/70000000-0000-4000-8000-000000000002/frame.jpg',
  'frame.jpg', 'image/jpeg', 1024, repeat('a', 64), 'PENDING_UPLOAD',
  '2026-07-25T04:10:00.000Z', '2027-07-25T00:00:00.000Z', FALSE,
  'operator-a', '2026-07-25T04:00:00.000Z'
);

INSERT INTO evidence_audit_logs (
  evidence_id, road_event_id, actor_id, action, before_state, after_state, trace_id, occurred_at
) VALUES (
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'operator-a', 'evidence.upload_intent_created', NULL,
  '{"status":"PENDING_UPLOAD"}'::jsonb, 'trace-evidence-test', '2026-07-25T04:00:00.000Z'
);

UPDATE evidence_objects
SET status = 'PRESERVED', actual_size_bytes = 1024,
    verified_checksum_sha256 = repeat('a', 64),
    completed_at = '2026-07-25T04:01:00.000Z'
WHERE id = '70000000-0000-4000-8000-000000000002';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM evidence_objects
    WHERE id = '70000000-0000-4000-8000-000000000002'
      AND status = 'PRESERVED'
      AND actual_size_bytes = 1024
      AND verified_checksum_sha256 = repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'Evidence preservation metadata was not stored';
  END IF;

  BEGIN
    UPDATE evidence_objects
    SET object_key = 'tampered/key'
    WHERE id = '70000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION USING ERRCODE = 'ZX101', MESSAGE = 'Expected immutable metadata update to fail';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  BEGIN
    UPDATE evidence_audit_logs SET action = 'tampered';
    RAISE EXCEPTION USING ERRCODE = 'ZX102', MESSAGE = 'Expected audit update to fail';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  BEGIN
    DELETE FROM evidence_audit_logs;
    RAISE EXCEPTION USING ERRCODE = 'ZX103', MESSAGE = 'Expected audit delete to fail';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END;
$$;

INSERT INTO evidence_objects (
  id, road_event_id, object_key, original_filename, content_type,
  declared_size_bytes, declared_checksum_sha256, status,
  upload_expires_at, retain_until, legal_hold, created_by, created_at
) VALUES (
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000001',
  'road-events/70000000-0000-4000-8000-000000000001/evidence/70000000-0000-4000-8000-000000000003/file.bin',
  'file.bin', 'application/octet-stream', 512, repeat('b', 64), 'PENDING_UPLOAD',
  '2026-07-25T04:10:00.000Z', '2027-07-25T00:00:00.000Z', TRUE,
  'operator-a', '2026-07-25T04:00:00.000Z'
);

UPDATE evidence_objects
SET status = 'QUARANTINED', completed_at = '2026-07-25T04:02:00.000Z',
    quarantine_reason = 'safe test signature matched'
WHERE id = '70000000-0000-4000-8000-000000000003';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM evidence_objects
    WHERE id = '70000000-0000-4000-8000-000000000003'
      AND status = 'QUARANTINED'
      AND object_key IS NOT NULL
      AND quarantine_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Quarantined evidence metadata is not queryable';
  END IF;
END;
$$;

ROLLBACK;
