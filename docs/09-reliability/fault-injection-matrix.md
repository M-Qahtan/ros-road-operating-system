# Controlled staging fault-injection matrix

Fault injection is permitted only in isolated CI or staging infrastructure using generated, test-only credentials. It must never target production systems, real road users, emergency agencies, or government services.

| Dependency | Injected condition | Expected liveness | Expected readiness | Required safe behavior | Recovery proof |
|---|---|---:|---:|---|---|
| Redis | Service stopped | HTTP 200 | HTTP 503 | Durable commands continue to rely on PostgreSQL; traffic automation does not claim healthy readiness | Redis healthy and readiness returns 200 |
| Object storage/MinIO | Service stopped | HTTP 200 | HTTP 503 | Evidence-dependent operations fail closed; no fabricated success | MinIO healthy and readiness returns 200 |
| PostgreSQL/PostGIS | Modeled unavailable in failure suite; restore tested separately | No successful durable write acknowledgement | Not ready | Safety-critical state changes rejected | Clean restore and migration invariants pass |
| Network disruption | Deterministic simulation | Human review remains available in modeled safe state | Traffic automation suspended | No autonomous downgrade, closure, reopening, or dispatch | Normal mode restored only after verified recovery |

Each drill emits commit-linked JSON evidence. A missing readiness degradation, failed recovery, unexpected liveness loss, or incomplete evidence blocks release.
