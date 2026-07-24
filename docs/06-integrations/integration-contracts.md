# Integration Contracts

External agencies and providers are accessed through adapters supporting prepare, send, status, cancel and callback operations.

Every integration must implement idempotency, timeout, retry, circuit breaker, status tracking, audit and a non-blocking failure mode. Riyadh MVP agency adapters are simulations, not official dispatch channels.
