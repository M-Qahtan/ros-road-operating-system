\set ON_ERROR_STOP on
BEGIN;

INSERT INTO road_events (
  id, tenant_id, purpose, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version,
  closure_authorized_by, closure_authorized_at, closure_authorization_reason
) VALUES (
  '90000000-0000-4000-8000-000000000001',
  'riyadh-pilot', 'road-safety-response',
  'CLOSED', 'S3', 78, 0.940,
  ARRAY['occupant_unresponsive','multi_signal_confirmation'], TRUE,
  ST_SetSRID(ST_MakePoint(46.6753,24.7136),4326)::geography,
  '2026-07-25T10:00:00Z', 10,
  '90000000-0000-4000-8000-000000000011', '2026-07-25T10:20:00Z',
  'Supervisor verified safety and restored road'
);

INSERT INTO signals (id, external_id, source_type, occurred_at, location, payload)
VALUES
('90000000-0000-4000-8000-000000000101','pilot-a','PHONE','2026-07-25T10:00:00Z',ST_SetSRID(ST_MakePoint(46.6753,24.7136),4326)::geography,'{}'),
('90000000-0000-4000-8000-000000000102','pilot-b','CCTV','2026-07-25T10:00:02Z',ST_SetSRID(ST_MakePoint(46.6753,24.7136),4326)::geography,'{}');

INSERT INTO road_event_signals (road_event_id, signal_id, match_score, merge_reason)
VALUES
('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000101',0.96,ARRAY['same_location','same_time_window']),
('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000102',0.96,ARRAY['same_location','same_time_window']);

INSERT INTO evidence_objects (
  id, road_event_id, object_key, original_filename, content_type,
  declared_size_bytes, actual_size_bytes, declared_checksum_sha256,
  verified_checksum_sha256, status, upload_expires_at, retain_until,
  created_by, created_at, completed_at
) VALUES (
  '90000000-0000-4000-8000-000000000201',
  '90000000-0000-4000-8000-000000000001',
  'pilot/90000000-0000-4000-8000-000000000001/evidence-001',
  'incident.jpg','image/jpeg',1024,1024,repeat('a',64),repeat('a',64),
  'PRESERVED','2026-07-25T10:05:00Z','2027-07-25T10:00:00Z',
  '90000000-0000-4000-8000-000000000010','2026-07-25T10:01:00Z','2026-07-25T10:02:00Z'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM road_event_signals WHERE road_event_id='90000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'pilot signals did not correlate to one RoadEvent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM road_events
    WHERE id='90000000-0000-4000-8000-000000000001'
      AND tenant_id='riyadh-pilot'
      AND purpose='road-safety-response'
      AND status='CLOSED'
      AND severity='S3'
      AND closure_authorized_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'safe scoped S3 closure invariant missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence_objects WHERE road_event_id='90000000-0000-4000-8000-000000000001' AND status='PRESERVED') THEN
    RAISE EXCEPTION 'pilot evidence was not preserved';
  END IF;
END;
$$;

ROLLBACK;
