# ROS Mobile MVP

The browser client supports consented location, incident reporting, structured safety contact, nearby notifications and acknowledgement. No sensitive operational decision is executed locally; the API remains the authority.

## Authenticated host bridge

Before loading `dist/browser.js`, the authenticated host supplies the current in-memory OIDC access token and may supply server-issued resource UUIDs:

```js
window.__ROS_MOBILE_RUNTIME__ = {
  getAccessToken: () => oidcSession.getAccessToken(),
  subjectId: oidcSession.subjectId,
  caseId: roadEventResourceUuid,
  sessionId: contactSessionResourceUuid,
  deviceId: browserInstallationResourceUuid,
  tenantId: tenantDisplayReference
};
```

- The bridge returns the current short-lived token on demand so refresh remains host-owned. A static in-memory `accessToken` is accepted only as a compatibility fallback. Tokens are never written to `localStorage`, the URL, queued operations or telemetry.
- `subjectId` is the stable UUID from the authenticated OIDC session. It is required in MVP mode only to namespace browser-local resource, registration and queued-contact state. It is never sent as authority; the API still derives the actor from the verified bearer token. A different signed-in subject receives a different local namespace, preventing state reuse on a shared browser.
- On the first upgraded start, the client deletes only the three legacy unscoped ROS mobile keys. It does not enumerate or remove unrelated browser storage.
- `caseId`, `sessionId` and `deviceId` are resource identifiers, not authority. When the host omits them, the client generates UUIDs once and persists only those three identifiers for idempotent correlation.
- The client never sends self-attested tenant, purpose, actor or role headers. The API derives trusted `tenantId`, `purpose`, actor and roles from the verified OIDC principal and checks every referenced resource against that scope.
- Missing authentication fails closed. The simulated gateway is available only through an explicit `data-mobile-mode="simulation"` development opt-in.

The external identity/BFF deployment must issue an approved least-privilege `FIELD_USER` principal for the citizen journey. An `INTEGRATION_SERVICE`, `OPERATOR` or other privileged token must not be presented as a citizen identity. Until the `FIELD_USER` OIDC binding is configured, the API is expected to reject the report path with `403`.

## Durable journey

Consent and language selections are queued as idempotent `CONSENT` and `LANGUAGE_SELECTION` operations, including while offline. After explicit granted consent, the report journey registers the stable browser device resource, uses one stable RoadEvent UUID, attaches the signal, opens the in-app contact session, then flushes the pending structured operations. Declined consent never triggers registration.

Registration retries reuse a locally persisted operation UUID only while the exact device, application version, consent policy and consent evidence timestamp remain unchanged. A renewed consent interaction or application-version change creates a new operation UUID and therefore a new `mobile-device-registration-{operationUuid}` idempotency key. The persisted registration record contains only that UUID and its non-secret input fingerprint.

Device registration is **not device attestation**. It establishes an idempotent, scoped resource record for this browser installation; it does not prove hardware identity, device integrity, ownership, safety certification or trustworthiness. Any future attestation capability requires a separate reviewed protocol and server policy. Nearby notification polling requests location only after explicit consent and does not persist coordinates in browser storage.

Registration consent is versioned with `ros-field-companion-device-registration-consent/v1`. The client-provided `occurredAt` is evidence of the local interaction only; it is not authoritative consent time. After verifying OIDC identity, trusted scope, policy version and idempotency, the server returns authoritative `consentGrantedAt` and `registeredAt` values in the registration receipt. Device registration does not depend on a contact session.

Only after that authoritative receipt does the client attach `x-device-id` to subsequent authenticated `FIELD_USER` requests. The header selects the registered device resource; it grants no authority. The server must bind it to the verified principal and reject missing, unknown or mismatched device identifiers before handling RoadEvent, contact, delivery or notification requests.
