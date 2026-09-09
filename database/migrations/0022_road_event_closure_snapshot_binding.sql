BEGIN;

ALTER TABLE ros_eye_safety_fusion_input_snapshots
  ADD CONSTRAINT ros_eye_input_snapshots_closure_binding_key
    UNIQUE (tenant_id, purpose, case_id, input_version, snapshot_digest);

ALTER TABLE road_events
  ADD COLUMN closure_source_input_version integer,
  ADD COLUMN closure_source_snapshot_digest text,
  ADD CONSTRAINT road_events_closure_source_snapshot_complete CHECK (
    (closure_source_input_version IS NULL AND closure_source_snapshot_digest IS NULL)
    OR (
      closure_authorized_by IS NOT NULL
      AND closure_source_input_version IS NOT NULL
      AND closure_source_snapshot_digest IS NOT NULL
      AND
      closure_source_input_version > 0
      AND closure_source_snapshot_digest ~ '^[a-f0-9]{64}$'
    )
  ),
  ADD CONSTRAINT road_events_closure_source_snapshot_fk
    FOREIGN KEY (
      tenant_id, purpose, id, closure_source_input_version, closure_source_snapshot_digest
    )
    REFERENCES ros_eye_safety_fusion_input_snapshots(
      tenant_id, purpose, case_id, input_version, snapshot_digest
    )
    ON DELETE RESTRICT;

COMMENT ON COLUMN road_events.closure_source_input_version IS
  'Optional legacy-compatible binding to the governed input snapshot verified when a human authorized closure.';
COMMENT ON COLUMN road_events.closure_source_snapshot_digest IS
  'Digest copied from the governed input snapshot; execution must revalidate it before closing a high-risk case.';

COMMIT;
