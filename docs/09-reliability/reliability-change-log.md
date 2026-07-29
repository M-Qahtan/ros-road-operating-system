# Reliability control change log

## 2026-07 — Foundation release gates

- Established repository verification, build, lint, typecheck, and test gates.
- Added PostgreSQL/PostGIS migration, backup, and clean-restore evidence.
- Added generated test-only CI credentials and immutable third-party action pins.
- Added Security workflow, dependency audit, tracked-file secret scan, and CycloneDX SBOM.
- Added commit-identity evidence using candidate head, candidate base, and tested merge SHAs.
- Added deterministic Riyadh E2E and twelve-hazard failure-mode safety suites.
- Added controlled staging Redis and object-storage fault injection with fail-closed readiness and verified recovery.
- Added integrated operational-readiness workflow and final release decision.
- Preserved human authority for medical, legal, governmental, S3/S4, closure, and reopening decisions.

Changes to these controls require a focused pull request, complete evidence regeneration, and review for safety, security, privacy, reliability, and operational impact.
