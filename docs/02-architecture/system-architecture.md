# System Architecture

## Baseline

ROS begins as a **Modular Monolith with event-driven internals**. Modules deploy together initially but own explicit domain boundaries and communicate through application contracts and domain events.

```text
Mobile / Operations Dashboard
            |
       REST + WebSocket
            |
Identity | Signal Ingestion | RoadEvent | Safety | Operations
Notifications | Maps | Evidence | Integrations | Reporting | Audit
            |
PostgreSQL/PostGIS | Redis | Object Storage | Outbox Workers
```

## Rules

- PostgreSQL is the source of truth.
- Redis is used for cache, locks, rate limits and transient jobs only.
- Files live in object storage; PostgreSQL stores immutable metadata.
- External providers are hidden behind adapters.
- Outbox guarantees business state and emitted events are committed together.
- Domain code must not depend on framework or infrastructure code.

## First extraction candidates

Signal ingestion, notifications, evidence processing, AI inference and external integrations may become services only after load, failure isolation or team ownership justify extraction.
