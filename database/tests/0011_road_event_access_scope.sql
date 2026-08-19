BEGIN;

INSERT INTO road_events (
  id,
  status,
  severity,
  severity_score,
  confidence,
  reason_codes,
  location,
  occurred_at
) VALUES (
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'DETECTED',
  'S1',
  20,
  0.900,
  ARRAY['abac_scope_fixture']::text[],
  ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326)::geography,
  '2026-08-19T22:00:00Z'::timestamptz
), (
  'a2222222-2222-4222-8222-222222222222'::uuid,
  'DETECTED',
  'S1',
  20,
  0.900,
  ARRAY['legacy_unscoped_fixture']::text[],
  ST_SetSRID(ST_MakePoint(46.6754, 24.7137), 4326)::geography,
  '2026-08-19T22:00:01Z'::timestamptz
);

INSERT INTO road_event_access_scopes (road_event_id, tenant_id, purpose)
VALUES (
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'riyadh-ops',
  'ROAD_SAFETY_OPERATIONS'
);

DO $$
DECLARE
  exact_count integer;
  other_tenant_count integer;
  other_purpose_count integer;
  legacy_scoped_count integer;
BEGIN
  SELECT count(*) INTO exact_count
  FROM road_events re
  INNER JOIN road_event_access_scopes scope ON scope.road_event_id = re.id
  WHERE re.id = 'a1111111-1111-4111-8111-111111111111'::uuid
    AND scope.tenant_id = 'riyadh-ops'
    AND scope.purpose = 'ROAD_SAFETY_OPERATIONS';

  IF exact_count <> 1 THEN
    RAISE EXCEPTION 'exact RoadEvent tenant/purpose scope was not visible';
  END IF;

  SELECT count(*) INTO other_tenant_count
  FROM road_events re
  INNER JOIN road_event_access_scopes scope ON scope.road_event_id = re.id
  WHERE re.id = 'a1111111-1111-4111-8111-111111111111'::uuid
    AND scope.tenant_id = 'other-tenant'
    AND scope.purpose = 'ROAD_SAFETY_OPERATIONS';

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant RoadEvent scope leaked';
  END IF;

  SELECT count(*) INTO other_purpose_count
  FROM road_events re
  INNER JOIN road_event_access_scopes scope ON scope.road_event_id = re.id
  WHERE re.id = 'a1111111-1111-4111-8111-111111111111'::uuid
    AND scope.tenant_id = 'riyadh-ops'
    AND scope.purpose = 'AUDIT_REVIEW';

  IF other_purpose_count <> 0 THEN
    RAISE EXCEPTION 'wrong-purpose RoadEvent scope leaked';
  END IF;

  SELECT count(*) INTO legacy_scoped_count
  FROM road_events re
  INNER JOIN road_event_access_scopes scope ON scope.road_event_id = re.id
  WHERE re.id = 'a2222222-2222-4222-8222-222222222222'::uuid;

  IF legacy_scoped_count <> 0 THEN
    RAISE EXCEPTION 'unscoped legacy RoadEvent unexpectedly acquired access scope';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE road_event_access_scopes
    SET tenant_id = 'other-tenant'
    WHERE road_event_id = 'a1111111-1111-4111-8111-111111111111'::uuid;
    RAISE EXCEPTION 'access scope mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'access scope mutation unexpectedly succeeded' THEN
        RAISE;
      END IF;
      IF SQLERRM <> 'road_event_access_scopes is immutable' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    DELETE FROM road_event_access_scopes
    WHERE road_event_id = 'a1111111-1111-4111-8111-111111111111'::uuid;
    RAISE EXCEPTION 'access scope deletion unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'access scope deletion unexpectedly succeeded' THEN
        RAISE;
      END IF;
      IF SQLERRM <> 'road_event_access_scopes is immutable' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
