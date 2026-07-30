CREATE OR REPLACE FUNCTION pg_temp.expect_failure(
  p_label text,
  p_statement text,
  p_expected_fragment text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  failed_as_expected boolean := false;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_fragment IN SQLERRM) > 0 THEN
      failed_as_expected := true;
    ELSE
      RAISE EXCEPTION '% failed with unexpected error: %', p_label, SQLERRM;
    END IF;
  END;

  IF NOT failed_as_expected THEN
    RAISE EXCEPTION '% unexpectedly succeeded', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.seed_break_glass_evidence(
  p_tenant text,
  p_case text,
  p_grant text,
  p_alert text,
  p_audit text,
  p_actor text,
  p_lease text,
  p_role text,
  p_purpose text,
  p_reason text,
  p_data_kind text,
  p_action text,
  p_policy text,
  p_at timestamptz,
  p_alert_status text DEFAULT 'RESERVED',
  p_audit_actor text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ros_eye_break_glass_alert_outbox (
    tenant_id, case_id, grant_id, alert_receipt_id, actor_id, lease_id,
    purpose, policy_version, status, available_at, delivered_at
  )
  VALUES (
    p_tenant, p_case, p_grant, p_alert, p_actor, p_lease,
    p_purpose, p_policy, p_alert_status, p_at,
    CASE WHEN p_alert_status = 'DELIVERED' THEN p_at ELSE NULL END
  );

  INSERT INTO ros_eye_privacy_audit (
    tenant_id, case_id, event_id, event_type, actor_id, actor_role,
    purpose, reason_code, occurred_at, policy_version
  )
  VALUES (
    p_tenant, p_case, p_audit, 'BREAK_GLASS_USE',
    COALESCE(p_audit_actor, p_actor), p_role, p_purpose, p_reason, p_at, p_policy
  );

  INSERT INTO ros_eye_break_glass_use_audit (
    tenant_id, case_id, grant_id, audit_event_id, actor_id, lease_id,
    actor_role, purpose, data_kind, action, reason_code, occurred_at, policy_version
  )
  VALUES (
    p_tenant, p_case, p_grant, p_audit, p_actor, p_lease,
    p_role, p_purpose, p_data_kind, p_action, p_reason, p_at, p_policy
  );
END;
$$;

-- Crash/restart proof: prerequisites commit durably before grant finalization.
BEGIN;

INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at
)
VALUES (
  'tenant-ci-recovery', 'case-ci-recovery', 'lease-ci-recovery',
  'operator-ci-recovery', 'SAFETY_OPERATOR', 'OPERATOR_REVIEW',
  'immediate_safety_review',
  '2026-07-30T10:00:00Z', '2026-07-30T10:15:00Z'
);

DO $$
DECLARE
  decision text;
BEGIN
  decision := consume_ros_eye_break_glass_abuse(
    'tenant-ci-recovery', 'case-ci-recovery', 'grant-ci-recovery',
    'operator-ci-recovery', 'lease-ci-recovery', 'OPERATOR_REVIEW',
    '2026-07-30T10:00:20Z'
  );
  IF decision <> 'ALLOW' THEN
    RAISE EXCEPTION 'expected ALLOW for recovery reservation, got %', decision;
  END IF;
END;
$$;

SELECT pg_temp.seed_break_glass_evidence(
  'tenant-ci-recovery', 'case-ci-recovery', 'grant-ci-recovery',
  'alert-ci-recovery', 'audit-ci-recovery',
  'operator-ci-recovery', 'lease-ci-recovery', 'SAFETY_OPERATOR',
  'OPERATOR_REVIEW', 'immediate_safety_review',
  'EVIDENCE_RAW', 'READ', 'ros-eye.privacy-security.v4',
  '2026-07-30T10:00:30Z'
);

COMMIT;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ros_eye_break_glass_alert_outbox
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  ) OR NOT EXISTS (
    SELECT 1 FROM ros_eye_break_glass_abuse_usage
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
      AND decision = 'ALLOW'
  ) OR NOT EXISTS (
    SELECT 1 FROM ros_eye_break_glass_use_audit
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  ) THEN
    RAISE EXCEPTION 'durable break-glass prerequisites did not survive transaction boundary';
  END IF;
END;
$$;

INSERT INTO ros_eye_break_glass_grants (
  tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
  actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
  status, authorized_at, policy_version
)
VALUES (
  'tenant-ci-recovery', 'case-ci-recovery', 'grant-ci-recovery',
  'idempotency-ci-recovery', 'operator-ci-recovery', 'lease-ci-recovery',
  'SAFETY_OPERATOR', 'OPERATOR_REVIEW', 'EVIDENCE_RAW', 'READ',
  'alert-ci-recovery', 'audit-ci-recovery', 'AUTHORIZED',
  '2026-07-30T10:01:00Z', 'ros-eye.privacy-security.v4'
);

INSERT INTO ros_eye_break_glass_grants (
  tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
  actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
  status, authorized_at, policy_version
)
VALUES (
  'tenant-ci-recovery', 'case-ci-recovery', 'grant-ci-recovery',
  'idempotency-ci-recovery', 'operator-ci-recovery', 'lease-ci-recovery',
  'SAFETY_OPERATOR', 'OPERATOR_REVIEW', 'EVIDENCE_RAW', 'READ',
  'alert-ci-recovery', 'audit-ci-recovery', 'AUTHORIZED',
  '2026-07-30T10:01:00Z', 'ros-eye.privacy-security.v4'
)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM ros_eye_break_glass_grants
      WHERE tenant_id = 'tenant-ci-recovery'
        AND case_id = 'case-ci-recovery'
        AND grant_id = 'grant-ci-recovery') <> 1 THEN
    RAISE EXCEPTION 'duplicate grant was not idempotent';
  END IF;

  IF (SELECT count(*) FROM ros_eye_privacy_audit
      WHERE tenant_id = 'tenant-ci-recovery'
        AND case_id = 'case-ci-recovery'
        AND event_id = 'audit-ci-recovery') <> 1 THEN
    RAISE EXCEPTION 'duplicate use produced more than one immutable audit event';
  END IF;
END;
$$;

COMMIT;

-- Remaining negative and lifecycle tests are rolled back to keep the integration database clean.
BEGIN;

-- Atomic per-actor limit: the fourth distinct use in one window must be RATE_LIMIT.
INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at
)
VALUES (
  'tenant-ci-limit', 'case-ci-limit', 'lease-ci-limit',
  'operator-ci-limit', 'SAFETY_OPERATOR', 'OPERATOR_REVIEW',
  'immediate_safety_review',
  '2026-07-30T11:00:00Z', '2026-07-30T11:15:00Z'
);

DO $$
DECLARE
  d1 text;
  d2 text;
  d3 text;
  d4 text;
  retry text;
  consumed integer;
BEGIN
  d1 := consume_ros_eye_break_glass_abuse('tenant-ci-limit','case-ci-limit','grant-ci-limit-1','operator-ci-limit','lease-ci-limit','OPERATOR_REVIEW','2026-07-30T11:00:10Z');
  d2 := consume_ros_eye_break_glass_abuse('tenant-ci-limit','case-ci-limit','grant-ci-limit-2','operator-ci-limit','lease-ci-limit','OPERATOR_REVIEW','2026-07-30T11:00:11Z');
  d3 := consume_ros_eye_break_glass_abuse('tenant-ci-limit','case-ci-limit','grant-ci-limit-3','operator-ci-limit','lease-ci-limit','OPERATOR_REVIEW','2026-07-30T11:00:12Z');
  d4 := consume_ros_eye_break_glass_abuse('tenant-ci-limit','case-ci-limit','grant-ci-limit-4','operator-ci-limit','lease-ci-limit','OPERATOR_REVIEW','2026-07-30T11:00:13Z');
  retry := consume_ros_eye_break_glass_abuse('tenant-ci-limit','case-ci-limit','grant-ci-limit-1','operator-ci-limit','lease-ci-limit','OPERATOR_REVIEW','2026-07-30T11:00:14Z');

  SELECT consumed_uses INTO consumed
  FROM ros_eye_break_glass_actor_windows
  WHERE tenant_id = 'tenant-ci-limit'
    AND actor_id = 'operator-ci-limit'
    AND purpose = 'OPERATOR_REVIEW';

  IF d1 <> 'ALLOW' OR d2 <> 'ALLOW' OR d3 <> 'ALLOW'
     OR d4 <> 'RATE_LIMIT' OR retry <> 'ALLOW' OR consumed <> 3 THEN
    RAISE EXCEPTION 'atomic abuse window invariant failed: %, %, %, %, retry %, consumed %',
      d1, d2, d3, d4, retry, consumed;
  END IF;
END;
$$;

SELECT pg_temp.seed_break_glass_evidence(
  'tenant-ci-limit', 'case-ci-limit', 'grant-ci-limit-4',
  'alert-ci-limit-4', 'audit-ci-limit-4',
  'operator-ci-limit', 'lease-ci-limit', 'SAFETY_OPERATOR',
  'OPERATOR_REVIEW', 'immediate_safety_review',
  'EVIDENCE_RAW', 'READ', 'ros-eye.privacy-security.v4',
  '2026-07-30T11:00:20Z'
);

SELECT pg_temp.expect_failure(
  'rate-limited grant',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-limit','case-ci-limit','grant-ci-limit-4','idempotency-ci-limit-4',
      'operator-ci-limit','lease-ci-limit','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-limit-4','audit-ci-limit-4',
      'AUTHORIZED','2026-07-30T11:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'abuse prevention did not allow'
);

-- FAILED alert cannot authorize.
INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at
)
VALUES (
  'tenant-ci-alert', 'case-ci-alert', 'lease-ci-alert',
  'operator-ci-alert', 'SAFETY_OPERATOR', 'OPERATOR_REVIEW',
  'immediate_safety_review',
  '2026-07-30T12:00:00Z', '2026-07-30T12:15:00Z'
);

DO $$
BEGIN
  IF consume_ros_eye_break_glass_abuse(
    'tenant-ci-alert','case-ci-alert','grant-ci-alert',
    'operator-ci-alert','lease-ci-alert','OPERATOR_REVIEW',
    '2026-07-30T12:00:10Z'
  ) <> 'ALLOW' THEN
    RAISE EXCEPTION 'expected ALLOW for failed-alert setup';
  END IF;
END;
$$;

SELECT pg_temp.seed_break_glass_evidence(
  'tenant-ci-alert', 'case-ci-alert', 'grant-ci-alert',
  'alert-ci-alert', 'audit-ci-alert',
  'operator-ci-alert', 'lease-ci-alert', 'SAFETY_OPERATOR',
  'OPERATOR_REVIEW', 'immediate_safety_review',
  'EVIDENCE_RAW', 'READ', 'ros-eye.privacy-security.v4',
  '2026-07-30T12:00:20Z', 'FAILED'
);

SELECT pg_temp.expect_failure(
  'failed alert grant',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-alert','case-ci-alert','grant-ci-alert','idempotency-ci-alert',
      'operator-ci-alert','lease-ci-alert','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-alert','audit-ci-alert',
      'AUTHORIZED','2026-07-30T12:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'alert reservation is not durable'
);

-- Invented receipt is denied even when another reservation exists for the same grant.
INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at
)
VALUES (
  'tenant-ci-receipt', 'case-ci-receipt', 'lease-ci-receipt',
  'operator-ci-receipt', 'SAFETY_OPERATOR', 'OPERATOR_REVIEW',
  'immediate_safety_review',
  '2026-07-30T13:00:00Z', '2026-07-30T13:15:00Z'
);

DO $$
BEGIN
  IF consume_ros_eye_break_glass_abuse(
    'tenant-ci-receipt','case-ci-receipt','grant-ci-receipt',
    'operator-ci-receipt','lease-ci-receipt','OPERATOR_REVIEW',
    '2026-07-30T13:00:10Z'
  ) <> 'ALLOW' THEN
    RAISE EXCEPTION 'expected ALLOW for receipt setup';
  END IF;
END;
$$;

SELECT pg_temp.seed_break_glass_evidence(
  'tenant-ci-receipt', 'case-ci-receipt', 'grant-ci-receipt',
  'alert-ci-known', 'audit-ci-receipt',
  'operator-ci-receipt', 'lease-ci-receipt', 'SAFETY_OPERATOR',
  'OPERATOR_REVIEW', 'immediate_safety_review',
  'EVIDENCE_RAW', 'READ', 'ros-eye.privacy-security.v4',
  '2026-07-30T13:00:20Z'
);

SELECT pg_temp.expect_failure(
  'invented alert receipt',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-receipt','case-ci-receipt','grant-ci-receipt','idempotency-ci-receipt',
      'operator-ci-receipt','lease-ci-receipt','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-invented','audit-ci-receipt',
      'AUTHORIZED','2026-07-30T13:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'alert reservation is not durable'
);

-- Audit event must be the exact immutable, scope-bound BREAK_GLASS_USE event.
INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at
)
VALUES (
  'tenant-ci-audit', 'case-ci-audit', 'lease-ci-audit',
  'operator-ci-audit', 'SAFETY_OPERATOR', 'OPERATOR_REVIEW',
  'immediate_safety_review',
  '2026-07-30T14:00:00Z', '2026-07-30T14:15:00Z'
);

DO $$
BEGIN
  IF consume_ros_eye_break_glass_abuse(
    'tenant-ci-audit','case-ci-audit','grant-ci-audit',
    'operator-ci-audit','lease-ci-audit','OPERATOR_REVIEW',
    '2026-07-30T14:00:10Z'
  ) <> 'ALLOW' THEN
    RAISE EXCEPTION 'expected ALLOW for audit setup';
  END IF;
END;
$$;

SELECT pg_temp.seed_break_glass_evidence(
  'tenant-ci-audit', 'case-ci-audit', 'grant-ci-audit',
  'alert-ci-audit', 'audit-ci-audit',
  'operator-ci-audit', 'lease-ci-audit', 'SAFETY_OPERATOR',
  'OPERATOR_REVIEW', 'immediate_safety_review',
  'EVIDENCE_RAW', 'READ', 'ros-eye.privacy-security.v4',
  '2026-07-30T14:00:20Z', 'RESERVED', 'operator-ci-other'
);

SELECT pg_temp.expect_failure(
  'cross-actor audit',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-audit','case-ci-audit','grant-ci-audit','idempotency-ci-audit',
      'operator-ci-audit','lease-ci-audit','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-audit','audit-ci-audit',
      'AUTHORIZED','2026-07-30T14:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'immutable privacy audit is absent or not scope-bound'
);

-- Expiry, review and revocation are rechecked at finalization.
INSERT INTO ros_eye_break_glass_leases (
  tenant_id, case_id, lease_id, actor_id, actor_role, purpose,
  reason_code, issued_at, expires_at, reviewed_at, review_event_id, revoked_at
)
VALUES
  ('tenant-ci-expiry','case-ci-expiry','lease-ci-expiry','operator-ci-expiry','SAFETY_OPERATOR','OPERATOR_REVIEW','immediate_safety_review','2026-07-30T15:00:00Z','2026-07-30T15:01:00Z',NULL,NULL,NULL),
  ('tenant-ci-review','case-ci-review','lease-ci-review','operator-ci-review','SAFETY_OPERATOR','OPERATOR_REVIEW','immediate_safety_review','2026-07-30T15:00:00Z','2026-07-30T15:15:00Z','2026-07-30T15:00:40Z','review-ci-review',NULL),
  ('tenant-ci-revoke','case-ci-revoke','lease-ci-revoke','operator-ci-revoke','SAFETY_OPERATOR','OPERATOR_REVIEW','immediate_safety_review','2026-07-30T15:00:00Z','2026-07-30T15:15:00Z',NULL,NULL,'2026-07-30T15:00:40Z');

DO $$
DECLARE
  suffix text;
BEGIN
  FOREACH suffix IN ARRAY ARRAY['expiry','review','revoke'] LOOP
    INSERT INTO ros_eye_break_glass_abuse_usage (
      tenant_id, case_id, grant_id, actor_id, lease_id, purpose, decision, consumed_at
    ) VALUES (
      'tenant-ci-' || suffix,
      'case-ci-' || suffix,
      'grant-ci-' || suffix,
      'operator-ci-' || suffix,
      'lease-ci-' || suffix,
      'OPERATOR_REVIEW',
      'ALLOW',
      '2026-07-30T15:00:20Z'
    );

    PERFORM pg_temp.seed_break_glass_evidence(
      'tenant-ci-' || suffix,
      'case-ci-' || suffix,
      'grant-ci-' || suffix,
      'alert-ci-' || suffix,
      'audit-ci-' || suffix,
      'operator-ci-' || suffix,
      'lease-ci-' || suffix,
      'SAFETY_OPERATOR',
      'OPERATOR_REVIEW',
      'immediate_safety_review',
      'EVIDENCE_RAW',
      'READ',
      'ros-eye.privacy-security.v4',
      '2026-07-30T15:00:30Z'
    );
  END LOOP;
END;
$$;

SELECT pg_temp.expect_failure(
  'expired lease',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-expiry','case-ci-expiry','grant-ci-expiry','idempotency-ci-expiry',
      'operator-ci-expiry','lease-ci-expiry','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-expiry','audit-ci-expiry',
      'AUTHORIZED','2026-07-30T15:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

SELECT pg_temp.expect_failure(
  'reviewed lease',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-review','case-ci-review','grant-ci-review','idempotency-ci-review',
      'operator-ci-review','lease-ci-review','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-review','audit-ci-review',
      'AUTHORIZED','2026-07-30T15:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

SELECT pg_temp.expect_failure(
  'revoked lease',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-revoke','case-ci-revoke','grant-ci-revoke','idempotency-ci-revoke',
      'operator-ci-revoke','lease-ci-revoke','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-revoke','audit-ci-revoke',
      'AUTHORIZED','2026-07-30T15:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

-- Cross-tenant, cross-case and cross-actor reuse cannot reach finalization.
SELECT pg_temp.expect_failure(
  'cross tenant grant',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-other','case-ci-recovery','grant-ci-recovery','cross-tenant',
      'operator-ci-recovery','lease-ci-recovery','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-recovery','audit-ci-recovery',
      'AUTHORIZED','2026-07-30T10:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

SELECT pg_temp.expect_failure(
  'cross case grant',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-recovery','case-ci-other','grant-ci-recovery','cross-case',
      'operator-ci-recovery','lease-ci-recovery','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-recovery','audit-ci-recovery',
      'AUTHORIZED','2026-07-30T10:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

SELECT pg_temp.expect_failure(
  'cross actor grant',
  $sql$
    INSERT INTO ros_eye_break_glass_grants (
      tenant_id, case_id, grant_id, idempotency_key, actor_id, lease_id,
      actor_role, purpose, data_kind, action, alert_receipt_id, audit_event_id,
      status, authorized_at, policy_version
    ) VALUES (
      'tenant-ci-recovery','case-ci-recovery','grant-ci-recovery','cross-actor',
      'operator-ci-other','lease-ci-recovery','SAFETY_OPERATOR','OPERATOR_REVIEW',
      'EVIDENCE_RAW','READ','alert-ci-recovery','audit-ci-recovery',
      'AUTHORIZED','2026-07-30T10:01:00Z','ros-eye.privacy-security.v4'
    )
  $sql$,
  'lease is not active'
);

-- Proof records are immutable; alert delivery status may progress but receipt binding cannot change.
UPDATE ros_eye_break_glass_alert_outbox
SET status = 'DELIVERED',
    delivered_at = '2026-07-30T10:02:00Z'
WHERE tenant_id = 'tenant-ci-recovery'
  AND case_id = 'case-ci-recovery'
  AND grant_id = 'grant-ci-recovery';

SELECT pg_temp.expect_failure(
  'alert binding mutation',
  $sql$
    UPDATE ros_eye_break_glass_alert_outbox
    SET actor_id = 'operator-ci-mutated'
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  $sql$,
  'alert receipt binding is immutable'
);

SELECT pg_temp.expect_failure(
  'abuse decision mutation',
  $sql$
    UPDATE ros_eye_break_glass_abuse_usage
    SET decision = 'RATE_LIMIT'
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  $sql$,
  'is immutable'
);

SELECT pg_temp.expect_failure(
  'audit binding mutation',
  $sql$
    UPDATE ros_eye_break_glass_use_audit
    SET actor_id = 'operator-ci-mutated'
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  $sql$,
  'is immutable'
);

SELECT pg_temp.expect_failure(
  'grant mutation',
  $sql$
    UPDATE ros_eye_break_glass_grants
    SET policy_version = 'mutated'
    WHERE tenant_id = 'tenant-ci-recovery'
      AND case_id = 'case-ci-recovery'
      AND grant_id = 'grant-ci-recovery'
  $sql$,
  'is immutable'
);

ROLLBACK;

SELECT 'ROS Eye atomic break-glass proof checks passed' AS result;
