# Integration Contracts

Status: **SANDBOX / SIMULATION_ONLY until external and founder approval**

External agencies and providers are accessed through adapters supporting prepare, send, status, cancel and callback operations. Riyadh MVP agency adapters are simulations, not official dispatch channels.

Every integration must implement idempotency, timeout, retry, circuit breaker, status tracking, audit and a non-blocking failure mode. No adapter may bypass the HumanSafetyCase/RoadEvent authority boundary or turn a recommendation into a real external action without the explicitly approved human/agency authority path.

## 1. Trust boundary

Production callers may not self-attest identity, role, tenant, purpose or MFA state through request headers or payload fields.

The canonical integration identity contract is:

- `subject`: cryptographically verified service/user subject;
- `issuer`: exact trusted OIDC issuer;
- `audience`: must contain the ROS API audience;
- `clientId`: exact approved integration client;
- `tenantId`: authoritative tenant scope;
- `purpose`: one approved operational purpose;
- `authenticationMethods`: authoritative authentication context; MFA is required where policy says so;
- `issuedAt` / `expiresAt`: freshness and session-age enforcement.

Code must obtain these claims only from an `OidcTokenVerifierPort` implementation that has verified the bearer token. Development/test simulation headers are explicitly isolated and production rejects them.

The current engineering contract supports these bounded purposes:

- `INCIDENT_TRIAGE`
- `EMERGENCY_COORDINATION`
- `TRAFFIC_COORDINATION`
- `INSURANCE_COORDINATION`
- `TOWING_COORDINATION`
- `ROUTE_COORDINATION`

A trusted identity for one purpose must fail closed when reused for another purpose.

## 2. Callback authenticity and replay safety

Sandbox callback verification currently requires:

1. an externally supplied HMAC-SHA256 key with at least 32 bytes of key material;
2. signature comparison using constant-time verification;
3. an authenticated timestamp;
4. bounded request age;
5. bounded future clock skew;
6. a non-empty nonce;
7. an authoritative replay store that atomically claims each nonce once.

The canonical signed material is:

`timestamp.nonce.body`

Production partner profiles may require mTLS and/or JWS in addition to HMAC. Those profiles remain **not activated** until certificate/key rotation, trust anchors and partner contracts are approved and tested.

## 3. Delivery semantics

Outbound operational integration delivery is **at-least-once transport with idempotent logical action**. Each provider adapter must preserve:

- stable logical operation ID;
- idempotency key;
- correlation ID and causation ID;
- exact target/provider identity;
- attempt number;
- bounded timeout;
- retry/backoff policy;
- terminal/dead-letter state;
- immutable audit relationship to the originating RoadEvent/HumanSafetyCase;
- no silent conversion of transport success into operational success.

A retry must never create a second logical dispatch, tow request, insurer request, traffic command or equivalent external action.

## 4. Adapter lifecycle

Each provider-neutral adapter exposes the conceptual lifecycle:

1. `prepare` — build the minimum-necessary projection and validate authority;
2. `send` — submit once using the stable logical operation ID;
3. `status` — obtain/consume the provider state without weakening ROS authority;
4. `cancel` — request cancellation only when the external contract permits it and ROS authority permits it;
5. `callback` — authenticate, freshness-check, replay-check and correlate the asynchronous result.

A provider outage must enter a visible degraded/retry/human-review state. It must not cause autonomous S3/S4 downgrade, closure, road reopening, diagnosis or legal-fault determination.

## 5. Minimum-necessary data projections

Raw ROS case data is never the default integration payload. Each adapter must create a purpose-specific projection and exclude unrelated sensitive data.

| Integration class | Purpose | Minimum engineering projection | Excluded by default |
|---|---|---|---|
| Emergency sandbox | `EMERGENCY_COORDINATION` | event ID, verified location required for response, severity/urgency indicators, contact coordination state, correlation metadata | raw camera/video, unrelated identity data, insurer data, legal-fault conclusions |
| Traffic sandbox | `TRAFFIC_COORDINATION` | event ID, road/location segment, verified road-impact state, confidence/staleness metadata, correlation metadata | medical/contact narrative, raw evidence, insurer data |
| Insurance sandbox | `INSURANCE_COORDINATION` | event/reference ID, approved incident metadata, approved evidence references, correlation metadata | live emergency-contact state, unrelated location history, raw credentials |
| Towing sandbox | `TOWING_COORDINATION` | event/request ID, approved pickup location, vehicle/service class when authorized, correlation metadata | medical data, unrelated evidence, legal-fault conclusion |
| Maps/routes sandbox | `ROUTE_COORDINATION` | qualified road-state/impact projection, freshness/confidence, route/segment identifiers | person identity, medical/contact data, raw evidence |
| Camera gateway | future approved scope only | metadata/provenance required for approved ingestion | continuous production feed unless separately approved |
| Vehicle-control gateway | future approved scope only | **no production actuation in current scope** | all actuation commands until explicit external/founder authorization |

Existing ROS privacy controls remain authoritative for tenant/case/purpose, minimum necessary data, consent, break-glass access and immutable audit. Integration code cannot create a parallel weaker policy path.

## 6. Key and certificate lifecycle

Before a production partner can be activated, its profile must define and test:

- trust anchor/issuer and audience;
- client/service identity;
- short-lived credential mechanism;
- mTLS certificate issuance where required;
- HMAC/JWS signing-key source where required;
- active + previous key overlap window for controlled rotation;
- revocation/compromise procedure;
- nonce/replay retention policy;
- clock source and tolerated skew;
- zero long-lived credentials committed to source or CI artifacts.

Rotation tests must prove that the intended overlap works while expired/revoked/unknown keys fail closed.

## 7. Sandbox acceptance gates

`INTEGRATION_SANDBOX_READY` may be declared only when all of the following are true on the exact candidate head:

- caller identity, tenant, purpose and MFA cannot be self-attested;
- OIDC/JWT cryptographic verification is wired through an approved verifier implementation;
- callbacks are authenticated, fresh and replay-safe using a durable nonce store;
- cross-tenant and cross-purpose access tests fail closed;
- retries cannot create a duplicate logical external action;
- adapters cannot bypass HumanSafetyCase/RoadEvent transition authority;
- minimum-necessary projections are covered by tests;
- key/certificate rotation and revocation tests pass where applicable;
- dependency outage and delayed/stale callback tests pass;
- automated tests contact no real external endpoint;
- no unresolved P0/P1 security or safety finding remains.

## 8. External approval matrix

Engineering readiness is separate from external authorization. Values below stay `PENDING` until evidence is attached to the exact approved partner/profile.

| Integration | Engineering sandbox | External contract/data sharing | Production credentials | Live activation |
|---|---|---|---|---|
| Emergency services | IN PROGRESS | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Traffic/road authority | IN PROGRESS | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Insurance | IN PROGRESS | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Towing | IN PROGRESS | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Maps/routes | IN PROGRESS | PENDING | PENDING | FORBIDDEN UNTIL APPROVED |
| Production camera program | NOT AUTHORIZED | PENDING | PENDING | FORBIDDEN |
| Vehicle actuation | NOT AUTHORIZED | PENDING | PENDING | FORBIDDEN |

## 9. Founder escalation

Founder approval is required before:

- sharing a production credential/certificate;
- signing or accepting a production operational/data-sharing contract;
- enabling a real emergency, traffic, insurer, towing or other partner endpoint;
- changing the human-authority boundary;
- enabling a production camera scope;
- enabling any vehicle-actuation scope.

Until then, all agency/provider behavior remains deterministic sandbox/simulation behavior only.
