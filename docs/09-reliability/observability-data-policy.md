# Observability Data Policy

## Allowed by default

- RoadEvent identifier
- service and operation name
- status and severity category
- coarse region or geohash approved for operations
- latency, count, retry, queue age, readiness, and error-class metrics
- rotated correlation identifier
- categorical evidence state such as available, quarantined, or missing

## Prohibited

- names, phone numbers, government identifiers, or account identifiers
- free-text medical narratives or diagnosis
- raw precise latitude/longitude in general logs and metrics
- evidence bytes, thumbnails, transcripts, object keys, or pre-signed URLs
- credentials, tokens, cookies, authorization headers, or secret values
- raw request/response bodies for safety conversations

## Enforcement

1. Structured logging uses an explicit allow-list.
2. Unknown fields are excluded rather than serialized automatically.
3. Error messages use stable error classes and trace IDs instead of sensitive payloads.
4. Access to audit records is role restricted and separately retained.
5. CI and staging artifacts are reviewed as potentially shareable engineering evidence and therefore contain no prohibited data.
6. Any prohibited-field detection is treated as a release-blocking security finding.
