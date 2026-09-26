BEGIN;

ALTER TABLE audit_logs
  ADD CONSTRAINT road_event_audit_correlation_matches_resource CHECK (
    resource_type <> 'RoadEvent' OR correlation_id = resource_id
  ),
  ADD CONSTRAINT road_event_authorization_audit_has_no_cause CHECK (
    action <> 'road_event.closure_authorized' OR causation_id IS NULL
  ),
  ADD CONSTRAINT road_event_closure_audit_cause_shape CHECK (
    action <> 'road_event.closed'
    OR (
      before_state -> 'closureAuthorization' IS NOT DISTINCT FROM 'null'::jsonb
      AND causation_id IS NULL
    )
    OR (
      before_state ? 'closureAuthorization'
      AND before_state -> 'closureAuthorization' IS DISTINCT FROM 'null'::jsonb
      AND causation_id IS NOT NULL
    )
  );

CREATE INDEX audit_logs_road_event_trace_idx
  ON audit_logs (resource_id, trace_id)
  WHERE resource_type = 'RoadEvent';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM audit_logs closure
     WHERE closure.resource_type = 'RoadEvent'
       AND closure.action = 'road_event.closed'
       AND closure.before_state -> 'closureAuthorization' IS DISTINCT FROM 'null'::jsonb
       AND (
         SELECT count(*)
           FROM audit_logs authorization
          WHERE authorization.resource_type = 'RoadEvent'
            AND authorization.resource_id = closure.resource_id
            AND authorization.correlation_id = closure.correlation_id
            AND authorization.action = 'road_event.closure_authorized'
            AND authorization.trace_id = closure.causation_id
            AND authorization.causation_id IS NULL
            AND authorization.actor_type = closure.actor_type
            AND authorization.actor_id IS NOT DISTINCT FROM closure.actor_id
            AND authorization.after_state -> 'version' = closure.before_state -> 'version'
            AND authorization.after_state -> 'closureAuthorization' = closure.before_state -> 'closureAuthorization'
       ) <> 1
  ) THEN
    RAISE EXCEPTION 'Existing RoadEvent closure audit lineage is missing, ambiguous, or cross-incident'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION enforce_road_event_audit_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closure_authorization jsonb;
  authorization_matches bigint;
BEGIN
  IF NEW.resource_type <> 'RoadEvent' THEN
    RETURN NEW;
  END IF;

  IF NEW.resource_id IS NULL OR NEW.correlation_id IS DISTINCT FROM NEW.resource_id THEN
    RAISE EXCEPTION 'RoadEvent audit correlation must equal its resource id'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.action = 'road_event.closure_authorized' THEN
    IF NEW.causation_id IS NOT NULL THEN
      RAISE EXCEPTION 'RoadEvent closure authorization cannot claim a prior cause'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.action <> 'road_event.closed' THEN
    RETURN NEW;
  END IF;

  IF NEW.before_state IS NULL OR NOT (NEW.before_state ? 'closureAuthorization') THEN
    RAISE EXCEPTION 'RoadEvent closure audit requires explicit authorization state'
      USING ERRCODE = '23514';
  END IF;

  closure_authorization := NEW.before_state -> 'closureAuthorization';
  IF closure_authorization = 'null'::jsonb THEN
    IF NEW.causation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Low-risk RoadEvent closure cannot claim authorization causation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.causation_id IS NULL THEN
    RAISE EXCEPTION 'High-risk RoadEvent closure requires authorization causation'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
    INTO authorization_matches
    FROM audit_logs authorization
   WHERE authorization.resource_type = 'RoadEvent'
     AND authorization.resource_id = NEW.resource_id
     AND authorization.correlation_id = NEW.correlation_id
     AND authorization.action = 'road_event.closure_authorized'
     AND authorization.trace_id = NEW.causation_id
     AND authorization.causation_id IS NULL
     AND authorization.actor_type = NEW.actor_type
     AND authorization.actor_id IS NOT DISTINCT FROM NEW.actor_id
     AND authorization.after_state -> 'version' = NEW.before_state -> 'version'
     AND authorization.after_state -> 'closureAuthorization' = closure_authorization;

  IF authorization_matches <> 1 THEN
    RAISE EXCEPTION 'RoadEvent closure cause must identify one exact same-event authorization audit record'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER road_event_audit_lineage_guard
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION enforce_road_event_audit_lineage();

COMMENT ON FUNCTION enforce_road_event_audit_lineage() IS
  'Fail-closed audit guard: high-risk closure must consume one prior human authorization for the same RoadEvent, actor, version, and governed snapshot. It grants no operational or activation authority.';

COMMIT;
