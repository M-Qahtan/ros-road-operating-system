# Riyadh MVP E2E Pilot Readiness

## Decision

The automated scenario is a **technical vertical-slice proof**, not authorization for a public-road or government pilot. All agency actions are simulations.

## One-command execution

```bash
pnpm simulate:riyadh
```

The command builds the workspace, executes the deterministic scenario, and writes `artifacts/riyadh-pilot/result.json`.

## Acceptance matrix

| Issue #9 criterion | Automated evidence |
|---|---|
| Two signals correlate to one RoadEvent | `riyadh-pilot.spec.ts` and `database/tests/riyadh_pilot_e2e.sql` |
| Create/update idempotency | duplicate create and duplicate signal assertions |
| Human-safety indicators and S3 escalation | severity assessment fixture and audit assertion |
| Outbox retry and no duplicate notifications | injected first-delivery failure plus deduplicated simulated agencies |
| Evidence completion and cross-event denial | evidence store assertions plus PostgreSQL preserved metadata invariant |
| Dashboard final restored-road state | list/detail read-model assertions at `CLOSED` |
| S3 closure bypass rejected | unauthorized close assertion before supervisor authorization |
| Complete audit timeline | required create, severity, authorization and closure actions |
| Startup/readiness/restore | existing `staging-smoke` and PostgreSQL clean-restore CI jobs |
| Performance baseline | create/list/detail local timing thresholds |

## Release checklist

- [x] deterministic IDs, timestamps, coordinates and fixtures;
- [x] one command for CI/staging execution;
- [x] API/application E2E test;
- [x] PostgreSQL/PostGIS E2E invariant test;
- [x] dashboard read-model outcome verified;
- [x] failure injection and retry recovery;
- [x] duplicate/idempotency proof;
- [x] S3 human authorization control;
- [x] evidence isolation and audit proof;
- [x] JSON evidence package uploaded by CI;
- [x] existing backup/restore and readiness gates retained.

## Performance baseline

The local in-memory application baseline is intentionally conservative: create under 250 ms, list under 100 ms and detail under 100 ms on a GitHub-hosted runner. These are regression tripwires, not production SLAs.

## Known limitations and pilot blockers

1. Agency dispatch is simulated; no official integration, acknowledgement or authority is represented.
2. The scenario does not provide medical diagnosis, legal fault attribution or autonomous road control.
3. Load, soak, chaos, penetration, privacy-impact and field-device testing remain required before a controlled pilot.
4. OIDC, production PostgreSQL/Redis/MinIO managed services and government network controls require deployment-specific validation.
5. A Riyadh pilot still requires approved operating procedures, data-governance sign-off, emergency-service agreements and a human command center.

## Evidence package

CI publishes the deterministic JSON result as the `riyadh-pilot-evidence` artifact. GitHub Actions logs, PostgreSQL integration output, staging smoke output and backup/restore checks form the remainder of the release evidence.
