CREATE TABLE integration_callback_nonces (
  profile_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (profile_id, nonce),
  CONSTRAINT integration_callback_nonces_profile_length CHECK (length(profile_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_callback_nonces_nonce_length CHECK (length(nonce) BETWEEN 16 AND 256),
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
  'Durable one-time callback nonce claims scoped by server-selected integration profile. Expired-row pruning is an explicit maintenance action and never occurs in the callback request path.';
