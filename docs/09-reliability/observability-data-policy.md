# Observability data policy

## Purpose

Observability supports reliability, security, incident response, and auditability while minimizing collection and preventing sensitive data from entering general telemetry systems.

## Allowed telemetry

- service health, readiness, latency, error counts, queue depth, retry counts, and dependency status;
- pseudonymous event and correlation identifiers;
- state names, policy versions, evidence revisions, and authorization outcomes;
- coarse region or road-segment identifiers when operationally necessary;
- workflow run, candidate head, candidate base, and tested merge SHAs;
- sanitized failure codes and bounded diagnostic metadata.

## Prohibited telemetry

General logs, metrics, traces, dashboards, and build artifacts must not contain:

- names, phone numbers, national identifiers, account identifiers, or device advertising identifiers;
- medical statements, symptoms, diagnosis, voice content, or conversation transcripts;
- precise location, continuous movement history, exact home/work coordinates, or unrestricted geospatial traces;
- raw images, video, audio, evidence payloads, evidence access tokens, or cryptographic secrets;
- passwords, API keys, JWTs, session cookies, database URLs with credentials, or object-storage credentials;
- legal-fault assertions, liability conclusions, or unapproved government case data.

## Handling rules

Sensitive operational data belongs in purpose-specific stores with least-privilege access, encryption, retention policy, consent or lawful basis, and immutable access audit. Logs reference protected records by pseudonymous identifiers rather than copying content.

Telemetry fields follow an allow-list. Unknown fields are rejected or redacted before export. Free-text logging is prohibited on safety and evidence paths unless explicitly reviewed.

## Retention

- routine application telemetry: 30 days unless a shorter approved period applies;
- security and release evidence: 365 days minimum;
- final release decisions: 365 days;
- incident evidence: retained according to legal hold, safety, privacy, and governmental requirements.

Retention expiration triggers verified deletion or approved archival. Legal hold suspends deletion only for the scoped records and duration.

## Access and monitoring

Access is role-based, time-bounded where practical, and reviewed. Exports require an approved purpose. Unauthorized access, excessive querying, or attempted retrieval of protected fields generates a security event and may block release or operation.
