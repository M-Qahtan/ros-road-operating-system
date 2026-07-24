ALTER TABLE road_events
  ADD COLUMN closure_authorized_by UUID,
  ADD COLUMN closure_authorized_at TIMESTAMPTZ,
  ADD COLUMN closure_authorization_reason TEXT,
  ADD CONSTRAINT road_events_version_positive CHECK (version > 0),
  ADD CONSTRAINT road_events_reason_codes_present
    CHECK (cardinality(reason_codes) > 0) NOT VALID,
  ADD CONSTRAINT road_events_closure_authorization_complete CHECK (
    (closure_authorized_by IS NULL AND closure_authorized_at IS NULL AND closure_authorization_reason IS NULL)
    OR
    (
      closure_authorized_by IS NOT NULL
      AND closure_authorized_at IS NOT NULL
      AND length(trim(closure_authorization_reason)) > 0
    )
  ),
  ADD CONSTRAINT road_events_high_severity_closure_authorized CHECK (
    status <> 'CLOSED'
    OR severity NOT IN ('S3', 'S4')
    OR (
      closure_authorized_by IS NOT NULL
      AND closure_authorized_at IS NOT NULL
      AND length(trim(closure_authorization_reason)) > 0
    )
  );

ALTER TABLE signals
  ADD CONSTRAINT signals_accuracy_non_negative
    CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0);

ALTER TABLE road_event_signals
  ADD CONSTRAINT road_event_signals_merge_reason_present
    CHECK (cardinality(merge_reason) > 0) NOT VALID;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_retry_count_non_negative CHECK (retry_count >= 0);

CREATE FUNCTION set_road_event_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER road_events_set_updated_at
BEFORE UPDATE ON road_events
FOR EACH ROW
EXECUTE FUNCTION set_road_event_updated_at();

CREATE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION reject_audit_log_mutation();

COMMENT ON CONSTRAINT road_events_reason_codes_present ON road_events IS
  'NOT VALID protects new writes; existing rows must be remediated before explicit validation.';

COMMENT ON CONSTRAINT road_event_signals_merge_reason_present ON road_event_signals IS
  'NOT VALID protects new writes; existing rows must be remediated before explicit validation.';
