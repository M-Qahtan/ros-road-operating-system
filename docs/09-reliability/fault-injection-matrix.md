# Safe Fault-Injection Matrix

| Dependency/failure | Injection method | Expected safe state | Release-blocking failure |
|---|---|---|---|
| Redis unavailable | stop Redis container | readiness 503; durable outbox intent retained; recovery returns readiness 200 | false healthy, dropped intent, unbounded retry |
| Object storage unavailable | stop MinIO container | readiness 503; metadata retained; evidence not claimed available; recovery returns 200 | false healthy, unauthorized fallback, lost metadata |
| PostgreSQL unavailable | controlled test environment stop or network denial | mutations fail explicitly; no accepted non-durable RoadEvent | accepted write without durability or audit |
| Network partition | test adapter rejects/defers delivery | bounded retry, idempotency, visible pending/dead-letter state | silent success or duplicate operational intent |
| Restore corruption | invalid checksum or incomplete backup in isolated drill | restore fails closed and release gate fails | release proceeds or corrupted restore accepted |
| Dashboard stale read model | fixture timestamp beyond threshold | stale warning and critical controls disabled | critical action remains available |

All drills run only in CI/staging test infrastructure. They must never target production or real government/medical integrations.
