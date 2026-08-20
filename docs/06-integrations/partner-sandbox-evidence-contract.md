# ROS Partner Sandbox Evidence Contract v1

## Purpose

This contract defines the evidence boundary used **after** a named external partner grants an approved sandbox window. It prepares ROS to verify that the configured sandbox profile, trust pair and delivery semantics were actually exercised without converting successful sandbox evidence into production or public-road authority.

The executable contract is `apps/api/src/integrations/partner-sandbox-evidence.ts` with schema `ros-partner-sandbox-evidence/v1`.

Current engineering work does **not** contact any external partner endpoint. The validator is prepared now; future evidence cannot reach `VERIFIED_FOR_EXTERNAL_REVIEW` unless it records at least one network call inside an externally approved sandbox window.

## Trust is supplied outside the evidence bundle

The bundle cannot choose its own trusted identity. The validator requires a separate expected-context input containing:

- exact candidate Git SHA;
- `profileId`;
- partner class;
- tenant;
- purpose;
- exact HTTPS sandbox endpoint;
- explicitly allowed mTLS certificate SHA-256 ↔ JWS `kid` pairs;
- approval reference;
- approval start/end timestamps.

The evidence bundle must match that expected context exactly. A different tenant, purpose, endpoint, profile, candidate head or certificate↔`kid` pair fails closed.

The expected context must come from the approved ROS configuration/review package, not from callback/request fields supplied by the partner.

## Partner vocabulary

Supported partner classes remain the current ROS contract:

- `EMERGENCY` → `EMERGENCY_COORDINATION`
- `TRAFFIC` → `TRAFFIC_COORDINATION`
- `ROAD_OPERATOR` → `TRAFFIC_COORDINATION`
- `INSURANCE` → `INSURANCE_COORDINATION`
- `TOWING` → `TOWING_COORDINATION`
- `ROUTING` → `ROUTE_COORDINATION`

Only environment `SANDBOX` is accepted by this evidence contract.

## Evidence required from an authorized sandbox session

A session may become `VERIFIED_FOR_EXTERNAL_REVIEW` only when all of the following are represented and backed by byte-verified receipt files:

- at least one actual call to the approved sandbox endpoint;
- exactly-one logical action semantics;
- zero duplicate logical actions;
- callback authentication verified;
- replayed callback rejected;
- delayed/stale callback rejected;
- outage/recovery behavior verified;
- status/cancel semantics verified;
- minimum-necessary partner projection verified;
- evidence/data minimization maintained;
- no operational authority granted;
- no production activation enabled;
- no real emergency dispatch performed;
- no public-road action performed.

A result of `VERIFIED_FOR_EXTERNAL_REVIEW` is an evidence disposition only. `activationAuthorized` is hard-coded to `false`.

## Receipt integrity

Every referenced receipt file has a safe relative path, byte count and lowercase SHA-256 digest.

Before evaluation, the verifier:

1. resolves the evidence root;
2. rejects symbolic-link and root-escape paths;
3. requires a regular file;
4. compares actual size with the declared size;
5. streams the actual bytes through SHA-256;
6. rejects any mismatch;
7. binds the verification receipt to the canonical bundle SHA, trusted candidate head, approval reference and file count.

Metadata alone cannot verify itself.

Suitable receipt material may include redacted request/response records, TLS peer-certificate fingerprint observations from the approved TLS layer, JWS verification outcome records, correlation/idempotency records, callback/replay traces and outage/recovery logs. Collection must remain minimum-necessary.

## Forbidden evidence content

Do not store private signing keys, bearer credentials, reusable authentication material or production credentials in the evidence bundle or receipt package. The evidence contract uses public identifiers/fingerprints and proof outputs only.

Any need to collect additional sensitive data requires a separate privacy/security approval before collection.

## Required sandbox execution sequence

When a real partner sandbox is later authorized:

1. freeze the candidate SHA under test;
2. freeze the externally approved expected-context document;
3. verify the sandbox approval window is currently valid;
4. establish the approved TLS/session boundary outside this evidence parser;
5. exercise only the approved sandbox operations;
6. capture minimum-necessary receipts;
7. run retry/idempotency, callback replay, delayed-callback and outage/recovery cases;
8. prove status/cancel behavior;
9. verify no duplicate logical action occurred;
10. verify no ROS operational/public-road authority was granted;
11. hash the raw receipt files;
12. run `validate:partner-sandbox-evidence`;
13. submit `VERIFIED_FOR_EXTERNAL_REVIEW` output plus the external approval package to safety/security/privacy/operations review.

## Command

After building the API package:

`node dist/e2e/run-partner-sandbox-evidence-validation.js <bundle.json> <evidence-root> <expected-context.json>`

The command exits non-zero for malformed/untrusted evidence or `NO_GO`.

## Remaining activation gates

Even successful sandbox evidence does not establish:

- production endpoint approval;
- production credentials or certificates;
- government/emergency dispatch authority;
- public-road permission;
- final data-sharing approval;
- production capacity/SRE readiness;
- pilot geography/date/participants;
- live camera permission;
- vehicle actuation permission;
- clinical/legal automation authority;
- autonomous S3/S4 authority.

These remain separate founder/external gates.

## Founder escalation

Escalate before any real network execution when a named partner sandbox endpoint, trust material, data-sharing agreement or execution window becomes available. No external call should be made from this engineering-preparation branch without that authorization.
