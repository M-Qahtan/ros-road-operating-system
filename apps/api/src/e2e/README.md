# Riyadh deterministic E2E safety suites

- `riyadh-pilot.spec.ts` proves the approved happy-path vertical slice.
- `riyadh-failure-modes.spec.ts` proves fail-safe behavior under ambiguity, concurrency, retries, dependency outages, evidence failures, missed human acknowledgement, unauthorized severity downgrade, and unsafe closure attempts.

These suites are simulations. They do not represent real agency integration, medical diagnosis, legal attribution, or autonomous ML authority.
