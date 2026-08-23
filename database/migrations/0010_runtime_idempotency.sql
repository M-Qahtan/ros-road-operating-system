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

CREATE TABLE idempotency_reservations (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fence_token UUID NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key),
  UNIQUE (fence_token),
  CONSTRAINT idempotency_reservations_scope_length CHECK (length(scope) BETWEEN 1 AND 128),
  CONSTRAINT idempotency_reservations_key_length CHECK (length(idempotency_key) BETWEEN 8 AND 128)
);

CREATE INDEX idempotency_reservations_acquired_at_idx
  ON idempotency_reservations (acquired_at);

CREATE FUNCTION reject_idempotency_reservation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'idempotency_reservations cannot be updated';
END;
$$;

CREATE TRIGGER idempotency_reservations_no_update
BEFORE UPDATE ON idempotency_reservations
FOR EACH ROW
EXECUTE FUNCTION reject_idempotency_reservation_update();

COMMENT ON TABLE idempotency_records IS
  'Immutable completed-command replay records.';

COMMENT ON TABLE idempotency_reservations IS
  'Durable pre-execution fences. A reservation is deleted only after the protected operation, including replay persistence, succeeds. Errors or process crashes intentionally leave a fail-closed reservation for explicit reconciliation; request-path code must never auto-expire it.';
