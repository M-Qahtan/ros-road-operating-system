CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT idempotency_records_scope_length CHECK (length(scope) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_records_key_length CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT idempotency_records_fingerprint_sha256 CHECK (fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idempotency_records_created_at_idx
  ON idempotency_records (created_at);

CREATE FUNCTION reject_idempotency_record_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'idempotency_records are immutable';
END;
$$;

CREATE TRIGGER idempotency_records_immutable
BEFORE UPDATE ON idempotency_records
FOR EACH ROW
EXECUTE FUNCTION reject_idempotency_record_update();

COMMENT ON TABLE idempotency_records IS
  'Durable completed-command replay records. Atomic pre-execution reservation/fencing remains a separate runtime gate.';
