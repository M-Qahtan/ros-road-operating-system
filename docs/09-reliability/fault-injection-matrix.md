# Controlled staging fault-injection matrix

Fault injection is permitted only in isolated CI or staging infrastructure using generated, test-only credentials. It must never target production systems, real road users, emergency agencies, or government services.

| Dependency | Injected condition | Expected liveness | Expected readiness | Required safe behavior | Recovery proof |
|---|---|---:|---:|---|---|
| Redis | Service stopped | HTTP 200 | HTTP 503 | Durable commands continue to rely on PostgreSQL; traffic automation does not claim healthy readiness | Redis healthy and readiness returns 200 |
| Object storage/MinIO | Service stopped | HTTP 200 | HTTP 503 | Evidence-dependent operations fail closed; no fabricated success | MinIO healthy and readiness returns 200 |
| PostgreSQL/PostGIS | Service stopped | Required-worker fail-stop; supervised process restarts | Unavailable until dependency recovery | Safety-critical state changes rejected; no dead worker process advertises liveness | PostgreSQL healthy, API restarted, readiness 200; clean restore and migration invariants pass separately |
| Network disruption | Deterministic simulation | Human review remains available in modeled safe state | Traffic automation suspended | No autonomous downgrade, closure, reopening, or dispatch | Normal mode restored only after verified recovery |

Each drill emits commit-linked JSON evidence. A missing readiness degradation, failed recovery, liveness loss outside the documented PostgreSQL required-worker fail-stop policy, or incomplete evidence blocks release.
