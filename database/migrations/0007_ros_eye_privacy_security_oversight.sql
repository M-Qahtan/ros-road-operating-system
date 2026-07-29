BEGIN;

CREATE TABLE IF NOT EXISTS ros_eye_privacy_audit (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  purpose text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, event_id)
);

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_leases (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  lease_id text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('SAFETY_OPERATOR','SECURITY_REVIEWER')),
  purpose text NOT NULL CHECK (purpose IN ('OPERATOR_REVIEW','SECURITY_INVESTIGATION')),
  reason_code text NOT NULL,
  alert_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  review_event_id text,
  PRIMARY KEY (tenant_id, case_id, lease_id),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '15 minutes'),
  CHECK ((reviewed_at IS NULL AND review_event_id IS NULL) OR (reviewed_at IS NOT NULL AND review_event_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ros_eye_break_glass_active_idx
  ON ros_eye_break_glass_leases (tenant_id, case_id, expires_at)
  WHERE reviewed_at IS NULL;

CREATE TABLE IF NOT EXISTS ros_eye_retention_controls (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  resource_id text NOT NULL,
  data_kind text NOT NULL,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('ACTIVE','DELETION_PENDING','LEGAL_HOLD','PURGED')),
  delete_after timestamptz,
  legal_hold_until timestamptz,
  content_purged_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, resource_id),
  CHECK (NOT (lifecycle_state = 'LEGAL_HOLD' AND content_purged_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION reject_ros_eye_privacy_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ros_eye_privacy_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS ros_eye_privacy_audit_append_only ON ros_eye_privacy_audit;
CREATE TRIGGER ros_eye_privacy_audit_append_only
BEFORE UPDATE OR DELETE ON ros_eye_privacy_audit
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_privacy_audit_mutation();

COMMENT ON TABLE ros_eye_privacy_audit IS 'Structured immutable audit only; raw conversation, evidence, precise location, telephone data, medical narrative and tokens are prohibited.';
COMMENT ON TABLE ros_eye_break_glass_leases IS 'Time-bounded, reasoned, alerted and post-reviewed exceptional access; never permanent or silent.';
COMMENT ON TABLE ros_eye_retention_controls IS 'Content lifecycle controls preserve audit records independently from content deletion.';

COMMIT;
