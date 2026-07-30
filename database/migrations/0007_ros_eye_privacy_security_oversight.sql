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

CREATE TABLE IF NOT EXISTS ros_eye_consent_grants (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  grant_id text NOT NULL,
  session_id text NOT NULL,
  subject_id text NOT NULL,
  approved_purposes text[] NOT NULL,
  approved_data_kinds text[] NOT NULL,
  approved_actions text[] NOT NULL,
  disclosure_language text NOT NULL,
  contact_state text NOT NULL CHECK (contact_state IN ('CONTACTING','AWAITING_RESPONSE','HUMAN_REVIEW','ESCALATED')),
  protocol_version text NOT NULL,
  consent_policy_version text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, grant_id),
  UNIQUE (tenant_id, case_id, session_id, subject_id, grant_id),
  CHECK (expires_at > granted_at),
  CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL) OR (status <> 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS ros_eye_consent_active_idx
  ON ros_eye_consent_grants (tenant_id, case_id, session_id, subject_id, expires_at)
  WHERE status = 'ACTIVE' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_leases (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  lease_id text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('SAFETY_OPERATOR','SECURITY_REVIEWER')),
  purpose text NOT NULL CHECK (purpose IN ('OPERATOR_REVIEW','SECURITY_INVESTIGATION')),
  reason_code text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  revoked_at timestamptz,
  review_event_id text,
  PRIMARY KEY (tenant_id, case_id, lease_id),
  UNIQUE (tenant_id, case_id, lease_id, actor_id, purpose),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '15 minutes'),
  CHECK ((reviewed_at IS NULL AND review_event_id IS NULL) OR (reviewed_at IS NOT NULL AND review_event_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ros_eye_break_glass_active_idx
  ON ros_eye_break_glass_leases (tenant_id, case_id, actor_id, expires_at)
  WHERE reviewed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_alert_outbox (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  grant_id text NOT NULL,
  alert_receipt_id text NOT NULL,
  actor_id text NOT NULL,
  lease_id text NOT NULL,
  purpose text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('RESERVED','DELIVERED','FAILED')),
  available_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, case_id, grant_id),
  UNIQUE (tenant_id, case_id, alert_receipt_id),
  FOREIGN KEY (tenant_id, case_id, lease_id, actor_id, purpose)
    REFERENCES ros_eye_break_glass_leases(tenant_id, case_id, lease_id, actor_id, purpose),
  CHECK ((status = 'DELIVERED' AND delivered_at IS NOT NULL) OR (status <> 'DELIVERED' AND delivered_at IS NULL))
);

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_abuse_usage (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  grant_id text NOT NULL,
  actor_id text NOT NULL,
  lease_id text NOT NULL,
  purpose text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ALLOW','RATE_LIMIT','ANOMALY_REVIEW')),
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, case_id, grant_id),
  FOREIGN KEY (tenant_id, case_id, lease_id, actor_id, purpose)
    REFERENCES ros_eye_break_glass_leases(tenant_id, case_id, lease_id, actor_id, purpose)
);

CREATE TABLE IF NOT EXISTS ros_eye_break_glass_grants (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  grant_id text NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  lease_id text NOT NULL,
  actor_role text NOT NULL,
  purpose text NOT NULL,
  data_kind text NOT NULL CHECK (data_kind IN ('CONVERSATION_RAW','EVIDENCE_RAW','PRECISE_LOCATION')),
  action text NOT NULL CHECK (action IN ('READ','MASKED_READ')),
  alert_receipt_id text NOT NULL,
  audit_event_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('AUTHORIZED')),
  authorized_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  PRIMARY KEY (tenant_id, case_id, grant_id),
  UNIQUE (tenant_id, case_id, actor_id, lease_id, idempotency_key),
  FOREIGN KEY (tenant_id, case_id, lease_id, actor_id, purpose)
    REFERENCES ros_eye_break_glass_leases(tenant_id, case_id, lease_id, actor_id, purpose),
  FOREIGN KEY (tenant_id, case_id, grant_id)
    REFERENCES ros_eye_break_glass_alert_outbox(tenant_id, case_id, grant_id),
  FOREIGN KEY (tenant_id, case_id, grant_id)
    REFERENCES ros_eye_break_glass_abuse_usage(tenant_id, case_id, grant_id),
  FOREIGN KEY (tenant_id, case_id, audit_event_id)
    REFERENCES ros_eye_privacy_audit(tenant_id, case_id, event_id)
);

CREATE TABLE IF NOT EXISTS ros_eye_recommendation_approvals (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  approval_id text NOT NULL,
  recommendation_id text NOT NULL,
  recommendation_version integer NOT NULL CHECK (recommendation_version > 0),
  action_id text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('HIGH','CRITICAL')),
  approver_id text NOT NULL,
  approver_role text NOT NULL CHECK (approver_role IN ('SAFETY_OPERATOR','SECURITY_REVIEWER')),
  proposer_id text NOT NULL,
  explanation_artifact_hash text NOT NULL,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  status text NOT NULL CHECK (status IN ('APPROVED','REVOKED','EXPIRED')),
  policy_version text NOT NULL,
  audit_event_id text NOT NULL,
  PRIMARY KEY (tenant_id, case_id, approval_id),
  UNIQUE (tenant_id, case_id, recommendation_id, recommendation_version, action_id, approval_id),
  FOREIGN KEY (tenant_id, case_id, audit_event_id)
    REFERENCES ros_eye_privacy_audit(tenant_id, case_id, event_id),
  CHECK (approver_id <> proposer_id),
  CHECK (expires_at > approved_at)
);

CREATE TABLE IF NOT EXISTS ros_eye_recommendation_executions (
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  execution_id text NOT NULL,
  idempotency_key text NOT NULL,
  recommendation_id text NOT NULL,
  recommendation_version integer NOT NULL,
  action_id text NOT NULL,
  approval_id text,
  proposer_id text NOT NULL,
  explanation_artifact_hash text NOT NULL,
  executed_at timestamptz NOT NULL,
  audit_event_id text NOT NULL,
  policy_version text NOT NULL,
  PRIMARY KEY (tenant_id, case_id, execution_id),
  UNIQUE (tenant_id, case_id, idempotency_key),
  FOREIGN KEY (tenant_id, case_id, audit_event_id)
    REFERENCES ros_eye_privacy_audit(tenant_id, case_id, event_id),
  FOREIGN KEY (tenant_id, case_id, recommendation_id, recommendation_version, action_id, approval_id)
    REFERENCES ros_eye_recommendation_approvals(tenant_id, case_id, recommendation_id, recommendation_version, action_id, approval_id)
);

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
COMMENT ON TABLE ros_eye_consent_grants IS 'Authoritative consent receipts bound to tenant, case, session, subject, exact purpose/data/action, language and protocol state.';
COMMENT ON TABLE ros_eye_break_glass_leases IS 'Actor-bound, time-bounded, reasoned and post-reviewed exceptional-access leases.';
COMMENT ON TABLE ros_eye_break_glass_alert_outbox IS 'Durable non-caller-supplied alert reservations. Provider delivery is asynchronous and must not hold authorization row locks.';
COMMENT ON TABLE ros_eye_break_glass_abuse_usage IS 'Idempotent abuse and rate-limit consumption bound to one exceptional-access grant.';
COMMENT ON TABLE ros_eye_break_glass_grants IS 'Authorization exists only after durable alert reservation, ALLOW abuse decision and immutable audit append are present in one transaction.';
COMMENT ON TABLE ros_eye_recommendation_approvals IS 'Human approvals are scoped, time-bounded, separation-of-duties constrained and audit-linked; model output is never authority.';
COMMENT ON TABLE ros_eye_recommendation_executions IS 'Idempotent execution intents require immutable audit and, for high/critical risk, a matching authoritative approval.';
COMMENT ON TABLE ros_eye_retention_controls IS 'Content lifecycle controls preserve audit records independently from content deletion.';

COMMIT;
