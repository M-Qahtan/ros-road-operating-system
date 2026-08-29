# ROS MVP Acceptance Gate

## Decision boundary

This gate demonstrates the deterministic software MVP at its public client and HTTP-handler seams. It does not authorize deployment, Terraform apply, production partner traffic, public-road activation, or a controlled pilot.

The gate uses the production RS256/JWKS verifier with locally generated short-lived test credentials. In-memory adapters replace PostgreSQL and object storage only to keep the acceptance run deterministic and independent of external services; they do not replace the authentication or tenant/purpose authorization boundary.

## Requirement to evidence

| Requirement | Principal hazard | Acceptance path | Expected evidence |
| --- | --- | --- | --- |
| Applied migrations remain immutable and new migrations are forward-only | Checksum drift, gaps, or nested transaction controls leave partial schema state outside the ledger | Pin SHA-256 for `0001` through `0015`; require contiguous numbering; prepare every source through the runtime migration runner | 15 pinned checksums; `0001` first and `0015` last; four legacy outer wrappers safely stripped |
| A registered device opens durable consent/contact state, reaches a nearby authenticated mobile principal, and can be acknowledged | Unregistered device use, cross-tenant disclosure, self-attested authority, local-only consent, missing contact session, or duplicate acknowledgement | Signed least-privilege `FIELD_USER` bearer -> server-time device/consent receipt -> mobile RoadEvent report/signal -> contact open -> consent/language callbacks -> dashboard state transitions -> tracked nearby delivery -> acknowledgement -> nearby re-query | Active device bound to the trusted principal; `CONTACTING` durable contact at version 3; one `CONFIRMED` S3 event; one recipient delivery; one logical acknowledgement audit record; other tenant sees zero records |
| Human Safety actions use trusted operator and supervisor identity | Actor or role supplied in the browser body authorizes a safety-critical command | Dashboard list -> operator takeover -> supervisor assignment, while deliberately supplying forged body identity/roles | Assigned actor comes from verified bearer; final audit actor is the verified supervisor; evidence provenance remains visible |
| Evidence metadata, checksum, and audit stay scoped to the RoadEvent | Tampered or cross-tenant evidence is preserved or disclosed | Upload intent -> independently hashed local bytes -> completion -> audited download intent -> cross-tenant download attempt | `PRESERVED`; verified SHA-256; append-only upload/preserved/download-intent audit actions; cross-tenant not-found |

## Run from the repository root

Build the public packages and run the acceptance executable directly:

```powershell
pnpm.cmd --filter @ros/contracts build
pnpm.cmd --filter @ros/domain build
pnpm.cmd --filter @ros/api build
pnpm.cmd --filter @ros/operations-dashboard build
pnpm.cmd --filter @ros/mobile build
node scripts/mvp-acceptance.mjs
```

Success is a zero exit code and a JSON document with top-level `status: "PASS"`. Any failed invariant terminates with a non-zero exit code.

## Required neighboring checks

The acceptance executable supplements rather than replaces:

- the migration-runner unit tests, especially rollback without a migration-ledger insert;
- persistent startup migration tests, including checksum mismatch and cleanup before Redis starts;
- contact-open, durable consent/language callback, no-response worker, and contact-outbox tests;
- device registration/rebinding, FIELD_USER ownership-before-replay, and recipient notification delivery/acknowledgement tests;
- `apps/api/src/http/evidence-http.spec.ts`, covering authorization-before-replay, changed authorization, role enforcement, completion idempotency, and route isolation;
- API, dashboard, and mobile package tests;
- repository lint, type checking, build, and verification;
- PostgreSQL/Redis/Object Storage integration workflows for release evidence.

## Known boundary

The deterministic executable exercises `EvidenceService`, its scoped RoadEvent authorization adapter, byte checksum verification, scanner, repository audit port, and object-storage port. The integrated API now also exposes authenticated `POST /api/v1/road-events/:roadEventId/evidence/upload-intents`, `POST /api/v1/evidence/:evidenceId/complete`, and `POST /api/v1/evidence/:evidenceId/download-intents` routes. Their handler-level trust, replay, and role behavior is verified separately by `apps/api/src/http/evidence-http.spec.ts`.

The mobile journey uses the provisioned least-privilege `FIELD_USER` role and a durable server-side device binding. Registration is not hardware/device attestation: it binds an opaque app-instance UUID to the trusted principal and records a server-time consent receipt under a fixed policy version. Deployment still requires an external approved OIDC/BFF host to perform login, refresh short-lived tokens, and install the in-memory browser session bridge; no token or authority is embedded in static HTML. The repository cannot supply an issuer registration, client registration, user directory, or production device-attestation service without deployment-owned identity configuration.

Nearby delivery uses authenticated polling with a durable recipient delivery row and one logical acknowledgement. Push/WebSocket transport remains an activation backlog item and is not claimed by this deterministic software gate.
