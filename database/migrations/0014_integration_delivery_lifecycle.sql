CREATE TABLE integration_deliveries (
  logical_operation_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  partner TEXT NOT NULL,
  purpose TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  projection JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PREPARED',
  provider_request_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  prepared_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  CONSTRAINT integration_deliveries_profile_length CHECK (length(profile_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_deliveries_partner CHECK (partner IN ('EMERGENCY','TRAFFIC','ROAD_OPERATOR','INSURANCE','TOWING','ROUTING')),
  CONSTRAINT integration_deliveries_purpose CHECK (purpose IN ('EMERGENCY_COORDINATION','TRAFFIC_COORDINATION','INSURANCE_COORDINATION','TOWING_COORDINATION','ROUTE_COORDINATION')),
  CONSTRAINT integration_deliveries_tenant_length CHECK (length(tenant_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_deliveries_request_length CHECK (length(request_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_deliveries_idempotency_length CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  CONSTRAINT integration_deliveries_fingerprint_format CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_deliveries_correlation_length CHECK (length(correlation_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_deliveries_causation_length CHECK (length(causation_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_deliveries_projection_object CHECK (jsonb_typeof(projection) = 'object'),
  CONSTRAINT integration_deliveries_state CHECK (state IN ('PREPARED','ACCEPTED','ACKNOWLEDGED','COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT integration_deliveries_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT integration_deliveries_transport_shape CHECK (
    (state = 'PREPARED' AND provider_request_id IS NULL AND accepted_at IS NULL AND attempt_count = 0)
    OR
    (state <> 'PREPARED' AND provider_request_id IS NOT NULL AND accepted_at IS NOT NULL AND attempt_count >= 1)
  ),
  CONSTRAINT integration_deliveries_time_order CHECK (
    updated_at >= prepared_at AND (accepted_at IS NULL OR accepted_at >= prepared_at)
  ),
  UNIQUE (profile_id, idempotency_key),
  UNIQUE (profile_id, provider_request_id),
  UNIQUE (logical_operation_id, profile_id)
);

CREATE INDEX integration_deliveries_scope_state_idx
  ON integration_deliveries (tenant_id, purpose, state, updated_at DESC);
CREATE INDEX integration_deliveries_profile_state_idx
  ON integration_deliveries (profile_id, state, updated_at DESC);

CREATE FUNCTION enforce_integration_delivery_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.logical_operation_id IS DISTINCT FROM OLD.logical_operation_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.partner IS DISTINCT FROM OLD.partner
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
     OR NEW.projection IS DISTINCT FROM OLD.projection
     OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at THEN
    RAISE EXCEPTION 'integration delivery identity and prepared projection are immutable';
  END IF;

  IF OLD.provider_request_id IS NOT NULL
     AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id THEN
    RAISE EXCEPTION 'integration provider request identity is immutable once assigned';
  END IF;

  IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'integration delivery accepted_at is immutable once assigned';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'integration delivery attempt count cannot decrease';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'integration delivery updated_at cannot move backwards';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'PREPARED' AND NEW.state <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'integration delivery PREPARED may transition only to ACCEPTED';
    ELSIF OLD.state = 'ACCEPTED' AND NEW.state NOT IN ('ACKNOWLEDGED','COMPLETED','FAILED','CANCELLED') THEN
      RAISE EXCEPTION 'integration delivery ACCEPTED transition is invalid';
    ELSIF OLD.state = 'ACKNOWLEDGED' AND NEW.state NOT IN ('COMPLETED','FAILED','CANCELLED') THEN
      RAISE EXCEPTION 'integration delivery ACKNOWLEDGED transition is invalid';
    ELSIF OLD.state IN ('COMPLETED','FAILED','CANCELLED') THEN
      RAISE EXCEPTION 'terminal integration delivery state is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER integration_deliveries_guard
BEFORE UPDATE ON integration_deliveries
FOR EACH ROW
EXECUTE FUNCTION enforce_integration_delivery_update();

CREATE TABLE integration_delivery_callbacks (
  profile_id TEXT NOT NULL,
  callback_id TEXT NOT NULL,
  logical_operation_id TEXT NOT NULL,
  semantic_fingerprint CHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, callback_id),
  CONSTRAINT integration_delivery_callbacks_profile_length CHECK (length(profile_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_delivery_callbacks_id_length CHECK (length(callback_id) BETWEEN 1 AND 128),
  CONSTRAINT integration_delivery_callbacks_fingerprint_format CHECK (semantic_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_delivery_callbacks_profile_operation_fk
    FOREIGN KEY (logical_operation_id, profile_id)
    REFERENCES integration_deliveries(logical_operation_id, profile_id)
);

CREATE INDEX integration_delivery_callbacks_operation_idx
  ON integration_delivery_callbacks (logical_operation_id, received_at DESC);

CREATE FUNCTION reject_integration_delivery_callback_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'integration delivery callback records are append-only';
END;
$$;

CREATE TRIGGER integration_delivery_callbacks_append_only_update
BEFORE UPDATE ON integration_delivery_callbacks
FOR EACH ROW
EXECUTE FUNCTION reject_integration_delivery_callback_mutation();

CREATE TRIGGER integration_delivery_callbacks_append_only_delete
BEFORE DELETE ON integration_delivery_callbacks
FOR EACH ROW
EXECUTE FUNCTION reject_integration_delivery_callback_mutation();

COMMENT ON TABLE integration_deliveries IS
  'Persistent SIMULATION_ONLY partner delivery state. Transport/provider status never grants ROS road, clinical, legal, or S3/S4 operational authority.';
COMMENT ON TABLE integration_delivery_callbacks IS
  'Append-only logical callback deduplication records bound to the exact trusted partner profile after callback authentication/replay checks.';
