# ADR-001 — Establish the ROS Engineering Control Plane

- **Status:** Proposed for review
- **Date:** 2026-09-19
- **Scope:** Repository engineering governance
- **Authority effect:** None on road/runtime authority

## Context

ROS now contains multiple safety, cognition, evidence, adapter, simulation, and infrastructure workstreams. Increased agent capacity can accelerate delivery, but unmanaged parallelism can also create architecture drift, duplicated work, unsafe authority expansion, weak evidence, and accidental external mutation.

The repository already encodes safety-first design and exact evidence practices. The missing layer is a durable, host-neutral control plane for how human and AI engineering work is coordinated and proven.

## Decision

Adopt an Engineering Control Plane with these properties:

1. bounded task coordination with default WIP 1 and normal maximum durable WIP 3;
2. explicit authority classes: READ_ONLY, PLAN_ONLY, REPO_WRITE, SANDBOX_EXECUTION, LIVE_MUTATION;
3. architecture changes use ADRs and measurable adoption criteria;
4. critical changes require independent review;
5. material claims bind `Requirement → Hazard → Code → Test → Evidence`;
6. tool-level policy blocks or requires approval for risky operations;
7. engineering readiness is kept separate from merge, deployment, external-integration, and public-road authority.

## Consequences

### Positive
- faster parallel execution with lower collision risk;
- stronger auditability and release discipline;
- less architecture drift;
- clearer separation between intelligence and authority;
- easier onboarding of future agents and human engineers;
- safer experimentation with new frameworks and models.

### Costs
- additional governance artifacts for material work;
- critical paths may require an independent reviewer;
- new technologies need benchmark/ADR evidence before adoption.

## Rejected alternatives

### Unlimited agent parallelism
Rejected because throughput without ownership boundaries increases conflicts, duplicated work, and review burden.

### Tooling as architecture
Rejected. Plugins and agent frameworks are engineering instruments, not reasons to reshape ROS runtime architecture.

### Green tests imply release authority
Rejected. Tests establish bounded engineering evidence; they do not provide legal, operational, partner, cloud, or public-road authorization.

## Safety boundary

This ADR introduces no live road, vehicle, camera, emergency, cloud, or partner authority. Any future authority expansion requires a separate explicit decision and evidence package.
