CREATE TYPE evidence_status AS ENUM (
  'PENDING_UPLOAD', 'SCANNING', 'PRESERVED', 'QUARANTINED'
);

CREATE TABLE evidence_objects (
  id UUID PRIMARY KEY,
  road_event_id UUID NOT NULL REFERENCES road_events(id),
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  declared_size_bytes BIGINT NOT NULL CHECK (declared_size_bytes > 0),
  actual_size_bytes BIGINT CHECK (actual_size_bytes IS NULL OR actual_size_bytes > 0),
  declared_checksum_sha256 CHAR(64) NOT NULL CHECK (declared_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  verified_checksum_sha256 CHAR(64) CHECK (
    verified_checksum_sha256 IS NULL OR verified_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  status evidence_status NOT NULL,
  upload_expires_at TIMESTAMPTZ NOT NULL,
  retain_until TIMESTAMPTZ NOT NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  quarantine_reason TEXT,
  CONSTRAINT evidence_retention_after_creation CHECK (retain_until > created_at),
  CONSTRAINT evidence_completion_consistent CHECK (
    (status = 'PENDING_UPLOAD' AND actual_size_bytes IS NULL AND verified_checksum_sha256 IS NULL AND completed_at IS NULL AND quarantine_reason IS NULL)
    OR
    (status = 'PRESERVED' AND actual_size_bytes IS NOT NULL AND verified_checksum_sha256 IS NOT NULL AND completed_at IS NOT NULL AND quarantine_reason IS NULL)
    OR
    (status = 'QUARANTINED' AND completed_at IS NOT NULL AND quarantine_reason IS NOT NULL)
    OR status = 'SCANNING'
  )
);

CREATE INDEX evidence_objects_road_event_idx
  ON evidence_objects (road_event_id, created_at DESC, id DESC);
CREATE INDEX evidence_objects_retention_idx
  ON evidence_objects (retain_until)
  WHERE legal_hold = FALSE;
CREATE INDEX evidence_objects_quarantine_idx
  ON evidence_objects (completed_at DESC)
  WHERE status = 'QUARANTINED';

CREATE TABLE evidence_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence_objects(id),
  road_event_id UUID NOT NULL REFERENCES road_events(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  reason TEXT,
  trace_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX evidence_audit_logs_evidence_idx
  ON evidence_audit_logs (evidence_id, occurred_at, id);

CREATE FUNCTION reject_evidence_metadata_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.object_key <> NEW.object_key
     OR OLD.road_event_id <> NEW.road_event_id
     OR OLD.original_filename <> NEW.original_filename
     OR OLD.content_type <> NEW.content_type
     OR OLD.declared_size_bytes <> NEW.declared_size_bytes
     OR OLD.declared_checksum_sha256 <> NEW.declared_checksum_sha256
     OR OLD.created_by <> NEW.created_by
     OR OLD.created_at <> NEW.created_at
     OR OLD.retain_until <> NEW.retain_until
     OR OLD.legal_hold <> NEW.legal_hold THEN
    RAISE EXCEPTION 'immutable evidence metadata cannot be modified';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_metadata_immutable
BEFORE UPDATE ON evidence_objects
FOR EACH ROW
EXECUTE FUNCTION reject_evidence_metadata_mutation();

CREATE FUNCTION reject_evidence_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'evidence audit logs are append-only';
END;
$$;

CREATE TRIGGER evidence_audit_logs_immutable
BEFORE UPDATE OR DELETE ON evidence_audit_logs
FOR EACH ROW
EXECUTE FUNCTION reject_evidence_audit_mutation();
