export const riyadhFailureModeSuite = Object.freeze({
  scope: 'Riyadh MVP',
  machineDecisionAuthority: 'none',
  hazards: [
    'conflicting_signals',
    'low_confidence_signals',
    'late_signals',
    'optimistic_concurrency_conflict',
    'duplicate_and_out_of_order_delivery',
    'postgresql_outage',
    'redis_outage',
    'object_storage_outage',
    'network_partition',
    'evidence_integrity_failure',
    'evidence_quarantine',
    'unauthorized_evidence_access',
    'human_safety_deadline_missed',
    'unauthorized_severity_downgrade',
    'unsafe_road_reopening'
  ] as const
});
