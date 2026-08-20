# Partner Onboarding Readiness

Status: **ENGINEERING PREPARATION ONLY — NO REAL PARTNER ACTIVATION AUTHORIZED**

This document separates what ROS can prove internally from decisions/evidence that require an external partner, security/privacy review, and founder authorization.

## 1. Mandatory profile identity

Every partner profile must have one immutable approved binding:

- `profileId`;
- partner class;
- tenant;
- operational purpose;
- sandbox endpoint base URL;
- identity mechanism;
- callback-authentication mechanism;
- data projection/version;
- operational owner;
- security owner;
- privacy/data-sharing owner.

A profile ID may not be silently reused with a different tenant, partner or purpose.

## 2. Internal engineering evidence available

The current stacked engineering implementation can prove, without contacting a real partner:

- OIDC/JWT signature verification before identity is trusted;
- exact `{clientId, tenantId, purpose}` principal binding;
- resource-level tenant/purpose ABAC;
- profile-scoped callback HMAC authenticity and durable replay protection;
- request data cannot override trusted callback profile identity;
- persistent exactly-one logical partner operation under concurrency/retry/restart;
- minimum-necessary projections;
- delayed callback rejection and terminal-state non-resurrection;
- JWS-RS256 detached-signature verification;
- mTLS peer certificate SHA-256 pin enforcement after TLS validation;
- partner/profile/tenant/purpose protected-header binding;
- key and certificate overlap windows for controlled rotation;
- expired/revoked/unknown key or certificate rejection;
- SANDBOX-only trust-profile enforcement;
- zero real partner network calls in engineering verification.

These are engineering controls, not proof that any government or commercial partner has approved them.

## 3. Per-partner external evidence package

Before a real sandbox may be contacted, attach all applicable evidence below to the exact partner profile.

| Gate | Required evidence | Owner | Status |
|---|---|---|---|
| Partner identity | legal/technical partner identity and named technical owner | External/PMO | PENDING |
| Sandbox endpoint | exact approved HTTPS base URL and ownership confirmation | Partner + Security | PENDING |
| OIDC trust | issuer, audience, client ID, tenant/purpose binding, JWKS URL if applicable | Partner + Security | PENDING |
| mTLS | issuing CA/chain policy, peer certificate fingerprint(s), validity dates | Partner + Security | PENDING |
| JWS | approved algorithm, public key(s), `kid`, validity/revocation dates | Partner + Security | PENDING |
| HMAC | secure secret source/rotation process if HMAC is applicable | Partner + Security | PENDING |
| Rotation | overlap duration, scheduled rotation test, emergency revocation procedure | Security + Partner | PENDING |
| Data sharing | approved minimum-necessary field set and retention | Privacy/Legal + Partner | PENDING |
| SLA | timeout, retry/backoff, callback SLA, maintenance windows | Operations + Partner | PENDING |
| Failure mode | partner outage/degradation and escalation procedure | Operations + Safety | PENDING |
| Sandbox test | approved window to send deterministic non-production test traffic | Founder + Partner | PENDING |
| Review | independent safety/security review of exact integrated head | Reviewers | PENDING |

No `PENDING` item may be inferred as approved from local CI success.

## 4. Rotation test protocol

For any profile using JWS and/or mTLS, the approved sandbox test must prove:

1. current key/certificate accepted during its validity window;
2. replacement material accepted during the explicitly approved overlap window;
3. previous material rejected immediately after expiry;
4. explicitly revoked material rejected even if its nominal expiry is later;
5. unknown `kid` or unpinned peer certificate rejected;
6. cross-profile/tenant/purpose signature transplant rejected;
7. callback body tampering rejected;
8. partner outage or trust-service outage fails closed or enters a visible degraded state;
9. no long-lived private secret appears in source, CI logs or evidence artifacts.

## 5. Real sandbox execution gate

A real partner sandbox call is **NO-GO** until all of the following are true:

- exact endpoint and trust material are approved;
- data-sharing scope is approved;
- key/certificate handling procedure is approved;
- founder explicitly authorizes the partner/profile sandbox contact;
- exact candidate stack has no unresolved P0/P1 finding;
- rollback/kill-switch procedure is defined;
- evidence capture for the test is defined before execution.

Once authorized, the first real test remains sandbox-only, minimum-necessary, deterministic and reversible. It must not dispatch a real emergency response, alter road state, create legal/clinical conclusions, activate cameras, or control a vehicle.

## 6. Current readiness summary

| Partner class | Internal identity/ABAC | Callback replay | Persistent lifecycle | JWS+mTLS trust logic | Real sandbox evidence | Activation |
|---|---|---|---|---|---|---|
| Emergency | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | PENDING | FORBIDDEN |
| Traffic / road authority | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | PENDING | FORBIDDEN |
| Insurance | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | PENDING | FORBIDDEN |
| Towing | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | PENDING | FORBIDDEN |
| Routing / maps | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | READY FOR STACK REVIEW | PENDING | FORBIDDEN |

The table does **not** declare `INTEGRATION_SANDBOX_READY`. It shows that the internal engineering components are approaching the external-approval boundary while all live activation remains prohibited.
