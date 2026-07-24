# ADR-001: Modular Monolith First

**Status:** Accepted

## Context

The Riyadh MVP needs fast iteration, strong data consistency and a small operational surface. Premature microservices would add distributed failure modes before domain boundaries are proven.

## Decision

Deploy one backend application with independently owned modules, explicit contracts, architecture tests and an internal event/outbox mechanism.

## Consequences

The team must enforce module boundaries in code review and tests. Services may be extracted later without changing the domain language.
