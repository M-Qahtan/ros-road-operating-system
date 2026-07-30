BEGIN;

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_actor_windows (
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  purpose text NOT NULL,
  window_started_at timestamptz NOT NULL,
  window_seconds integer NOT NULL DEFAULT 300 CHECK (window_seconds BETWEEN 1 AND 3600),
  max_uses integer NOT NULL DEFAULT 3 CHECK (max_uses BETWEEN 1 AND 100),
  consumed_uses integer NOT NULL DEFAULT 0 CHECK (consumed_uses BETWEEN 0 AND max_uses),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, actor_id, purpose)
);

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_use_audit (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  grant_id text NOT NULL,
  audit_event_id text NOT NULL,
  actor_id text NOT NULL,
  lease_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('SAFETY_OPERATOR','SECURITY_REVIEWER')),
  purpose text NOT NULL CHECK (purpose IN ('OPERATOR_REVIEW','SECURITY_INVESTIGATION')),
  data_kind text NOT NULL CHECK (data_kind IN ('CONVERSATION_RAW','EVIDENCE_RAW','PRECISE_LOCATION')),
  action text NOT NULL CHECK (action IN ('READ','MASKED_READ')),
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, grant_id),
  UNIQUE (tenant_id, case_id, audit_event_id),
  FOREIGN KEY (tenant_id, case_id, audit_event_id)
    REFERENCES ros_eye_privacy_audit(tenant_id, case_id, event_id),
  FOREIGN KEY (tenant_id, case_id, lease_id, actor_id, purpose)
    REFERENCES ros_eye_break_glass_leases(tenant_id, case_id, lease_id, actor_id, purpose)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ros_eye_break_glass_grants_alert_receipt_fk'
      AND conrelid = 'ros_eye_break_glass_grants'::regclass
  ) THEN
    ALTER TABLE ros_eye_break_glass_grants
      ADD CONSTRAINT ros_eye_break_glass_grants_alert_receipt_fk
      FOREIGN KEY (tenant_id, case_id, alert_receipt_id)
      REFERENCES ros_eye_break_glass_alert_outbox(tenant_id, case_id, alert_receipt_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ros_eye_break_glass_grants_use_audit_fk'
      AND conrelid = 'ros_eye_break_glass_grants'::regclass
  ) THEN
    ALTER TABLE ros_eye_break_glass_grants
      ADD CONSTRAINT ros_eye_break_glass_grants_use_audit_fk
      FOREIGN KEY (tenant_id, case_id, grant_id)
      REFERENCES ros_eye_break_glass_use_audit(tenant_id, case_id, grant_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION consume_ros_eye_break_glass_abuse(
  p_tenant_id text,
  p_case_id text,
  p_grant_id text,
  p_actor_id text,
  p_lease_id text,
  p_purpose text,
  p_consumed_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  existing_decision text;
  window_row ros_eye_break_glass_actor_windows%ROWTYPE;
  final_decision text;
BEGIN
  IF p_tenant_id = '' OR p_case_id = '' OR p_grant_id = '' OR p_actor_id = ''
     OR p_lease_id = '' OR p_purpose = '' OR p_consumed_at IS NULL THEN
    RAISE EXCEPTION 'invalid abuse-consumption scope';
  END IF;

  SELECT decision INTO existing_decision
  FROM ros_eye_break_glass_abuse_usage
  WHERE tenant_id = p_tenant_id
    AND case_id = p_case_id
    AND grant_id = p_grant_id;

  IF FOUND THEN
    RETURN existing_decision;
  END IF;

  INSERT INTO ros_eye_break_glass_actor_windows (
    tenant_id, actor_id, purpose, window_started_at
  )
  VALUES (
    p_tenant_id, p_actor_id, p_purpose, p_consumed_at
  )
  ON CONFLICT (tenant_id, actor_id, purpose) DO NOTHING;

  SELECT * INTO window_row
  FROM ros_eye_break_glass_actor_windows
  WHERE tenant_id = p_tenant_id
    AND actor_id = p_actor_id
    AND purpose = p_purpose
  FOR UPDATE;

  SELECT decision INTO existing_decision
  FROM ros_eye_break_glass_abuse_usage
  WHERE tenant_id = p_tenant_id
    AND case_id = p_case_id
    AND grant_id = p_grant_id;

  IF FOUND THEN
    RETURN existing_decision;
  END IF;

  IF p_consumed_at < window_row.window_started_at THEN
    final_decision := 'ANOMALY_REVIEW';
  ELSE
    IF p_consumed_at >= window_row.window_started_at
       + make_interval(secs => window_row.window_seconds) THEN
      UPDATE ros_eye_break_glass_actor_windows
      SET window_started_at = p_consumed_at,
          consumed_uses = 0,
          updated_at = clock_timestamp()
      WHERE tenant_id = p_tenant_id
        AND actor_id = p_actor_id
        AND purpose = p_purpose
      RETURNING * INTO window_row;
    END IF;

    IF window_row.consumed_uses >= window_row.max_uses THEN
      final_decision := 'RATE_LIMIT';
    ELSE
      UPDATE ros_eye_break_glass_actor_windows
      SET consumed_uses = consumed_uses + 1,
          updated_at = clock_timestamp()
      WHERE tenant_id = p_tenant_id
        AND actor_id = p_actor_id
        AND purpose = p_purpose;
      final_decision := 'ALLOW';
    END IF;
  END IF;

  INSERT INTO ros_eye_break_glass_abuse_usage (
    tenant_id, case_id, grant_id, actor_id, lease_id, purpose, decision, consumed_at
  )
  VALUES (
    p_tenant_id, p_case_id, p_grant_id, p_actor_id, p_lease_id, p_purpose,
    final_decision, p_consumed_at
  );

  RETURN final_decision;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_active_ros_eye_break_glass_lease()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lease_row ros_eye_break_glass_leases%ROWTYPE;
  alert_row ros_eye_break_glass_alert_outbox%ROWTYPE;
  abuse_row ros_eye_break_glass_abuse_usage%ROWTYPE;
  use_audit_row ros_eye_break_glass_use_audit%ROWTYPE;
  audit_row ros_eye_privacy_audit%ROWTYPE;
BEGIN
  SELECT * INTO lease_row
  FROM ros_eye_break_glass_leases
  WHERE tenant_id = NEW.tenant_id
    AND case_id = NEW.case_id
    AND lease_id = NEW.lease_id
    AND actor_id = NEW.actor_id
    AND purpose = NEW.purpose
  FOR UPDATE;

  IF NOT FOUND
    OR lease_row.actor_role <> NEW.actor_role
    OR lease_row.reviewed_at IS NOT NULL
    OR lease_row.revoked_at IS NOT NULL
    OR NEW.authorized_at < lease_row.issued_at
    OR NEW.authorized_at >= lease_row.expires_at THEN
    RAISE EXCEPTION 'break-glass lease is not active at grant finalization';
  END IF;

  SELECT * INTO alert_row
  FROM ros_eye_break_glass_alert_outbox
  WHERE tenant_id = NEW.tenant_id
    AND case_id = NEW.case_id
    AND grant_id = NEW.grant_id
    AND alert_receipt_id = NEW.alert_receipt_id
  FOR SHARE;

  IF NOT FOUND
    OR alert_row.status NOT IN ('RESERVED','DELIVERED')
    OR alert_row.actor_id <> NEW.actor_id
    OR alert_row.lease_id <> NEW.lease_id
    OR alert_row.purpose <> NEW.purpose
    OR alert_row.policy_version <> NEW.policy_version
    OR alert_row.available_at > NEW.authorized_at THEN
    RAISE EXCEPTION 'break-glass alert reservation is not durable and scope-bound';
  END IF;

  SELECT * INTO abuse_row
  FROM ros_eye_break_glass_abuse_usage
  WHERE tenant_id = NEW.tenant_id
    AND case_id = NEW.case_id
    AND grant_id = NEW.grant_id
  FOR SHARE;

  IF NOT FOUND
    OR abuse_row.decision <> 'ALLOW'
    OR abuse_row.actor_id <> NEW.actor_id
    OR abuse_row.lease_id <> NEW.lease_id
    OR abuse_row.purpose <> NEW.purpose
    OR abuse_row.consumed_at > NEW.authorized_at THEN
    RAISE EXCEPTION 'break-glass abuse prevention did not allow this scope';
  END IF;

  SELECT * INTO use_audit_row
  FROM ros_eye_break_glass_use_audit
  WHERE tenant_id = NEW.tenant_id
    AND case_id = NEW.case_id
    AND grant_id = NEW.grant_id
    AND audit_event_id = NEW.audit_event_id
  FOR SHARE;

  IF NOT FOUND
    OR use_audit_row.actor_id <> NEW.actor_id
    OR use_audit_row.lease_id <> NEW.lease_id
    OR use_audit_row.actor_role <> NEW.actor_role
    OR use_audit_row.purpose <> NEW.purpose
    OR use_audit_row.data_kind <> NEW.data_kind
    OR use_audit_row.action <> NEW.action
    OR use_audit_row.reason_code <> lease_row.reason_code
    OR use_audit_row.policy_version <> NEW.policy_version
    OR use_audit_row.occurred_at > NEW.authorized_at THEN
    RAISE EXCEPTION 'break-glass use audit is absent or not scope-bound';
  END IF;

  SELECT * INTO audit_row
  FROM ros_eye_privacy_audit
  WHERE tenant_id = NEW.tenant_id
    AND case_id = NEW.case_id
    AND event_id = NEW.audit_event_id
  FOR SHARE;

  IF NOT FOUND
    OR audit_row.event_type <> 'BREAK_GLASS_USE'
    OR audit_row.actor_id <> NEW.actor_id
    OR audit_row.actor_role <> NEW.actor_role
    OR audit_row.purpose <> NEW.purpose
    OR audit_row.reason_code <> lease_row.reason_code
    OR audit_row.policy_version <> NEW.policy_version
    OR audit_row.occurred_at <> use_audit_row.occurred_at THEN
    RAISE EXCEPTION 'immutable privacy audit is absent or not scope-bound';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_ros_eye_break_glass_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS ros_eye_break_glass_use_audit_immutable
  ON ros_eye_break_glass_use_audit;
CREATE TRIGGER ros_eye_break_glass_use_audit_immutable
BEFORE UPDATE OR DELETE ON ros_eye_break_glass_use_audit
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_break_glass_immutable_mutation();

DROP TRIGGER IF EXISTS ros_eye_break_glass_abuse_usage_immutable
  ON ros_eye_break_glass_abuse_usage;
CREATE TRIGGER ros_eye_break_glass_abuse_usage_immutable
BEFORE UPDATE OR DELETE ON ros_eye_break_glass_abuse_usage
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_break_glass_immutable_mutation();

DROP TRIGGER IF EXISTS ros_eye_break_glass_grants_immutable
  ON ros_eye_break_glass_grants;
CREATE TRIGGER ros_eye_break_glass_grants_immutable
BEFORE UPDATE OR DELETE ON ros_eye_break_glass_grants
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_break_glass_immutable_mutation();

CREATE OR REPLACE FUNCTION protect_ros_eye_break_glass_alert_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'break-glass alert outbox rows cannot be deleted';
  END IF;

  IF NEW.tenant_id <> OLD.tenant_id
    OR NEW.case_id <> OLD.case_id
    OR NEW.grant_id <> OLD.grant_id
    OR NEW.alert_receipt_id <> OLD.alert_receipt_id
    OR NEW.actor_id <> OLD.actor_id
    OR NEW.lease_id <> OLD.lease_id
    OR NEW.purpose <> OLD.purpose
    OR NEW.policy_version <> OLD.policy_version
    OR NEW.available_at <> OLD.available_at
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'break-glass alert receipt binding is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ros_eye_break_glass_alert_outbox_binding_immutable
  ON ros_eye_break_glass_alert_outbox;
CREATE TRIGGER ros_eye_break_glass_alert_outbox_binding_immutable
BEFORE UPDATE OR DELETE ON ros_eye_break_glass_alert_outbox
FOR EACH ROW EXECUTE FUNCTION protect_ros_eye_break_glass_alert_outbox();

COMMENT ON TABLE ros_eye_break_glass_actor_windows IS
  'Atomic per-tenant actor/purpose break-glass rate-limit windows; row locking prevents concurrent limit bypass.';
COMMENT ON TABLE ros_eye_break_glass_use_audit IS
  'Immutable scope binding between one break-glass grant and its append-only privacy audit event.';

COMMIT;
