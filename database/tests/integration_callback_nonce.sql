\set ON_ERROR_STOP on

BEGIN;

INSERT INTO integration_callback_nonces (
  client_id, tenant_id, purpose, nonce, contract_id, key_id, expires_at
) VALUES (
  'traffic-sandbox', 'riyadh-pilot', 'TRAFFIC_COORDINATION',
  'nonce-abcdefghijklmnop', 'traffic-status-v1', 'key-old', now() + interval '5 minutes'
);

INSERT INTO integration_callback_nonces (
  client_id, tenant_id, purpose, nonce, contract_id, key_id, expires_at
) VALUES (
  'traffic-sandbox', 'riyadh-pilot', 'TRAFFIC_COORDINATION',
  'nonce-abcdefghijklmnop', 'traffic-closure-v1', 'key-new', now() + interval '5 minutes'
)
ON CONFLICT (client_id, tenant_id, purpose, nonce) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM integration_callback_nonces
    WHERE client_id = 'traffic-sandbox'
      AND tenant_id = 'riyadh-pilot'
      AND purpose = 'TRAFFIC_COORDINATION'
      AND nonce = 'nonce-abcdefghijklmnop'
  ) <> 1 THEN
    RAISE EXCEPTION 'callback nonce replay was not suppressed across contract/key rotation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM integration_callback_nonces
    WHERE client_id = 'traffic-sandbox'
      AND tenant_id = 'riyadh-pilot'
      AND purpose = 'TRAFFIC_COORDINATION'
      AND nonce = 'nonce-abcdefghijklmnop'
      AND contract_id = 'traffic-status-v1'
      AND key_id = 'key-old'
  ) THEN
    RAISE EXCEPTION 'original signed contract/key audit data was not preserved';
  END IF;
END;
$$;

INSERT INTO integration_callback_nonces (
  client_id, tenant_id, purpose, nonce, contract_id, key_id, expires_at
) VALUES (
  'insurance-sandbox', 'riyadh-pilot', 'INSURANCE_COORDINATION',
  'nonce-abcdefghijklmnop', 'insurance-status-v1', 'key-insurance', now() + interval '5 minutes'
);

DO $$
BEGIN
  IF (
    SELECT count(*) FROM integration_callback_nonces
    WHERE nonce = 'nonce-abcdefghijklmnop'
  ) <> 2 THEN
    RAISE EXCEPTION 'same opaque nonce should remain isolated between exact principals';
  END IF;

  BEGIN
    UPDATE integration_callback_nonces
      SET contract_id = 'tampered-contract'
      WHERE client_id = 'traffic-sandbox'
        AND tenant_id = 'riyadh-pilot'
        AND purpose = 'TRAFFIC_COORDINATION'
        AND nonce = 'nonce-abcdefghijklmnop';
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'expected immutable callback nonce update to fail';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  BEGIN
    INSERT INTO integration_callback_nonces (
      client_id, tenant_id, purpose, nonce, contract_id, key_id, expires_at
    ) VALUES (
      'traffic-sandbox', 'riyadh-pilot', 'TRAFFIC_COORDINATION',
      'expired-nonce-abcdef1234', 'traffic-status-v1', 'key-old', now() - interval '1 second'
    );
    RAISE EXCEPTION USING ERRCODE = 'ZX002', MESSAGE = 'expected expiry-before-claim check to fail';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
