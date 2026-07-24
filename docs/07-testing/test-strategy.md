# Test Strategy

## Required layers

- domain unit tests for every state transition and safety rule;
- integration tests for database, outbox, idempotency and adapters;
- contract tests for APIs and WebSocket events;
- end-to-end incident scenarios;
- security, load, backup restore and failure-injection tests.

## Mandatory scenarios

No-response incident, parallel roads, duplicate reports, fire/multiple casualties, map failure, push failure, operator non-acknowledgement, false report, connection loss and secondary hazard after reopening.
