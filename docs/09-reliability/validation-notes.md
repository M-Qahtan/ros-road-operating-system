# Operational-readiness validation notes

Issue: #22

## Required pre-merge proof

The final PR head must produce successful results for:

- repository verify, build, lint, typecheck, and tests;
- PostgreSQL/PostGIS migrations, backup, and clean restore;
- isolated staging baseline readiness, Redis fault, object-storage fault, fail-closed readiness, and verified recovery;
- Riyadh E2E;
- Security dependency audit, secret scan, and SBOM;
- the complete Riyadh failure-mode safety suite;
- the final `operational-readiness` decision.

All evidence must identify the candidate head, reviewed base, and tested merge SHAs. Missing, empty, stale, skipped, cancelled, or failed evidence blocks merge and release.

## Post-merge proof

After merge, the same workflows must succeed on the exact new `main` SHA. The repository ruleset must then require the final `operational-readiness` check in addition to the established CI and Security checks.

## Scope boundary

Validation proves engineering readiness for the approved Riyadh MVP boundary. It is not authorization for production government integration, medical or legal decision-making, autonomous external dispatch, autonomous severity downgrade/resolution, or autonomous road closure/reopening.
