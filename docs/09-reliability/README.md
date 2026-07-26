# Reliability Operating Model

This directory is the release-governance source of truth for the Riyadh MVP:

- `safety-and-traffic-slos.md`: safety-critical and traffic-efficiency SLIs/SLOs, invariants, error-budget boundaries, safe degradation, privacy, and ownership.
- `operational-readiness-and-release-gates.md`: CI evidence, readiness checklist, RPO/RTO, release and rollback gates.
- `incident-management.md`: severity, escalation, communication, resolution, and post-incident review.

Automation:

- `scripts/verify-operational-readiness.sh` fails closed when mandatory governance evidence is absent.
- `scripts/run-safe-fault-injection.sh` verifies Redis and object-storage outages make readiness unhealthy and recover safely.
- `.github/workflows/ci.yml` treats verification, restore, staging, fault injection, Riyadh E2E, and operational readiness as release-blocking evidence tied to the commit SHA.
