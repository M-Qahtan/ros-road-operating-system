INSERT INTO road_events (
  id, status, severity, severity_score, confidence, reason_codes,
  severity_requires_human_review, location, occurred_at, version
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'DETECTED',
  'S1',
  20,
  0.650,
  ARRAY['local_seed'],
  TRUE,
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-07-25T00:00:00.000Z',
  1
) ON CONFLICT (id) DO NOTHING;
