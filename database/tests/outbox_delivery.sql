\set ON_ERROR_STOP on

BEGIN;

TRUNCATE TABLE processed_integration_events, outbox_events CASCADE;

INSERT INTO outbox_events (
  id, aggregate_type, aggregate_id, event_type, payload, correlation_id, trace_id, occurred_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'RoadEvent',
  '22222222-2222-4222-8222-222222222222',
  'SafetyEscalated',
  '{"severity":"S4"}'::jsonb,
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '2026-07-25T03:00:00.000Z'
);

WITH candidates AS (
  SELECT id FROM outbox_events
  WHERE published_at IS NULL AND dead_lettered_at IS NULL
    AND next_attempt_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY occurred_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE outbox_events AS event
SET locked_by = 'worker-a', locked_until = now() + interval '30 seconds'
FROM candidates
WHERE event.id = candidates.id;

DO $$
BEGIN
  IF (SELECT locked_by FROM outbox_events WHERE id = '11111111-1111-4111-8111-111111111111') <> 'worker-a' THEN
    RAISE EXCEPTION 'worker lease was not acquired';
  END IF;
  IF EXISTS (
    SELECT 1 FROM outbox_events
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND (locked_until IS NULL OR locked_until < now())
  ) THEN
    RAISE EXCEPTION 'leased message remained immediately claimable';
  END IF;
END;
$$;

UPDATE outbox_events
SET retry_count = retry_count + 1,
    next_attempt_at = now() + interval '1 minute',
    last_error = 'provider unavailable',
    locked_by = NULL,
    locked_until = NULL
WHERE id = '11111111-1111-4111-8111-111111111111' AND locked_by = 'worker-a';

DO $$
BEGIN
  IF (SELECT retry_count FROM outbox_events WHERE id = '11111111-1111-4111-8111-111111111111') <> 1 THEN
    RAISE EXCEPTION 'retry count was not incremented';
  END IF;
END;
$$;

INSERT INTO processed_integration_events (consumer_name, event_id, status, locked_until)
VALUES ('simulated-ambulance', '11111111-1111-4111-8111-111111111111', 'PROCESSING', now() + interval '1 minute');

INSERT INTO processed_integration_events (consumer_name, event_id, status, locked_until)
VALUES ('simulated-ambulance', '11111111-1111-4111-8111-111111111111', 'PROCESSING', now() + interval '1 minute')
ON CONFLICT (consumer_name, event_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM processed_integration_events) <> 1 THEN
    RAISE EXCEPTION 'consumer idempotency key allowed a duplicate';
  END IF;
END;
$$;

UPDATE processed_integration_events
SET status = 'COMPLETED', completed_at = now(), locked_until = NULL, updated_at = now()
WHERE consumer_name = 'simulated-ambulance'
  AND event_id = '11111111-1111-4111-8111-111111111111';

UPDATE outbox_events
SET retry_count = 3,
    dead_lettered_at = now(),
    last_error = 'poison message'
WHERE id = '11111111-1111-4111-8111-111111111111';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND dead_lettered_at IS NOT NULL
      AND published_at IS NULL
  ) THEN
    RAISE EXCEPTION 'poison message did not enter dead letter state';
  END IF;
END;
$$;

ROLLBACK;
