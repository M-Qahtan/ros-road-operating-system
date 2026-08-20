# Integration Contracts

Status: **SANDBOX / SIMULATION_ONLY until external and founder approval**

ROS integration code may prepare, persist and simulate partner delivery, but no current contract authorizes a real emergency, traffic, road-operator, insurer, towing or routing endpoint. Transport/provider success never grants ROS road, clinical, legal, S3/S4 or public-safety authority.

## 1. Authoritative caller identity

Production-like caller identity cannot be self-attested through request headers or payload fields. The trusted OIDC/JWT path requires cryptographic verification before claims are accepted.

The current trusted service principal is bound by the exact tuple:

- `subject` — provisioned ROS UUID;
- `issuer` — exact trusted HTTPS issuer;
- `audience` — must contain the ROS API audience;
- `clientId`;
- `tenantId`;
- `purpose`;
- explicit MFA authentication context;
- bounded `issuedAt` / `expiresAt`.

Runtime authorization uses exact `{clientId, tenantId, purpose}` bindings, not independent allowlists. This prevents a valid client from combining a tenant or purpose assigned to another partner.

OIDC `tenantId` and `purpose` flow directly into the persisted RoadEvent server-side ABAC boundary. Attacker-supplied `x-actor-id`, `x-ros-roles`, `x-tenant-id` and `x-purpose` do not override the trusted OIDC principal.

## 2. Callback HMAC authenticity and replay safety

The implemented HMAC callback profile separates trusted configuration from request-shaped data:

- trusted: `TrustedCallbackProfile { profileId, secret }`;
- request: exact raw body, timestamp, nonce and signature only.

The canonical HMAC material is the UTF-8 JSON encoding of:

`[timestampEpochSeconds, profileId, nonce, exactRawBody]`

Requirements:

1. HMAC-SHA256;
2. key material between 32 and 4096 bytes;
3. constant-time digest comparison;
4. exact raw body — no parse/re-serialize before verification;
5. bounded callback age and future clock skew;
6. canonical nonce between 16 and 256 characters;
7. canonical trusted profile ID;
8. authenticated body limit of 1 MiB;
9. durable PostgreSQL one-time claim keyed by `(profile_id, nonce)`;
10. replay-store outage fails closed;
11. nonce rows are immutable; expiry pruning is an explicit maintenance action, not request-path behavior.

Profile identity is inside the signed material. Therefore accidental HMAC-key reuse across two configured profiles does not make a callback signature transferable between those profiles.

## 3. JWS + mTLS sandbox trust profile

ROS also implements an executable **SANDBOX-only** trust contract for partners that require JWS plus mTLS.

This layer does not establish the TLS session itself. It consumes the SHA-256 fingerprint of the peer certificate exposed by an already validated TLS termination/client stack, then enforces ROS-specific pinning and JWS policy.

Required trust conditions:

- one of 1–4 explicitly pinned peer-certificate SHA-256 fingerprints must match;
- detached compact JWS form: `<protected-header>..<signature>`;
- JWS algorithm exactly `RS256`;
- type exactly `ros-callback+jws`;
- RSA public key >= 2048 bits;
- exact trusted `kid`;
- protected headers must bind:
  - `ros_profile`;
  - `ros_tenant`;
  - `ros_purpose`;
- signature input is `<protected-header>.<base64url(exactRawBody)>`;
- raw body is limited to 1 MiB;
- detached JWS is bounded to 32 KiB;
- unknown, expired, not-yet-valid and revoked keys fail closed.

Rotation is represented by a bounded set of active verification keys. Controlled overlap may admit the retiring and replacement key simultaneously; after the old key's `notAfter`, or after explicit revocation, it is rejected while the replacement key remains accepted.

Only `environment: SANDBOX` is accepted by the current executable trust profile. Production activation is not implemented by this contract.

## 4. Persistent delivery semantics

Outbound partner delivery uses **at-least-once transport semantics with exactly-one logical ROS operation**.

The persistent current-stack contract preserves:

- stable logical operation ID;
- full trusted profile binding: `profileId + partner + purpose + tenantId`;
- idempotency key;
- immutable semantic request fingerprint;
- correlation and causation IDs;
- immutable minimum-necessary projection;
- deterministic provider request ID in simulation;
- immutable original `accepted_at` receipt time;
- monotonic attempt count;
- row-locked concurrent `send()` behavior;
- persisted restart/retry semantics;
- append-only logical callback deduplication;
- terminal-state non-resurrection.

Two concurrent sends for the same logical operation must produce one provider request identity and leave `attempt_count = 1`. A process restart or later retry returns the original receipt rather than producing another logical action.

## 5. Lifecycle and state authority

Provider-neutral lifecycle:

1. `prepare` — validate trusted partner/scope and persist minimum-necessary projection;
2. `send` — acquire the operation row lock and create/reuse one simulated provider request;
3. `status` — read only within the exact trusted profile binding;
4. `cancel` — idempotent same-semantics cancellation only when state permits;
5. `callback` — process only after the transport callback has independently passed authenticity/freshness/replay verification.

Allowed state transitions are guarded at PostgreSQL level:

- `PREPARED -> ACCEPTED`;
- `ACCEPTED -> ACKNOWLEDGED | COMPLETED | FAILED | CANCELLED`;
- `ACKNOWLEDGED -> COMPLETED | FAILED | CANCELLED`;
- `COMPLETED | FAILED | CANCELLED` are terminal and cannot be resurrected.

Callback records are append-only. Delayed callbacks older than the current delivery state are rejected.

## 6. Minimum-necessary partner projections

| Partner class | Purpose | Current engineering projection | Excluded by default |
|---|---|---|---|
| Emergency | `EMERGENCY_COORDINATION` | event ID, occurrence time, response location, severity level, Human Safety response state | personal references, evidence refs, insurer data, severity score/reason codes, legal conclusions |
| Traffic | `TRAFFIC_COORDINATION` | event ID, time, location, severity level, road segment/impact state | medical/contact details, evidence refs, insurer data, severity score/reason codes |
| Road operator | `TRAFFIC_COORDINATION` | event ID, time, location, road segment/impact state | medical/contact details, evidence refs, insurer data |
| Insurance | `INSURANCE_COORDINATION` | event ID, time, location, approved policy reference | Human Safety narrative, evidence refs, unrelated identity data |
| Towing | `TOWING_COORDINATION` | event ID, pickup location, vehicle class/mobility | medical data, evidence refs, legal-fault conclusion |
| Routing | `ROUTE_COORDINATION` | event ID and road impact/segment state | person identity, medical/contact data, evidence refs |

Production camera ingestion and vehicle actuation remain outside this integration contract and are **forbidden until separately approved**.

## 7. Rotation, revocation and credential governance

Every real partner onboarding package must define before activation:

- exact partner/profile/tenant/purpose binding;
- OIDC issuer/audience/client binding where used;
- callback authentication mode: HMAC and/or JWS+mTLS;
- key/certificate owner and secure source;
- issuance and expiry dates;
- active/replacement overlap window;
- emergency revocation procedure;
- certificate pin replacement procedure;
- nonce retention/pruning policy;
- approved clock source and tolerated skew;
- no long-lived secret committed to source, CI logs or artifacts;
- incident procedure for compromised partner credentials.

## 8. Sandbox acceptance gates

`INTEGRATION_SANDBOX_READY` may be declared only when all applicable gates are evidenced on the exact candidate stack:

- trusted OIDC identity/scope cannot be self-attested;
- exact client/tenant/purpose binding is enforced;
- resource-level tenant/purpose ABAC is fail-closed;
- callback HMAC authenticity and durable profile-scoped replay protection pass;
- applicable JWS+mTLS certificate pinning, scope binding, rotation and revocation tests pass;
- partner lifecycle is persistent and exactly-one at the logical-action level under retry/concurrency/restart;
- minimum-necessary projection tests pass;
- delayed/stale callback and terminal-state tests pass;
- dependency outage behavior is fail-closed or visibly degraded;
- automated engineering tests contact no real external endpoint;
- no unresolved P0/P1 safety/security finding remains;
- exact real sandbox endpoint/trust anchors/certificates are approved for the selected partner;
- retry/outage/callback evidence is produced against that approved sandbox;
- external legal/privacy/operational approvals are attached where required.

The first nine items can be proven internally. The last three are external activation gates and cannot be inferred from simulation evidence.

## 9. Current external approval matrix

| Integration | Internal engineering stack | External contract/data sharing | Real sandbox trust/credentials | Live activation |
|---|---|---|---|---|
| Emergency services | ENGINEERING COMPONENTS READY FOR STACK REVIEW | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Traffic / road authority | ENGINEERING COMPONENTS READY FOR STACK REVIEW | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Insurance | ENGINEERING COMPONENTS READY FOR STACK REVIEW | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Towing | ENGINEERING COMPONENTS READY FOR STACK REVIEW | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Maps / routing | ENGINEERING COMPONENTS READY FOR STACK REVIEW | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Production camera program | NOT AUTHORIZED | PENDING | PENDING | FORBIDDEN |
| Vehicle actuation | NOT AUTHORIZED | PENDING | PENDING | FORBIDDEN |

## 10. Founder escalation

Fresh founder/external approval is required before any of the following:

- accepting or installing a production credential, private key or certificate;
- contacting a real partner sandbox when that contact has not already been explicitly authorized;
- signing/accepting an operational or data-sharing contract;
- enabling any real emergency, traffic, road-operator, insurer, towing or routing endpoint;
- changing the Human Safety / S3/S4 authority boundary;
- production camera ingestion;
- vehicle actuation;
- deployment or cloud mutation not separately authorized.

Until those gates are approved, all partner delivery remains deterministic sandbox/simulation behavior only.
