ALTER TABLE road_events
  ADD COLUMN severity_requires_human_review BOOLEAN NOT NULL DEFAULT TRUE,
  ADD CONSTRAINT road_events_high_severity_requires_human_review CHECK (
    severity NOT IN ('S3', 'S4') OR severity_requires_human_review
  );

CREATE INDEX road_events_occurred_at_idx
  ON road_events (occurred_at DESC, id DESC);

CREATE INDEX road_events_severity_time_idx
  ON road_events (severity, occurred_at DESC, id DESC);

COMMENT ON COLUMN road_events.severity_requires_human_review IS
  'Persisted safety control. S3/S4 assessments must remain human-reviewed.';
