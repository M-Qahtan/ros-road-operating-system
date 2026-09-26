BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN correlation_id uuid,
  ADD COLUMN causation_id uuid;

UPDATE audit_logs
SET correlation_id = resource_id
WHERE resource_type = 'RoadEvent' AND resource_id IS NOT NULL;

WITH unique_authorization AS (
  SELECT closure.id AS closure_id, min(authorization.trace_id::text)::uuid AS authorization_trace_id
  FROM audit_logs closure
  JOIN audit_logs authorization
    ON authorization.resource_type = 'RoadEvent'
   AND authorization.resource_id = closure.resource_id
   AND authorization.action = 'road_event.closure_authorized'
   AND authorization.after_state -> 'version' = closure.before_state -> 'version'
   AND authorization.after_state -> 'closureAuthorization' = closure.before_state -> 'closureAuthorization'
  WHERE closure.resource_type = 'RoadEvent'
    AND closure.action = 'road_event.closed'
    AND closure.before_state -> 'closureAuthorization' <> 'null'::jsonb
  GROUP BY closure.id
  HAVING count(*) = 1
)
UPDATE audit_logs closure
SET causation_id = unique_authorization.authorization_trace_id
FROM unique_authorization
WHERE closure.id = unique_authorization.closure_id;

ALTER TABLE audit_logs
  ADD CONSTRAINT road_event_audit_correlation_required CHECK (
    resource_type <> 'RoadEvent' OR correlation_id IS NOT NULL
  ),
  ADD CONSTRAINT road_event_closure_audit_causation_required CHECK (
    action <> 'road_event.closed'
    OR before_state -> 'closureAuthorization' IS NOT DISTINCT FROM 'null'::jsonb
    OR causation_id IS NOT NULL
  );

CREATE INDEX audit_logs_correlation_idx ON audit_logs (correlation_id, occurred_at, id);
CREATE INDEX audit_logs_causation_idx ON audit_logs (causation_id) WHERE causation_id IS NOT NULL;

COMMENT ON COLUMN audit_logs.correlation_id IS
  'Stable aggregate correlation. RoadEvent audit entries use the scoped RoadEvent id.';
COMMENT ON COLUMN audit_logs.causation_id IS
  'Exact prior audit trace that caused this mutation. High-risk closure points to the consumed human authorization audit trace.';

COMMIT;
