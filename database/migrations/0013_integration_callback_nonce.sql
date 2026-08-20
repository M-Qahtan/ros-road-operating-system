CREATE TABLE integration_callback_nonces (
  client_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  nonce TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, tenant_id, purpose, nonce),
  CONSTRAINT integration_callback_nonces_client_length CHECK (length(client_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_callback_nonces_tenant_length CHECK (length(tenant_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_callback_nonces_purpose_length CHECK (length(purpose) BETWEEN 1 AND 128),
  CONSTRAINT integration_callback_nonces_nonce_length CHECK (length(nonce) BETWEEN 16 AND 256),
  CONSTRAINT integration_callback_nonces_contract_length CHECK (length(contract_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_callback_nonces_key_length CHECK (length(key_id) BETWEEN 1 AND 64),
  CONSTRAINT integration_callback_nonces_expiry_after_claim CHECK (expires_at > claimed_at)
);

CREATE INDEX integration_callback_nonces_expires_at_idx
  ON integration_callback_nonces (expires_at);

CREATE FUNCTION reject_integration_callback_nonce_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'integration_callback_nonces are immutable';
END;
$$;

CREATE TRIGGER integration_callback_nonces_immutable
BEFORE UPDATE ON integration_callback_nonces
FOR EACH ROW
EXECUTE FUNCTION reject_integration_callback_nonce_update();

COMMENT ON TABLE integration_callback_nonces IS
  'Durable one-time callback nonce claims scoped by exact integration principal. contract_id is retained for signed-contract audit; primary uniqueness intentionally excludes contract_id and key_id so a nonce cannot be replayed across contracts or key rotation. Expired-row pruning is explicit maintenance and never occurs in the request path.';
