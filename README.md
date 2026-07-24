# ROS — Road Operating System

> **The road that became aware.**

ROS is a safety-first road operating system that turns fragmented road signals into one unified, auditable **RoadEvent**, coordinates human-centered incident response, and helps restore traffic flow safely and quickly.

## Riyadh MVP mission

Prove that ROS can manage the complete operational lifecycle of a road incident:

1. detect and validate signals;
2. correlate them into one RoadEvent;
3. contact affected people and assess safety indicators;
4. escalate high-risk cases to human operators;
5. coordinate simulated agencies and traffic actions;
6. preserve evidence and audit history;
7. restore the road and close the event safely.

## Non-negotiable principles

- Human safety before traffic optimization.
- A signal is not an incident; multiple signals may belong to one RoadEvent.
- Explainable rules before unvalidated machine learning.
- Human-in-the-loop for medical, legal, governmental, and high-risk decisions.
- Every sensitive decision and state transition is auditable.
- Modular Monolith first; extract services only when operational evidence justifies it.

## Repository map

```text
apps/                  Deployable applications
packages/              Shared domain, contracts, configuration and observability
infrastructure/        Local and future deployment assets
database/              Migrations and seed data
docs/                  Product, architecture, AI/data, safety and security baselines
.github/                CI, issue templates and contribution workflow
```

## Current status

This is the initial engineering baseline for the Riyadh MVP. It intentionally prioritizes the RoadEvent core, safety workflows, auditability and clean module boundaries over feature breadth.

## Founder

**Mohammed Qahtan** — Founder, ROS
