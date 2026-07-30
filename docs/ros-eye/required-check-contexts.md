# Required check contexts for ROS Eye privacy/security changes

This document records the eight GitHub Actions check contexts required for issue #34 and PR #60 after the repository ruleset was rebound. It does not weaken branch protection and does not modify workflow definitions.

Required contexts:

1. `verify`
2. `riyadh-e2e`
3. `postgres-restore`
4. `staging-fault-injection`
5. `security / dependency-review`
6. `security / repository-security`
7. `failure-mode-safety / riyadh-failure-modes`
8. `operational-readiness`

All eight contexts must be successful on the final candidate head before merge. Evidence v2 must bind the candidate head SHA, candidate base SHA, tested merge SHA, workflow run ID, and attempt.
