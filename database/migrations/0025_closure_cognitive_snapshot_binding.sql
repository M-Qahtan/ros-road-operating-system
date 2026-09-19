BEGIN;

ALTER TABLE ros_eye_cognitive_input_snapshot_bindings
  ADD CONSTRAINT ros_eye_cognitive_closure_binding_key UNIQUE (
    tenant_id, purpose, case_id, input_version, policy_version,
    cognitive_revision, cognitive_digest
  );

ALTER TABLE road_events
  ADD COLUMN closure_cognitive_policy_version text,
  ADD COLUMN closure_cognitive_revision integer,
  ADD COLUMN closure_cognitive_digest text,
  ADD CONSTRAINT road_events_closure_cognitive_complete CHECK (
    (closure_cognitive_policy_version IS NULL
      AND closure_cognitive_revision IS NULL
      AND closure_cognitive_digest IS NULL)
    OR (
      closure_source_input_version IS NOT NULL
      AND closure_source_snapshot_digest IS NOT NULL
      AND closure_cognitive_policy_version = 'ros-eye.input-snapshot.v2'
      AND closure_cognitive_revision > 0
      AND closure_cognitive_digest ~ '^[a-f0-9]{64}$'
    )
  ),
  ADD CONSTRAINT road_events_closure_cognitive_fk FOREIGN KEY (
    tenant_id, purpose, id, closure_source_input_version,
    closure_cognitive_policy_version, closure_cognitive_revision, closure_cognitive_digest
  ) REFERENCES ros_eye_cognitive_input_snapshot_bindings (
    tenant_id, purpose, case_id, input_version,
    policy_version, cognitive_revision, cognitive_digest
  ) ON DELETE RESTRICT;

COMMENT ON COLUMN road_events.closure_cognitive_revision IS
  'Cognitive source revision verified when a human authorized high-risk closure; execution revalidates it without rewriting authorization history.';
COMMENT ON COLUMN road_events.closure_cognitive_digest IS
  'Owner-ledger cognitive digest bound to the authorization. It grants no closure or execution authority.';

COMMIT;
