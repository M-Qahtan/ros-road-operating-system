ALTER TABLE outbox_events
  ADD COLUMN trace_id UUID,
  ADD COLUMN locked_by TEXT,
  ADD COLUMN locked_until TIMESTAMPTZ,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN last_error TEXT,
  ADD CONSTRAINT outbox_lock_complete CHECK (
    (locked_by IS NULL AND locked_until IS NULL)
    OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)
  ),
  ADD CONSTRAINT outbox_terminal_state_exclusive CHECK (
    published_at IS NULL OR dead_lettered_at IS NULL
  );

CREATE INDEX outbox_delivery_ready_idx
  ON outbox_events (next_attempt_at, occurred_at, id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE processed_integration_events (
  consumer_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
  locked_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id),
  CONSTRAINT processed_event_state_complete CHECK (
    (status = 'PROCESSING' AND locked_until IS NOT NULL AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND locked_until IS NULL AND completed_at IS NOT NULL)
  )
);

COMMENT ON COLUMN outbox_events.dead_lettered_at IS
  'Terminal delivery failure after the configured retry limit.';
COMMENT ON TABLE processed_integration_events IS
  'Consumer-side idempotency ledger for simulated and future integration consumers.';
