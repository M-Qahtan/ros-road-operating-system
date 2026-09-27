BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT causation_id
      FROM audit_logs
     WHERE resource_type = 'RoadEvent'
       AND action = 'road_event.closed'
       AND before_state -> 'closureAuthorization' IS DISTINCT FROM 'null'::jsonb
       AND causation_id IS NOT NULL
     GROUP BY causation_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing high-risk RoadEvent closure audit cause was consumed more than once'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE UNIQUE INDEX audit_logs_road_event_closure_cause_once_idx
  ON audit_logs (causation_id)
  WHERE resource_type = 'RoadEvent'
    AND action = 'road_event.closed'
    AND before_state -> 'closureAuthorization' IS DISTINCT FROM 'null'::jsonb
    AND causation_id IS NOT NULL;

COMMENT ON INDEX audit_logs_road_event_closure_cause_once_idx IS
  'Consumes each high-risk human authorization audit cause at most once. This grants no operational or activation authority.';

COMMIT;
