BEGIN;

CREATE TABLE IF NOT EXISTS ros_eye_contact_sessions (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  session_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('CREATED','CONSENT_PENDING','LANGUAGE_SELECTION','CONTACTING','AWAITING_RESPONSE','PARTIAL_RESPONSE','RESPONSE_CONFIRMED','DISCONNECTED','NO_RESPONSE','UNREACHABLE','OPERATOR_TAKEOVER','HUMAN_REVIEW','ESCALATED','COMPLETED')),
  version integer NOT NULL CHECK (version > 0),
  protocol_version text NOT NULL,
  prompt_policy_version text NOT NULL,
  accessibility_policy_version text NOT NULL,
  language text NOT NULL CHECK (language IN ('ar','en','UNKNOWN')),
  identity_confidence text NOT NULL CHECK (identity_confidence IN ('UNVERIFIED','PARTIAL','CONFIRMED')),
  active_channel text,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0 AND attempt_count <= 3),
  response_deadline_at timestamptz,
  next_action_at timestamptz,
  last_interaction_at timestamptz NOT NULL,
  assigned_operator_id text,
  automation_suppressed boolean NOT NULL DEFAULT false,
  accessibility jsonb NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, session_id),
  CHECK ((automation_suppressed = false) OR (next_action_at IS NULL AND response_deadline_at IS NULL)),
  CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ros_eye_contact_due_idx
  ON ros_eye_contact_sessions (tenant_id, next_action_at, lease_expires_at)
  WHERE automation_suppressed = false AND next_action_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ros_eye_contact_inbox (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  session_id text NOT NULL,
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, session_id, idempotency_key),
  FOREIGN KEY (tenant_id, case_id, session_id)
    REFERENCES ros_eye_contact_sessions(tenant_id, case_id, session_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS ros_eye_contact_outbox (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  session_id text NOT NULL,
  message_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('IN_APP','PUSH','SMS_SIM','TELEPHONY_SIM')),
  prompt_id text NOT NULL,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0 AND attempt <= 3),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  delivery_token text,
  delivery_started_at timestamptz,
  delivery_deadline_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, session_id, message_id),
  UNIQUE (tenant_id, case_id, session_id, idempotency_key),
  FOREIGN KEY (tenant_id, case_id, session_id)
    REFERENCES ros_eye_contact_sessions(tenant_id, case_id, session_id)
    ON DELETE RESTRICT,
  CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((delivery_token IS NULL AND delivery_started_at IS NULL AND delivery_deadline_at IS NULL)
    OR (delivery_token IS NOT NULL AND delivery_started_at IS NOT NULL AND delivery_deadline_at IS NOT NULL)),
  CHECK ((delivery_started_at IS NULL AND delivery_deadline_at IS NULL) OR delivery_deadline_at > delivery_started_at),
  CHECK (NOT (delivered_at IS NOT NULL AND cancelled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ros_eye_contact_outbox_due_idx
  ON ros_eye_contact_outbox (tenant_id, available_at, lease_expires_at, delivery_deadline_at)
  WHERE delivered_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS ros_eye_contact_audit (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  session_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  session_version integer NOT NULL CHECK (session_version > 0),
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM','OPERATOR')),
  actor_id text NOT NULL,
  authorized_by_role text NOT NULL CHECK (authorized_by_role IN ('SYSTEM','OPERATOR','SUPERVISOR','SAFETY_LEAD')),
  authority_policy_version text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  trace_id text NOT NULL,
  runtime_policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, session_id, event_id),
  UNIQUE (tenant_id, case_id, session_id, session_version, event_type),
  FOREIGN KEY (tenant_id, case_id, session_id)
    REFERENCES ros_eye_contact_sessions(tenant_id, case_id, session_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_ros_eye_contact_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ros_eye_contact_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS ros_eye_contact_audit_append_only ON ros_eye_contact_audit;
CREATE TRIGGER ros_eye_contact_audit_append_only
BEFORE UPDATE OR DELETE ON ros_eye_contact_audit
FOR EACH ROW EXECUTE FUNCTION reject_ros_eye_contact_audit_mutation();

COMMENT ON TABLE ros_eye_contact_outbox IS
  'Claim with FOR UPDATE SKIP LOCKED, commit an expiring delivery reservation, call the provider outside all SQL transactions, and finalize only with the same uncancelled delivery token.';

COMMENT ON COLUMN ros_eye_contact_outbox.idempotency_key IS
  'Stable tenant/case/session-scoped provider key. Production channel adapters must enforce it across retries and restarts.';

COMMENT ON COLUMN ros_eye_contact_outbox.delivery_token IS
  'Short-lived opaque delivery fence. It is invalidated by operator takeover/cancellation and cannot authorize acknowledgement after expiry.';

COMMENT ON COLUMN ros_eye_contact_outbox.delivery_deadline_at IS
  'Database-enforced deadline for accepting a provider result; external calls must have a shorter AbortSignal-backed timeout than the outbox lease.';

COMMENT ON COLUMN ros_eye_contact_audit.authorized_by_role IS
  'Explicit human or system authority role evaluated under authority_policy_version.';

COMMIT;
