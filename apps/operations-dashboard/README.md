# Operations Dashboard

Arabic-first operations UI for the authenticated MVP RoadEvent and Human Safety workflows.

## Runtime contract

The hosting OIDC bridge must install `window.rosOidcSession` before either browser entry point runs. The object must provide:

- the provisioned UUID `actorId`;
- browser roles limited to `OPERATOR`, `SUPERVISOR`, `SAFETY_LEAD`, or `AUDITOR`;
- the exact `tenantId` and `purpose` access scope;
- an asynchronous `getAccessToken()` function that returns a current access token.

Tokens are never read from HTML data attributes or browser storage by this package. Every HTTP request uses `Authorization: Bearer`, includes the session tenant/purpose for scope correlation, and omits client-asserted actor/role headers. The API remains authoritative: it verifies the token and rebinds actor, roles, tenant, and purpose server-side.

The browser has no automatic simulation fallback. If the trusted bridge is absent or invalid, the UI renders an authentication failure and performs no API request. Human Safety action bodies also omit `actorId` and `actorRoles` so those fields cannot be mistaken for authority.

`data-api-base` may be empty for same-origin requests or an HTTPS origin. Plain HTTP is accepted only for `localhost` and `127.0.0.1` development endpoints.

## User workflows

- RoadEvent live queue, detail, timeline, transition, and supervised closure authorization.
- Human Safety live queue, case detail, takeover, escalation, reassignment, and supervised resolution authorization.
- Periodic refresh with overlapping reload suppression.
- Fail-closed critical controls on stale data, authorization failure, conflict, outage, or an ambiguous write outcome.
- Sanitized operator-facing errors for `401`, `403`, `404`, `409`, network failures, malformed responses, and `5xx`; server internals are not rendered.

Simulation adapters remain available only to deterministic unit tests and explicit engineering exercises. They are not composed by either MVP browser entry point.
