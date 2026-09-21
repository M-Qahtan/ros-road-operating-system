# ROS Brain delivery plan

Status: **HOURLY ENGINEERING CADENCE — SHADOW_ONLY — WIP LIMIT 1**

- Start baseline: `8096312169dc7f769a45b419d5678b5bd5f461ad` (`8096312`).
- Planning date: 2026-09-07.
- Daily delivery owner: **Mohamed Qahtan**.
- On-call owner: **Mohamed Qahtan**.
- Rollback owner: **Mohamed Qahtan**.
- Architecture and gap register: [integration baseline](integration-baseline.md).

The founder replaced the prior daily schedule with hourly continuation cycles on 2026-09-08. Each cycle advances one small, integrated, reviewable behavior with fresh evidence. A cycle ends with an accepted result or an explicit carry-over; the clock does not turn incomplete work into completion and an unfinished write surface is resumed rather than overlapped.

This plan sets the order of work, not a promised date for completing the full product. A cycle can repeat or be split when its actual evidence shows that the slice is too large. Any scheduled hourly check supports the cadence but does not by itself prove code was built, tested, merged, or deployed.

## Working agreement

1. **WIP = 1:** one integrated delivery outcome is active at a time. Independent read-only review or bounded supporting work can run alongside it, with one owner for each write surface and one coordinator for the combined result.
2. Read the current repository state and inherited constraints before starting. Preserve unrelated changes and record the candidate/base identity used for evidence.
3. Define the observable outcome, acceptance examples, touched boundaries, failure behavior, and rollback/forward-fix approach before implementation.
4. Implement the smallest real module-to-module slice. Do not call a standalone demonstration a runtime integration or a whole-product completion.
5. Run targeted checks that exercise the changed public behavior, then proportionate affected checks and required gates. A failed, stale, skipped, cancelled, or missing check stays visible.
6. Integrate only after inspecting the combined diff and fresh results. Do not begin the next outcome while a safety-relevant failure remains unresolved in the active slice.
7. Preserve `SHADOW_ONLY`, recommendation-only authority, human review, tenant/purpose isolation, privacy, and append-only history throughout.
8. Hourly engineering does not spend on cloud services, apply infrastructure, deploy, activate external adapters, or establish a public-road pilot. The founder reported prior AWS resources deleted; no cycle assumes those resources still exist.

## Hourly cycle structure

| Stage | Required output | Exit condition |
|---|---|---|
| Select | One objective, named gap IDs, dependencies, and acceptance examples. | The slice can be evaluated independently and fits the authorized scope. |
| Demonstrate | A focused reproduction or acceptance test at the real seam. | The missing behavior or risk is observable; assumptions are written down. |
| Build | Minimal cohesive code, contract, and relevant documentation changes. | The new behavior exists without expanding authority or unrelated scope. |
| Verify | Fresh commands, exit statuses, scenario results, candidate identity, and explicit unverified boundaries. | Acceptance criteria map to direct evidence; failures are resolved or the cycle is carried over. |
| Review and hand off | Diff review, risk/rollback note, hourly report, and next objective. | Mohamed Qahtan can see what works, what remains open, and the next concrete step. |

## Ordered delivery outcomes

These are dependency-ordered cycles, not a commitment that all listed outcomes finish on consecutive calendar days. If an outcome needs more than one cycle, finish its safe sub-slice and retain the parent objective as the sole active item.

| Cycle | Objective and dependency | Acceptance | Required check evidence | Next handoff |
|---|---|---|---|---|
| 1 — Read-only advisor | Address BRAIN-10 using existing authorized case reads and dashboard; no new collection or dispatch path. | Versioned `nextEvidenceAdvice`; `SUGGESTED`/`ABSTAIN`; `SHADOW_ONLY`; `activationAuthorized=false`; `sourceSnapshotStatus=UNVERIFIED`; `collectionPermitted=false`. Reject expired/invalid/known-incompatible context, preserve urgency and current severity, and show the limitation in the UI. | Focused planner tests, scoped API read tests with zero mutations, sensitive-data rejection/non-disclosure, expiry/newer-context cases, dashboard rendering, and affected type/build/check results. | A reviewable advisor increment and a precise contract requirement for current snapshot identity. |
| 2 — Authoritative snapshot | Address BRAIN-01 and the revision portion of BRAIN-03 before claiming current advice. | Define explicit case, severity, contact, evidence, and indicator bindings; use authoritative revisions/digests instead of evidence count. A changed, revoked, corrected, or concurrently updated input invalidates the prior binding. | Contract examples plus real persistence/concurrency tests for snapshot capture and invalidation; schema compatibility and migration checks if a schema change is needed. | Approved internal snapshot contract and minimal durable writer acceptance examples. |
| 3 — Durable governed evaluation | Address BRAIN-02 using cycle 2's snapshot boundary. | An authorized runtime loads the snapshot, invokes governed fusion with authoritative receipts/guards, and persists an append-only recommendation idempotently. Failure produces no fabricated result and does not suppress human review. | Real runtime/persistence integration, retry/restart recovery, duplicate suppression, missing/revoked authority receipts, guard failure, and source snapshot mismatch tests. | One verified snapshot-to-recommendation-to-case-read path. |
| 4 — Accurate operational view | Complete relevant BRAIN-03/04/05 seams before claiming coherent operations. | The dashboard shows actual case/contact revisions, declared provenance, and observed dependency/connectivity status. Advice never presents hardcoded health or inferred consent as observed truth. | Authorized API/consumer contract tests, dependency degradation cases, freshness tests, privacy tests, and UI behavior using the actual returned model. | A trustworthy state view for the full incident journey. |
| 5 — Golden incident journey | Address BRAIN-06; assess BRAIN-07 explicitly when the scenario includes multiple people. | One scenario progresses from approved report through correlated incident, person-safety handling, governed advice, human ownership, acknowledged simulated handoff, and permitted completion. Duplicate signals cannot duplicate logical effects; unsafe closure is rejected. | Current-candidate end-to-end evidence through real local module seams, including trace IDs and version history. Identify all simulated external boundaries and any unresolved per-person cardinality gap. | A reproducible journey script and an ordered failure-injection set. |
| 6 — Failure and recovery | Address BRAIN-08 on the integrated journey from cycle 5. | Database failure/restart, interrupted delivery, duplicate/replayed input, stale evidence, and unavailable contact recover according to existing policy; urgent review and audit integrity survive. | Existing required resilience suites plus focused integrated failure scenarios, clean restore evidence, known recovery/rollback decisions, and consistency of dependency health reporting. | A candidate with explicit failure behavior and a residual-risk register. |
| 7 — Release and controlled-pilot readiness | Evaluate BRAIN-09 and all mandatory release/pilot prerequisites after the integrated behavior is proven. | Produce a factual readiness decision with all required artifacts, candidate identities, unresolved hazards, archive availability/receipt status, named owners, approved measurement method, and tested stop/recovery boundaries. Missing approvals or evidence yield NO-GO. | Existing release, retention, security, pilot, accessibility, and readiness gates on the exact candidate where applicable. No invented field KPIs and no substitution of local evidence for REL-013. | A concrete founder review package specifying the next permitted engineering or controlled-environment action. |

If snapshot/runtime work is too broad for one daily cycle, split it by a behavior such as "new evidence invalidates the old snapshot" or "retry writes one logical recommendation." Do not widen the cycle with new sensors, autonomous control, unrelated UI redesign, or hosting migration.

## Cycle 1 acceptance record

| Field | Current record |
|---|---|
| Objective | Integrate bounded next-evidence advice into authorized case reads and dashboard. |
| Scope | Advisor contract/planner, existing case read and display seams, focused checks, and integration documentation. |
| Authority | `SHADOW_ONLY`; no state/scoring change; no collection or action activation. |
| Snapshot claim | `UNVERIFIED`; conservative age and known-newer-context checks cannot prove current snapshot completeness. |
| Existing runtime limitation | No production fusion writer/snapshot proof was found at the baseline SHA. |
| Acceptance evidence | [Fresh verification record](integration-baseline.md#candidate-acceptance-and-verification): 30/30 focused tests and 522/522 workspace tests; build, verify, lint, typecheck, and diff checks exit 0. Source/test manifest digest binds the evidence to the candidate. |
| Result | **LOCAL ADVISOR INCREMENT VERIFIED; RELEASE NOT APPROVED.** API and display seams tested using local doubles/simulation; live database, graphical browser, CI/archive, and field gates remain unverified. |
| Review delivery | Branch `codex/ros-brain-next-evidence-daily`; no PR opened because current PR workflows can automatically invoke AWS archival. Preserve those gates and resolve this no-spend workflow dependency explicitly. |
| Next handoff | Cycle 2 snapshot contract and authoritative revision/data ownership decisions. |

## Cycle 2 progress record — authoritative snapshot contract

| Field | Current record |
|---|---|
| Resume point | Branch `codex/ros-brain-next-evidence-daily` at `6d1c94afe8e0d947b6fdd87d964a7c0c7a03a2dd`; `main` remained `8096312169dc7f769a45b419d5678b5bd5f461ad`. The worktree was clean before this increment. |
| Delivered sub-slice | Versioned contract and fail-closed assessment for binding one recommendation fingerprint/input version to one snapshot digest and exact case, severity, contact, evidence, and indicator revision/digest tuple. |
| Durable sub-slice | PostgreSQL migration and repository adapter now capture and read immutable snapshot receipts within an exact Tenant + Purpose + case scope. A caller supplies the expected previous input version; stale or competing writes return `CONFLICT`, and only a byte-equivalent winner is `IDEMPOTENT`. Runtime readiness now requires the snapshot relation and scope columns. |
| Authoritative capture sub-slice | Resumed from branch commit `7fcf373f02c5b9c16bfaf2e4374cd275ab100118`, with live GitHub comparison confirming `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, no branch PR, and no workflow run on the resume commit. A governed service now reads case, severity, contact, evidence, and indicator receipts sequentially from their module-owned ports and appends the canonical snapshot through the same PostgreSQL transaction. Every receipt must declare `SOURCE_LEDGER`; projected counts, missing indicators, invalid digests, and the first unavailable owner stop capture before persistence or later source reads. |
| RoadEvent ledger sub-slice | Resumed from branch commit `d1ee417489056dddabbb6d719207edac2f89b0b2`; live comparison again resolved `main` to `8096312169dc7f769a45b419d5678b5bd5f461ad`, with no branch PR or workflow run. Migration `0017_road_event_revision_ledger.sql` defines separate append-only `CASE` and `SEVERITY` revision streams under a composite Tenant + Purpose + case foreign key. A read-only PostgreSQL adapter returns only the latest ledger receipt and never projects the combined `road_events.version`. Runtime readiness now requires the ledger relation and ownership columns. |
| Atomic RoadEvent write sub-slice | Resumed from branch commit `f44ed184ea20e0b17b66bf3e71580f25196b3683`; GitHub confirmed unchanged `main`, no branch PR, and no workflow run. PostgreSQL RoadEvent creation now appends initial `CASE` and `SEVERITY` receipts before audit/outbox commit. Updates lock and verify both latest receipts against the persisted pre-update state; only changed components receive the next independent revision. A missing, malformed, or drifted receipt rolls back the RoadEvent mutation and suppresses audit/outbox publication. |
| Legacy reconciliation sub-slice | Resumed from GitHub branch commit `52d430018cb056be7ba4a3af71cc37674be66a4f`; live comparison resolved unchanged `main`, no branch PR, and no workflow run. A scoped `SERIALIZABLE` command locks one legacy RoadEvent, requires its exact observed version, and appends both revision-1 receipts with reconciliation ID, human operator ID, source event version, and timestamp. An exact retry is idempotent; partial, transactional, differently sourced, missing, or changed state rolls back without appending. |
| Contact source-ledger sub-slice | Resumed from GitHub branch commit `4eaad2ddcb54fcc9f8c60cbcf6dd58b9ea6858ee`; GitHub confirmed unchanged `main`, no branch PR, and no workflow run. Contact session creation and state correction now lock the exact parent RoadEvent, derive its trusted Purpose, verify the prior case-level Contact digest, and append an independent immutable revision. The read-only source returns `ABSENT` only after finding the exact scoped RoadEvent and no sessions/ledger; `PRESENT` requires the latest ledger digest to match every authoritative session. Legacy session state without a receipt and cross-purpose reads remain unavailable. |
| Evidence source-ledger sub-slice | Resumed from GitHub branch commit `0558462a89a937dddf9f5373f78e777d69aaada2`; GitHub confirmed unchanged `main`, no branch PR, and no workflow run. Evidence intent creation and integrity transitions now lock the parent RoadEvent, derive its Tenant + Purpose, verify the prior aggregate receipt, and append a new Evidence-owned revision in the same transaction as metadata, audit, and integrity state. The read-only adapter exposes only a revision/digest after matching every evidence record; empty, legacy-unreceipted, drifted, and cross-purpose states remain unavailable. |
| Indicator source-ledger sub-slice | Resumed from GitHub branch commit `79cde31e3ebf8998a6135b72d1c1b2c560e4f901`; GitHub confirmed unchanged `main`, no branch PR, and no workflow run. A Human-Safety-owned `SERIALIZABLE` command now records structured indicator history only for a human role holding `RECORD_STRUCTURED_INDICATOR`, with optimistic revision matching, exact Tenant + Purpose + case locking, immutable correction ancestry, and a canonical aggregate digest. The read-only adapter returns only the verified latest receipt and grants no collection, severity, closure, dispatch, or actuation authority. |
| PostgreSQL composition sub-slice | Resumed from GitHub branch commit `b1037f54d8af6b9248a11c7c74791caa9970bab7`; GitHub confirmed unchanged `main`, the branch ten commits ahead and zero behind, no branch PR, and no workflow run. One internal factory now composes the CASE, SEVERITY, Contact, Evidence, and Indicator PostgreSQL adapters into the transactional capture service. The integration test captures the initial five-source snapshot, applies a later authoritative Indicator correction, captures the next version, and proves the earlier recommendation binding becomes `CURRENT_INPUT_CHANGED`; no recommendation record is written. |
| Invalidation behavior | A revision change, content correction with the same revision but a different digest, contact creation/removal, scope drift, source mismatch, or invalid chronology prevents `VERIFIED`. Missing or malformed receipts remain `UNVERIFIED`. |
| Ownership boundary | Source modules still own their revisions and canonical digests. The contract verifies receipts but does not mint them, read new data, mutate a case, or grant authority. |
| Fresh local evidence | All five TypeScript builds passed; 1/1 concrete composition/invalidation test, 17/17 focused capture/binding/Indicator tests, and 567/567 workspace tests passed. Repository/composition/retention/negative gates passed, including 8/8 external-evidence logic tests. |
| Result | **BRAIN-01 LOCALLY INTEGRATED; LIVE DATABASE PROOF OPEN.** The five module-owned PostgreSQL sources now have one concrete capture composition and correction invalidation is evidenced across the source, snapshot, and binding boundaries. This remains SQL-port evidence: migrations `0016`-`0020`, isolation, locks, constraints, and rollback were not executed on a live PostgreSQL engine, and no runtime command invokes the factory yet. No recommendation persistence, CI/archive receipt, merge, deployment, or field readiness was established. |
| Next handoff | Begin BRAIN-02 with an append-only PostgreSQL recommendation journal that accepts only a governed `RECOMMENDATION_ONLY` evaluation bound to one persisted snapshot and keeps human review mandatory. |

## Cycle 3 progress record — durable governed evaluation

| Field | Current record |
|---|---|
| Resume point | GitHub branch `codex/ros-brain-next-evidence-daily` at `e8e62c374b7253565ab889a756f5ec482523fcb8`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, with no branch PR or workflow run on the resume commit. |
| Safety correction | Snapshot binding now accepts the `sha256:` fingerprint format emitted by the real fusion service. The prior raw-hex-only validator rejected every real service recommendation and was fixed before adding a write surface. |
| Durable writer sub-slice | A new append-only recommendation journal is foreign-keyed to the exact Tenant + Purpose + case + input-version snapshot. The writer reloads that snapshot inside the transaction, validates the binding and active governed registry entry, enforces the exact structured recommendation shape, and stores only `RECOMMENDATION_ONLY / SHADOW_ONLY / activationAuthorized=false / PENDING human review`. Exact retry is idempotent; a different concurrent winner conflicts. |
| Controlled use-case sub-slice | Resumed from GitHub candidate `69425aa041aa0b58831351ce458656edbf7c17c2`, with live comparison confirming unchanged `main`, the branch twelve commits ahead and zero behind, no open branch PR, and no workflow run. An internal authorized use case now reloads the persisted snapshot and exact `SOURCE_LEDGER` fusion input, runs the existing governed orchestrator, issues the binding, and appends through the journal on one `REPEATABLE READ` connection. Authorization is checked before and after evaluation; expiry, scope/source drift, a blocked guard, or untrusted time suppresses the insert while preserving human review. No HTTP or operational command surface was added. |
| Authoritative fusion-input sub-slice | Resumed from GitHub candidate `d68806391750b1f0d8ba7fb8b23269d8827ff572`; live comparison confirmed unchanged `main`, the branch thirteen commits ahead and zero behind, no open branch PR, and no workflow run. A PostgreSQL adapter now verifies all five module-owned receipts against the persisted snapshot before deriving current severity, one unambiguous Contact state, active rule versions, and effective structured Human-Safety indicators. A transaction-scoped evidence-authority port prevents Tenant/case/source rebinding. Raw Evidence metadata/counts are not treated as semantic observations, and unknown device/location quality remains explicit. |
| Trusted runtime-composition sub-slice | Resumed from GitHub candidate `9256c64edb07cbb1429e030e12c605ecf1856002`; live comparison confirmed unchanged `main`, the branch fourteen commits ahead and zero behind, no open branch PR, and no workflow run. Verified OIDC identity now retains its signed session bounds. A PostgreSQL authorization adapter requires exact actor, Tenant, Purpose, case, MFA, and an authorized human `OPERATOR`/`SUPERVISOR` role before minting the narrow evaluation-and-record capability. One internal, non-HTTP factory composes authorization, snapshot, all five source ledgers, governed fusion, and the shadow journal; its fallback evidence authority denies by default. |
| Governed read sub-slice | Resumed from GitHub candidate `516e261e48d5cba1f8447905cab35af0a4b07946`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch fifteen commits ahead and zero behind, with no branch PR or workflow run. A read-only exact-scope query now revalidates the journal row with the writer's safety schema, reloads its persisted snapshot and all five current module-owned receipts, and returns the structured recommendation only when the binding is still `VERIFIED`. A changed or unavailable source produces `WITHHELD`, never a stale current recommendation. `PENDING` human review, `SHADOW_ONLY`, and `activationAuthorized=false` remain explicit. `AUDITOR` is read-only; no HTTP route or command was added. Review also removed row-lock clauses that are incompatible with PostgreSQL read-only transactions. |
| Case-read compatibility sub-slice | Resumed from GitHub candidate `f5abdfdc63554f3f2e30c0348f5a1642364693d4`; live comparison kept `main` unchanged, the branch sixteen commits ahead and zero behind, with no branch PR or workflow run. The existing authorized Human-Safety list/detail/action response seam now consumes the governed read model. A `CURRENT` journal recommendation is exposed with `PENDING / SHADOW_ONLY / activationAuthorized=false`; `WITHHELD` suppresses every legacy fallback and retains urgent human review; only `NOT_FOUND` permits the existing recommendation as explicit `LEGACY_COMPATIBILITY / UNVERIFIED`. No route or operational authority was added. The advice validator accepts both the journal's canonical `sha256:` fingerprint and the legacy raw digest during this bounded compatibility period. |
| Local PostgreSQL journey harness | Resumed from GitHub candidate `f096dff9ac5fc70e0b6810237ea46f50798b8372`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch seventeen commits ahead and zero behind, with no open branch PR or workflow run. A local-only harness now creates and removes an unexposed `postgis/postgis:16-3.4` container, applies every migration, seeds the case, and runs ordered SQL tests in separate `psql` clients. The new journey definitions cover a current repeatable-read/read-only recommendation, authoritative Indicator correction invalidation, append-only rejection, transaction rollback, and persistence across a client reconnect. Both entry scripts fail with an explicit non-success status before claiming evidence when required tools are missing. |
| Restart-recovery harness sub-slice | Resumed from GitHub candidate `78d0630bb027188331b20cbff9b27dfda4ab9a91`; live comparison kept `main` unchanged, the branch eighteen commits ahead and zero behind, with no open branch PR or workflow run. The disposable container now supplies its own `psql` and `pg_isready` clients, removing host client dependencies. The ordered runner restarts the exact validated container after correction/rollback and before `0011_ros_brain_journey_reconnect.sql`, waits for readiness again, then verifies the committed invalidated recommendation state from the restarted database. |
| Restart retry hardening sub-slice | Resumed from GitHub candidate `cdeaa3e31ad74c51ddbce56fd1512dee615330e3`; live comparison kept `main` unchanged, the branch nineteen commits ahead and zero behind, with no branch PR or workflow run. The runner now validates the requested recovery test before migrations, records the completed restart, and fails if the checkpoint is absent or skipped. After restart, the recovery stage replays the exact journal insert under the existing composite key and proves the row remains singular. |
| Local execution-receipt sub-slice | Resumed from GitHub candidate `9ae836a04ba357e88647af13353b9664aa7768b7`; live comparison kept `main` unchanged, the branch twenty commits ahead and zero behind, with no branch PR or workflow run. The Docker journey now refuses a dirty candidate and emits a machine-readable receipt only after all database stages pass. The receipt binds the candidate SHA, complete migration/seed/test manifest digest, immutable container image ID, and actual PostgreSQL/PostGIS versions while explicitly leaving the external archive receipt null. |
| Restart-identity proof sub-slice | Resumed from GitHub candidate `1304afbea70b98788863710e17bab451e630f97c`; live comparison kept `main` unchanged, the branch twenty-one commits ahead and zero behind, with no branch PR or workflow run. Immediately before and after the requested restart, the runner reads PostgreSQL control identity and postmaster start time. Recovery proceeds only when the same database system identifier remains and a different postmaster start time proves process replacement; receipt schema v2 records the surviving cluster identity and recovered start time. |
| Restart-proof receipt binding sub-slice | Resumed from GitHub candidate `0cb126a27918f09930fd6cd5ef0bfb949c203c62`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch twenty-two commits ahead and zero behind, with no branch PR or workflow run. The runner now writes its already-validated pre/post restart measurements only to a new empty non-symlink proof file after every SQL stage passes. The outer clean-candidate harness consumes exactly four fields, revalidates same-cluster/different-postmaster semantics against the still-running engine, and emits receipt schema v3 with both start times. Missing, incomplete, or post-run-mismatched proof suppresses the receipt. |
| Five-source restart recovery sub-slice | Resumed from GitHub candidate `94805dda954602b737767993b7bceebc0059dbea`; live comparison kept `main` unchanged, the branch twenty-three commits ahead and zero behind, with no branch PR or workflow run. The first read-only transaction after restart now verifies the exact CASE and SEVERITY receipts, authoritative Contact absence in both session and ledger tables, the Evidence receipt, both committed Indicator revisions, every source revision/digest stored in the snapshot, and the journal-to-snapshot digest link. Extra or missing scoped receipts fail before the exact retry check. |
| Post-restart forward recovery sub-slice | Resumed from GitHub candidate `22412000ad6e53e22196749bd2d483e13d488c95`; live comparison kept `main` unchanged, the branch twenty-four commits ahead and zero behind, with no branch PR or workflow run. After proving the old recommendation is invalidated and durable, a separate post-restart client appends input snapshot version 2 against Indicator revision 2 and a new governed recommendation. A final read-only transaction requires both historical rows to remain, keeps version 1 stale, and recognizes only version 2 as current with `RECOMMENDATION_ONLY / SHADOW_ONLY / activationAuthorized=false / PENDING`. |
| Failure behavior | Missing persisted snapshots, source-digest/fingerprint/chronology mismatch, unavailable or inactive governance, unknown fields, absent human review, and forged autonomous authority produce no insert. Existing RoadEvent, source ledgers, and snapshots are not mutated. |
| Fresh local evidence | 9/9 harness-definition tests and 605/605 workspace tests passed. All five TypeScript builds/no-emit checks and repository/composition/retention/negative gates passed, including 8/8 external-evidence logic tests. The missing-Docker preflight returned exit 127 before any success claim. The SQL journey and its v3 receipt remain unexecuted in this executor because Docker is unavailable. |
| Result | **POST-RESTART FORWARD RECOVERY IS DEFINED FAIL-CLOSED WITHOUT REWRITING HISTORY; LIVE ENGINE EVIDENCE STILL OPEN.** The legacy table remains a visibly unverified compatibility fallback only when the journal has no row. Migrations, PostgreSQL constraints, verified process replacement, database-level retry behavior, and live receipt values remain unverified on an engine. |
| Next handoff | Execute the now self-contained disposable PostgreSQL/PostGIS journey on a host with Docker and fix any engine-level discrepancy it exposes. |

## Cycle 4 progress record — accurate operational view

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `3a7e5553db685cabed3055b1b4f8d87cd22b0e97`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch twenty-five commits ahead and zero behind, with no branch PR or workflow run. |
| Observed-health sub-slice | Human-Safety list, detail, and action responses now receive bounded runtime readiness observations instead of synthesizing `HEALTHY`. Persistent composition maps live PostgreSQL, Redis, active Object Storage, and required-worker supervision to explicit connectivity/dependency states. Missing or failed observation becomes degraded/unavailable or lost/unavailable. |
| Closure safety | Supervisor identity and trusted evidence remain necessary but are no longer sufficient for high-risk resolution authorization. The authorization endpoint also requires currently observed `HEALTHY` connectivity and dependencies; failure returns `OPERATIONAL_HEALTH_UNVERIFIED` without persisting authorization. Takeover and escalation remain available for human safety handling. Authorization still does not close the RoadEvent. |
| Authoritative source-version projection | Resumed from GitHub candidate `3ec42ce7d3a1852ff72695eb7370a911650a9742`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch twenty-six commits ahead and zero behind, with no branch PR or workflow run. The governed query now returns the exact input, case, severity, optional-contact, evidence, and Indicator revisions only after the persisted snapshot and all current owner receipts verify. Human-Safety exposes an explicit source-version state; a changed, missing, forbidden, or legacy-unbound snapshot yields only null authoritative revisions and zero compatibility fields. The Arabic dashboard labels that state as withheld instead of displaying projected values. |
| Resolution source-snapshot gate | Resumed from GitHub candidate `0759a6fd5ab3d739c78cec91ac05ed9566398d87`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch twenty-seven commits ahead and zero behind, with no branch PR or workflow run. High-risk resolution authorization now requires the governed read to be `AVAILABLE`, its persisted source snapshot to be `VERIFIED`, and its snapshot digest/input version to match the recommendation and returned source versions. Missing, withheld, legacy, or inconsistent snapshot state returns `SOURCE_SNAPSHOT_UNVERIFIED` before closure authorization is written. Human takeover remains available after rejection. |
| Persisted closure-snapshot binding | Resumed from GitHub candidate `92fd7e9f65bd4c3ecf9ce32ef569012bd3627e28`; live comparison kept `main` unchanged, the branch twenty-eight commits ahead and zero behind, with no branch PR or workflow run. A successful Human-Safety authorization now copies the exact verified input version and snapshot digest into the RoadEvent authorization. Migration `0022` stores the pair and enforces a five-column foreign key to the exact Tenant + Purpose + case snapshot row; incomplete, malformed, or mismatched bindings fail. Existing unbound authorizations remain readable for migration compatibility but cannot claim a governed binding. |
| Atomic closure revalidation | Resumed from GitHub candidate `633b3aa6d5a31ecb170709f162dd22cd44381968`; live comparison kept `main` unchanged, the branch thirty commits ahead and zero behind, with no branch PR or workflow run. A persistent S3/S4 transition to `CLOSED` now enters a `SERIALIZABLE` transaction, locks and reloads its exact stored snapshot, proves the original CASE receipt followed only by the closure-authorization CASE receipt, and matches the latest Severity, Contact, Evidence, and Human-Safety Indicator owner receipts. Missing or changed binding returns `SOURCE_SNAPSHOT_CHANGED` before RoadEvent, audit, or outbox writes. |
| Fresh local evidence | 25/25 focused repository/application/HTTP tests and 616/616 workspace tests passed (API 541, dashboard 31, mobile 36, domain 8). All five TypeScript build and no-emit checks and repository/composition/retention/negative gates passed, including 8/8 external-evidence logic tests. Live PostgreSQL execution remains unavailable in this executor. |
| Result | **HIGH-RISK CLOSURE EXECUTION NOW REVALIDATES THE PERSISTED SNAPSHOT FAIL-CLOSED IN THE POSTGRESQL TRANSACTION; LIVE ENGINE CONCURRENCY EVIDENCE REMAINS OPEN.** Rejection leaves the persisted authorization and append-only history intact. No recommendation gains closure or other operational authority. |
| Next handoff | Extend the disposable PostgreSQL journey through migration `0022` with a real concurrent source-update/closure race and require exactly one safe winner plus an engine-bound receipt. |

## Cycle 4 continuation — closure/source concurrency

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `21612fb4e1667aefd45827609effb1ffbdb443cf`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-one commits ahead and zero behind, with no branch PR or workflow run. |
| Concurrent safety behavior | Human-Safety Indicator writes retain their existing `SERIALIZABLE` RoadEvent row lock and now reject a case observed as `CLOSED`. The disposable journey starts a source correction and a closure attempt as overlapping PostgreSQL clients. The source client deliberately reaches the shared row boundary first; the closure client must then observe the new Indicator revision and lose with `SOURCE_SNAPSHOT_CHANGED`. |
| Durable acceptance | The race proof requires exactly `SOURCE_UPDATE=COMMITTED` and `CLOSURE=SOURCE_SNAPSHOT_CHANGED`, followed by durable state `RECOVERY / version 2 / Indicator revision 3`. Missing synchronization, two successes, the wrong loser, or an ambiguous final state aborts the journey. Receipt schema v4 carries this exact disposition only after restart, recovery, and all ordered stages pass. |
| Safety limits | The synchronization advisory lock is test-only. No recommendation gains closure authority; the source write remains an already-authorized structured human observation. No camera, dispatch, severity downgrade, evidence mutation, cloud resource, or field action is added. |
| Result | **THE CONCURRENT ENGINE RACE AND ITS CANDIDATE-BOUND RECEIPT ARE DEFINED FAIL-CLOSED; LIVE POSTGRESQL EXECUTION IS STILL REQUIRED.** |
| Next handoff | Run the clean candidate on a Docker-capable local host, inspect the v4 race receipt, and fix any actual PostgreSQL lock, trigger, or isolation discrepancy. |

### Reverse concurrency ordering

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `3169a3922912acea081f9e30c8d0705faafe4a7b`; live comparison kept `main` unchanged, the branch thirty-two commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | The same disposable race now also forces closure to hold the exact RoadEvent lock while a structured Indicator update waits. After closure commits, the waiting source command must fail closed—either after reloading `CLOSED` or through PostgreSQL serialization rejection—and append no revision. A serialization loser on the high-risk closure path is mapped to the public `SOURCE_SNAPSHOT_CHANGED` conflict. |
| Durable acceptance | The second ordering requires `CLOSURE=COMMITTED`, a source loser of `INCIDENT_CLOSED` or `SERIALIZATION_FAILURE`, and final state `CLOSED / version 3 / Indicator revision 1`. Receipt schema v5 records the actual engine disposition for both orderings; two winners, an unobserved lock wait, or an unexpected durable revision blocks emission. |
| Result | **BOTH CLOSURE/SOURCE LOCK ORDERINGS ARE DEFINED FAIL-CLOSED; LIVE POSTGRESQL EXECUTION REMAINS OPEN.** |
| Next handoff | Execute the clean v5 journey on a Docker-capable local host and correct any engine-level lock, isolation, migration, or trigger discrepancy. |

### Local container-engine portability

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `2c1f37c059d2afc0117c3193e5a17d96442a6292`; live comparison kept `main` unchanged, the branch thirty-three commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | The disposable PostgreSQL/PostGIS journey now selects Docker first or Podman second, retains container-owned database clients and no host port, and records the selected engine in its receipt. A missing engine or malformed Docker/Podman image identity still exits before any success claim. |
| Durable acceptance | Static harness checks require both engines, engine-routed run/exec/inspect/cleanup, normalized `sha256:` image identity, and receipt schema v6 with `containerEngine`. Existing restart and two-ordering race proofs remain mandatory. |
| Result | **THE LOCAL LIVE JOURNEY IS PORTABLE ACROSS DOCKER AND PODMAN WITHOUT WEAKENING ITS RECEIPT; ENGINE EXECUTION REMAINS OPEN.** |
| Next handoff | Execute the clean v6 journey on a local host with Docker or Podman and correct any PostgreSQL-level discrepancy it reveals. |

### Exported client engine binding correction

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `022bd0460db264f1c3fdbf3204736142a1b2b73a`; `main` remained unchanged, the branch thirty-four commits ahead and zero behind, with no branch PR or workflow run. |
| Safety failure corrected | The exported `psql` and `pg_isready` functions referenced the parent shell's unexported `container_engine`, which would fail under `set -u` in the child integration runner. They now use the validated exported `ROS_POSTGRES_CONTAINER_ENGINE` binding. |
| Acceptance | A regression test isolates the exported function bodies, requires the exported binding, rejects the parent-local binding, and proves the environment export precedes the child runner invocation. |
| Result | **THE V6 CHILD PROCESS NOW RECEIVES THE EXACT VALIDATED CONTAINER ENGINE; LIVE ENGINE EXECUTION REMAINS OPEN.** |
| Next handoff | Execute the clean v6 journey on a Docker/Podman host and fix the first engine-level discrepancy, if any. |

### Closed-case recommendation projection

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `7bc8184c974d456f8ef19ba88ced245a53fd7dfa`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-five commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | A RoadEvent whose durable status is `CLOSED` is now projected as a resolved Human-Safety case even when no high-risk closure authorization was required. Governed and legacy recommendations are withheld from the live case response after closure while their journal/history remains untouched. The dashboard identifies the recommendation as historical instead of rendering it as a current explainable recommendation. |
| Acceptance | API coverage closes a low-severity RoadEvent through the real application transition path, then requires `RESOLVED`, a null recommendation, `WITHHELD / CASE_CLOSED / SHADOW_ONLY / activationAuthorized=false`, abstaining next-evidence advice, preserved verified source versions, and zero Human-Safety store mutation. Dashboard coverage requires the historical-withholding message and no current-recommendation panel. |
| Safety limits | This is a read projection only. It does not delete a recommendation, change severity, authorize closure, collect data, dispatch, or add operational authority. Tenant and Purpose authorization remains on the existing route. |
| Result | **CLOSED INCIDENTS NO LONGER EXPOSE A CURRENT RECOMMENDATION; THE GOVERNED HISTORY REMAINS AVAILABLE FOR REVIEW.** |
| Next handoff | Execute the clean v6 PostgreSQL journey on a Docker/Podman host and fix the first engine-level discrepancy, if any. |

### Closed-case command rejection

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `5d4d6e827bd2426ab4fb50f2b78e6054b95a4e2d`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-six commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | The Human-Safety API now rejects takeover, escalation, assignment, and resolution-authorization commands with `INCIDENT_CLOSED` when the authorized RoadEvent is already durably `CLOSED`. Rejection occurs before the contact/evidence backing store is read and before any command write. |
| Acceptance | The API test closes a low-severity RoadEvent through the real application transition path, invokes all four command routes as a supervisor, and requires four conflicts, zero Human-Safety store reads, zero mutations, an unchanged contact version, and a still-closed RoadEvent. |
| Safety limits | This closes the already-closed request path. A command racing a concurrent closure still requires a shared PostgreSQL transaction/lock proof and is not claimed safe by this application-level test. Human intervention on an active incident remains available. |
| Result | **AN ALREADY-CLOSED INCIDENT CANNOT RECEIVE A NEW HUMAN-SAFETY COMMAND OR CONTACT MUTATION THROUGH THE API.** |
| Next handoff | Bind contact-command admission to the RoadEvent lock in PostgreSQL and add both closure/command race orderings to the local v6 journey. |

### Atomic contact-command parent guard

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `e4513a049e24eda1b52c5cd307e8855371427c33`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-seven commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | Persistent Human-Safety contact mutations now carry the trusted Purpose and expected RoadEvent version into the contact transaction. Before changing the session, PostgreSQL locks the exact Tenant + Purpose + case parent row and returns `PARENT_CLOSED` or a version conflict without touching contact state. The HTTP boundary maps the closed disposition to `INCIDENT_CLOSED`. |
| Concurrency semantics | If closure owns the RoadEvent lock first, the waiting contact command observes `CLOSED` and loses. If the contact command owns it first, its contact revision commits before closure can revalidate the source snapshot, so the high-risk closure path must observe the changed Contact owner receipt and lose safely. |
| Acceptance | Focused adapter tests require the exact scoped `FOR UPDATE` query to precede the session update and prove closed/stale parents produce no session or revision-ledger write. HTTP tests continue to prove existing closed cases reject every Human-Safety command. Live PostgreSQL scheduling of both orderings remains unverified. |
| Result | **CONTACT COMMAND ADMISSION AND ROAD-EVENT CLOSURE NOW SHARE THE PARENT ROW LOCK; LIVE ENGINE RACE EVIDENCE REMAINS OPEN.** |
| Next handoff | Add both contact-command/closure orderings to the disposable PostgreSQL journey and bind their actual dispositions into the next receipt schema. |

### Contact-command/closure engine race definition

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `73787e7c80430eb238d75f6c7714e83ca30bd1dff4`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-eight commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | The disposable PostgreSQL journey now schedules both contact-command/closure row-lock orderings. A command winner must commit contact session and append-only revision 2 while closure loses to source drift; a closure winner must leave session/revision 1 intact while the command loses as closed or by serialization. |
| Durable acceptance | Both participants run `SERIALIZABLE`, the waiter must be observed on the RoadEvent lock, and exact final states are required. Receipt schema v7 consumes all eight disposition fields; an ambiguous winner or unexpected contact write suppresses the receipt. |
| Safety limits | This defines executable local-engine evidence only. It does not claim a live pass, archive REL-013 evidence, deployment, external communication, or added operational authority. |
| Result | **BOTH CONTACT-COMMAND/CLOSURE RACE ORDERINGS ARE DEFINED FAIL-CLOSED; LIVE ENGINE EXECUTION REMAINS OPEN.** |
| Next handoff | Execute the clean v7 journey on Docker or Podman and correct the first PostgreSQL lock/isolation discrepancy it reveals. |

### Atomic contact-command race write-set

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `20ace28737f2ddb14c6ace2d647344859ff362b7`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch thirty-nine commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | Each contact/closure race now exercises the complete durable command write-set: guarded session version, append-only Contact revision, immutable operator audit, and cancellation of the pending Outbox action. |
| Durable acceptance | A command winner must end at `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. A closure winner must end at `CLOSED / event 3 / session 1 / contact 1 / audit 0 / cancelled 0 / pending 1`; any partial loser write blocks the v7 receipt. |
| Safety limits | Pending Outbox cancellation is local simulated state only; no provider is called and no message, emergency action, or external authority is dispatched. Live PostgreSQL execution and REL-013 archival remain unverified. |
| Result | **THE CONTACT/CLOSURE RACE NOW FAILS CLOSED ACROSS THE WHOLE CONTACT COMMAND WRITE-SET, NOT ONLY THE SESSION ROW.** |
| Next handoff | Execute the clean v7 journey on Docker or Podman and correct the first PostgreSQL transaction discrepancy it reveals. |

### Contact-command atomic rollback proof

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `85d36a4982a637ba746f9fd6a425f36eef8e3f90`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | The PostgreSQL journey injects a deterministic failure after session update, Contact revision append, Outbox cancellation, and Audit append but before commit. The transaction must restore the exact pre-command state. |
| Durable acceptance | After the injected failure, the case remains `RECOVERY / event 2 / session 1 / contact 1 / audit 0 / cancelled 0 / pending 1`. Receipt schema v8 requires `ATOMIC_ROLLBACK=VERIFIED` in addition to both race orderings. |
| Safety limits | This is a local fail-closed recovery definition. It sends no provider message and grants no closure, emergency, collection, or control authority. Live PostgreSQL execution and REL-013 archival remain unverified. |
| Result | **A MID-COMMAND FAILURE CANNOT BECOME A PARTIAL CONTACT MUTATION OR FALSE AUDIT CLAIM IN THE DEFINED JOURNEY.** |
| Next handoff | Execute the clean v8 journey on Docker or Podman and correct the first PostgreSQL rollback/locking discrepancy it reveals. |

### Contact-command forward recovery

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `e2082c7c779cf5ee1f62019f6e367b39cda504a4`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-one commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After the injected mid-command rollback, the journey retries from the restored parent/contact versions and requires one complete session, revision, Audit, and Outbox-cancellation commit. An immediate duplicate retry must lose at the Contact version boundary without changing the recovered state. |
| Durable acceptance | Forward recovery ends at `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`; duplicate retry preserves `session 2 / contact 2 / audit 1 / cancelled 1`. Receipt schema v9 requires both `FORWARD_RETRY=COMMITTED` and `DUPLICATE_RETRY=REJECTED`. |
| Safety limits | Recovery remains a local PostgreSQL test definition with simulated Outbox state and no provider call, dispatch, closure authority, or activation. Live engine execution and REL-013 archival remain unverified. |
| Result | **A ROLLED-BACK CONTACT COMMAND HAS A SINGLE FORWARD RECOVERY PATH WITHOUT DUPLICATING AUDIT OR OUTBOX EFFECTS.** |
| Next handoff | Execute the clean v9 journey on Docker or Podman and correct the first PostgreSQL recovery discrepancy it reveals. |

### Contact recovery restart durability

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `ac4b2b1f9c93a7fa0f27c75dabe1d9fb5c12f359`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-two commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After the atomic rollback, single forward retry, and duplicate rejection, the local journey restarts PostgreSQL a second time and reads the recovered Contact state through a new postmaster before it may emit a receipt. |
| Durable acceptance | The database cluster identity must remain unchanged, the postmaster start time must change, and the recovered case must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v10 records both postmaster timestamps and the exact recovered state. |
| Safety limits | The check remains local and provider-free. It sends no Contact action, closes no incident, grants no activation, and does not replace the required REL-013 external immutable archive. |
| Result | **THE DEFINED FORWARD CONTACT RECOVERY MUST SURVIVE A NEW POSTGRESQL PROCESS WITHOUT LOSING OR DUPLICATING ITS DURABLE WRITE-SET.** |
| Next handoff | Execute the clean v10 journey on Docker or Podman and correct the first live restart or persistence discrepancy it reveals. |

### Post-restart duplicate contact rejection

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `21f9d7c7e06549f638453a89ff32bc1deb2a64ea`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-three commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After forward recovery and a verified PostgreSQL restart, the journey locks the exact `Tenant + Purpose + Case` parent and retries the stale Contact version. The durable version boundary must reject it before any session, revision, Audit, or Outbox mutation. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_CONTACT_VERSION_CONFLICT`, and the full state must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v11 records `contactPostRestartDuplicateRetry=REJECTED` and the unchanged state. |
| Safety limits | This is a provider-free local recovery assertion. It sends no message, changes no incident authority, and cannot replace live engine execution or the REL-013 external immutable archive. |
| Result | **CONTACT IDEMPOTENCY MUST REMAIN DURABLE ACROSS A DATABASE RESTART, NOT ONLY INSIDE THE ORIGINAL POSTMASTER.** |
| Next handoff | Execute the clean v11 journey on Docker or Podman and correct the first live version-boundary or persistence discrepancy it reveals. |

### Post-restart Contact purpose isolation

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `377fd0403539b302a3814a920ac9b0ef7801f58b`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-four commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After recovery and restart, the journey submits a Contact mutation with the correct tenant and case but a foreign purpose. The exact parent lookup must reject the command before the Contact session can advance. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_PARENT_SCOPE_MISMATCH`, and the full primary state must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v12 records the rejection and unchanged state. |
| Safety limits | This local assertion proves only the database scope boundary. It sends no Contact action, grants no authority, and cannot replace a live engine run or the REL-013 external immutable archive. |
| Result | **A CONTACT COMMAND CANNOT BORROW A VALID CASE ID FROM ANOTHER PURPOSE, INCLUDING AFTER DATABASE RESTART.** |
| Next handoff | Execute the clean v12 journey on Docker or Podman and correct the first live purpose-isolation or persistence discrepancy it reveals. |

### Post-restart Contact tenant isolation

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `bd567fa9f29fdd4d8f7239604c6c54ea2eed673b`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-five commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After recovery and restart, the journey submits a Contact mutation with a foreign tenant but an otherwise valid purpose and case identity. The exact parent lookup must reject it before any Contact access or mutation. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_TENANT_SCOPE_MISMATCH`, and the full primary state must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v13 records the rejection and unchanged state. |
| Safety limits | This local assertion proves only the database tenant boundary. It sends no Contact action, grants no authority, and cannot replace a live engine run or the REL-013 external immutable archive. |
| Result | **A CONTACT COMMAND CANNOT CROSS THE TENANT BOUNDARY, INCLUDING AFTER DATABASE RESTART.** |
| Next handoff | Execute the clean v13 journey on Docker or Podman and correct the first live tenant-isolation or persistence discrepancy it reveals. |

### Post-restart Contact case isolation

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `bb2f7a05579d5232cf6bf452369c4ca36a135130`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-six commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After recovery and restart, the journey submits a Contact mutation with the correct tenant and purpose but a foreign case identity. The exact parent lookup must reject it before any Contact access or mutation. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_CASE_SCOPE_MISMATCH`, and the full primary state must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v14 records the rejection and unchanged state. |
| Safety limits | This local assertion completes the exact `Tenant + Purpose + Case` boundary definition. It sends no Contact action, grants no authority, and cannot replace a live engine run or the REL-013 external immutable archive. |
| Result | **A CONTACT COMMAND CANNOT BORROW CONTACT STATE FROM ANOTHER CASE, INCLUDING AFTER DATABASE RESTART.** |
| Next handoff | Execute the clean v14 journey on Docker or Podman and correct the first live case-isolation or persistence discrepancy it reveals. |

### Post-restart Contact parent-version isolation

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `04d3799324f5df41e1ed6e4c5cbc5ea014521844`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-seven commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After recovery and restart, the journey locks the exact `Tenant + Purpose + Case` RoadEvent but supplies its stale expected parent version. The command must reject before the otherwise-current Contact session can advance. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_PARENT_VERSION_CONFLICT`, and the full primary state must remain exactly `RECOVERY / event 2 / session 2 / contact 2 / audit 1 / cancelled 1 / pending 0`. Receipt schema v15 records the rejection and unchanged state. |
| Safety limits | This local assertion proves the version component of the command boundary. It sends no Contact action, grants no authority, and cannot replace a live engine run or the REL-013 external immutable archive. |
| Result | **A CURRENT CONTACT VERSION CANNOT BE MUTATED THROUGH A STALE ROAD EVENT PARENT VERSION, INCLUDING AFTER DATABASE RESTART.** |
| Next handoff | Execute the clean v15 journey on Docker or Podman and correct the first live parent-version or persistence discrepancy it reveals. |

### Post-restart closed-incident Contact terminality

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `d695d7fb56b1bb85d19c61bf94fde0b4fef172ad`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-eight commits ahead and zero behind, with no branch PR or workflow run. |
| Added behavior | After the verified Contact/closure race and a PostgreSQL restart, the journey locks the closure-winner RoadEvent and attempts another Contact transition. Persisted `CLOSED` must reject it before the session update. |
| Durable acceptance | PostgreSQL must return `POST_RESTART_INCIDENT_CLOSED`, and the closed case must remain exactly `CLOSED / event 3 / session 1 / contact 1 / audit 0 / cancelled 0 / pending 1`. Receipt schema v16 records the rejection and unchanged state. |
| Safety limits | The check proves terminality only for the defined local command journey. It sends no provider message, reopens no incident, grants no authority, and cannot replace live engine evidence or the REL-013 external immutable archive. |
| Result | **A DATABASE RESTART CANNOT TURN A CLOSED INCIDENT BACK INTO AN ACCEPTING CONTACT COMMAND SURFACE.** |
| Next handoff | Execute the clean v16 journey on Docker or Podman and correct the first live terminal-state or persistence discrepancy it reveals. |

### Closed-incident Contact delivery reservation fence

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `c8190688fb0a537d191b0888f577736c32785d03`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch forty-nine commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | The PostgreSQL Contact worker now excludes pending outbox rows whose exact tenant/case parent is already `CLOSED`, and repeats that parent-state fence when converting a prior claim into a short delivery reservation. If closure is observed at reservation, the repository returns `CANCELLED` without invoking the provider. |
| Local acceptance | Focused repository coverage requires a closed parent to produce no provider call and no second finalization transaction. SQL contract coverage requires both the claim and reservation statements to retain the `CLOSED` parent fence while preserving the existing short reservation and `SKIP LOCKED` behavior. |
| Safety limits | This prevents claims and reservations that begin after committed closure. It does not prove the remaining concurrent interval after a reservation has committed and before the external provider returns; that interval requires an engine journey and an explicit closure/delivery coordination decision. No provider, cloud service, or field endpoint is invoked by this local evidence. |
| Result | **A CONTACT MESSAGE CANNOT BE NEWLY CLAIMED OR RESERVED AFTER THE WORKER OBSERVES ITS PARENT INCIDENT AS CLOSED.** |
| Next handoff | Add the closed-parent outbox claim/reservation path to the disposable PostgreSQL journey, including proof that the provider callback is never entered, and bind it to the next engine receipt. |

### Engine-bound closed-parent Contact delivery proof

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `5311a9b1f2ccbcfc751d1a733b3b355877477918`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch fifty commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping build or journey process was active. |
| Added behavior | The disposable journey now submits the production-shaped claim against the closure-winner's pending Contact row and requires `NOT_CLAIMED`. It then creates a transaction-local pre-closure lease, exercises the reservation fence, and requires `NOT_RESERVED / PROVIDER_NOT_ENTERED`; rollback must restore one pending row with neither lease nor delivery token. |
| Durable acceptance | Receipt schema v17 adds the exact claim, reservation, provider-boundary, and `1 / unleased 1 / untokened 1` state results. The receipt remains impossible until migrations, both concurrency orderings, rollback, forward recovery, two database restarts, scope/version/terminal checks, and this delivery fence all pass on the same clean candidate. |
| Safety limits | The checked-in journey and focused harness are locally verified, but this executor has no Docker or Podman, so PostgreSQL has not executed the new statements and no v17 engine receipt exists. The proof does not authorize a provider, external dispatch, or activation, and a local receipt would not replace REL-013 archival. |
| Result | **THE CLOSED-PARENT OUTBOX FENCE IS PART OF THE CANDIDATE-BOUND ENGINE JOURNEY AND CANNOT REPORT PASS IF THE PROVIDER BOUNDARY IS CROSSED.** |
| Next handoff | Execute the clean v17 journey on Docker or Podman and correct the first real claim, reservation, or rollback discrepancy. |

### Contact finalization fence after concurrent closure

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `e5ca0f3c48b44b322564bddd49387f6ac48c149f`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the branch fifty-one commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping build or journey process was active. |
| Added behavior | Both PostgreSQL finalization statements now recheck the exact tenant/case parent before recording delivery or scheduling retry. If the RoadEvent becomes `CLOSED` while the untrusted provider callback is outside the transaction, neither finalization write is accepted and the repository returns `CANCELLED`. |
| Local acceptance | Focused coverage closes the parent during the provider callback and requires zero `delivered` and zero `retry` writes. SQL contract coverage requires the parent-state predicate on both finalization statements while preserving token and deadline fencing. |
| Safety limits | This prevents ROS from acknowledging delivery or retry after observed closure; it cannot retract a provider action that started before closure. No external provider is called by the test, and live PostgreSQL execution plus REL-013 archival remain open. |
| Result | **A PROVIDER RESULT RETURNING AFTER INCIDENT CLOSURE CANNOT BECOME A DURABLE CONTACT DELIVERY OR RETRY.** |
| Next handoff | Add the closure-during-provider finalization ordering to the disposable PostgreSQL journey and bind the zero-write result to the next receipt schema. |

### PostgreSQL proof for finalization after concurrent closure

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `88816bcd0056aefeb936b4218ce55122818e7a06`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-two commits ahead and zero behind. The worktree was clean and no overlapping build or journey process was active. |
| Added behavior | The disposable journey creates a transaction-local delivery reservation for the closure-winner's pending Contact message, then submits production-shaped delivered and retry finalization statements. Both must update zero rows because the exact tenant/case RoadEvent is already `CLOSED`; the reservation must remain unchanged until the proof transaction rolls back. |
| Durable acceptance | Receipt schema v18 adds `NOT_RECORDED` for delivered and retry finalization, `UNCHANGED` for the reservation, and the post-rollback `1 / unleased 1 / untokened 1` state. Any accepted finalization or escaped test reservation prevents a receipt. |
| Safety limits | Static and focused local tests verify the fail-closed journey contract, but Docker/Podman is unavailable, so PostgreSQL has not executed these statements and no v18 engine receipt exists. This is an acknowledgement/retry fence after a provider returns; it neither invokes nor retracts an external provider action and does not replace REL-013 archival. |
| Result | **A V18 ENGINE RECEIPT CANNOT PASS IF A RESULT RETURNING AFTER INCIDENT CLOSURE IS RECORDED AS DELIVERY OR RETRY.** |
| Next handoff | Execute the clean v18 journey on Docker or Podman and correct the first real finalization or rollback discrepancy. |

### Ambiguous provider success after incident closure

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `b238bdfa8da0586b8623f393162a6325fd8390ba`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-three commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping journey was active. |
| Added behavior | When a Contact provider reports `SENT` but closure or operator cancellation fences both durable delivery acknowledgement and retry, the PostgreSQL repository now returns `HUMAN_REVIEW` instead of the misleading `CANCELLED`. Closure before provider entry, or closure after an explicit `UNAVAILABLE`, remains `CANCELLED`. |
| Local acceptance | Focused tests distinguish all three orderings and require no delivered or retry write in the ambiguous path. The provider remains outside the SQL transaction and no execution authority is added. |
| Safety limits | `HUMAN_REVIEW` records uncertainty; it does not claim that the external message was delivered, cancelled, or retracted. Live PostgreSQL execution and REL-013 external archival remain open. |
| Result | **A PROVIDER-REPORTED SUCCESS THAT CANNOT BE DURABLY ACKNOWLEDGED IS ESCALATED AS AMBIGUOUS, NEVER MISLABELLED AS CANCELLED.** |
| Next handoff | Bind the `HUMAN_REVIEW` disposition to the PostgreSQL journey result after the v18 zero-write proof. |

### Candidate-bound ambiguous delivery disposition

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `0104f0662514c17016d32c5f731a64ea8cce0d76`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-four commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean. |
| Added behavior | The disposable journey now derives `HUMAN_REVIEW` only from the combined result `provider SENT / delivery not recorded / retry not recorded / parent CLOSED / reservation unchanged`. Missing any member leaves the disposition `CONFLICT` and blocks the receipt. |
| Durable acceptance | Receipt schema v19 records both the provider result and the derived disposition alongside the SQL finalization and rollback state, bound to the clean candidate and journey manifest. |
| Safety limits | The journey uses a declared test provider result and does not contact an external service. Docker/Podman remains unavailable, so no v19 engine receipt exists; local evidence does not replace REL-013 external archival. |
| Result | **THE ENGINE RECEIPT CANNOT LABEL AN UNACKNOWLEDGED PROVIDER SUCCESS CANCELLED OR PASS WITHOUT HUMAN REVIEW.** |
| Next handoff | Execute the clean v19 journey on Docker or Podman and correct the first real finalization, disposition, or rollback discrepancy. |

### Durable audit for ambiguous Contact delivery

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `98d16906ad7c8c0d6475ad7cd75c824a50023aa1`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-five commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean. |
| Added behavior | Before returning `HUMAN_REVIEW`, the PostgreSQL repository now appends `DELIVERY_RESULT_AMBIGUOUS` to the Contact-owned immutable audit. Its deterministic event identity is message-scoped and excludes the delivery token; retries reuse the same event. |
| Durable acceptance | The insert is guarded by the exact Contact row plus a cancelled or closed parent. If neither the insert nor the identical prior event is visible, the result fails closed to `CONFLICT` instead of emitting an unpersisted human-review state. |
| Safety limits | The audit states uncertainty only: it does not assert delivery, retry, cancellation, or external provider reversal. It adds no dispatch or activation authority. PostgreSQL engine execution and REL-013 external archival remain open. |
| Result | **AMBIGUOUS PROVIDER SUCCESS NOW SURVIVES WORKER RESTART AS APPEND-ONLY CONTACT AUDIT BEFORE HUMAN REVIEW IS REPORTED.** |
| Next handoff | Add the immutable ambiguity audit to the disposable PostgreSQL journey and require exact idempotent replay. |

### PostgreSQL proof for durable ambiguous Contact delivery

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `0996b3ab50e3892a688dd61b2113821bcbfef5a7`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-six commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | The disposable PostgreSQL journey now commits the exact `DELIVERY_RESULT_AMBIGUOUS` audit after the delivery/retry fence, then replays the same deterministic event through a new client process. |
| Durable acceptance | Receipt schema v20 requires one exact immutable event after both attempts, the same event identity on replay, the provider-success disposition `HUMAN_REVIEW`, and explicit exclusion of the delivery token from the audit fields. |
| Safety limits | The declared provider result remains synthetic. The audit records uncertainty and does not claim delivery, schedule retry, reverse an external effect, or grant activation authority. Docker/Podman execution and REL-013 external archival remain open. |
| Result | **HUMAN REVIEW CANNOT PASS THE JOURNEY WITHOUT ONE DURABLE, IDEMPOTENT, TOKEN-FREE AMBIGUITY EVENT.** |
| Next handoff | Execute the clean v20 journey on Docker or Podman and correct the first real audit uniqueness, persistence, or replay discrepancy. |

### Recovery of ambiguous Contact delivery disposition

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `8fd6bd1cf9eee5a1ea08d38a5a71c0f7277102ad`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-seven commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | A worker that cannot reserve the message now reads the exact message-scoped `DELIVERY_RESULT_AMBIGUOUS` event and restores `HUMAN_REVIEW` after restart without invoking the provider again. |
| Isolation acceptance | The lookup is constrained by Contact-owned `Tenant + Case + Session + deterministic Message event`, and requires the exact ambiguity event type. Missing or mismatched audit evidence cannot produce human review. |
| Safety limits | Recovery performs no send, delivery acknowledgement, retry, cancellation, incident transition, or activation. It only restores the previously persisted uncertainty disposition. Live PostgreSQL proof and REL-013 external archival remain open. |
| Result | **A RESTARTED CONTACT WORKER CAN RECOVER DURABLE DELIVERY UNCERTAINTY WITHOUT REPEATING THE EXTERNAL SIDE EFFECT.** |
| Next handoff | Add the no-provider recovery read to the disposable PostgreSQL journey and bind it to receipt v21. |

### PostgreSQL proof for Contact ambiguity recovery

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `5015a2c04e0b225e5b25450182abb81525ac6088`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-eight commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | After the durable ambiguity event and idempotent replay, the disposable journey now performs the restarted-worker status read and derives `HUMAN_REVIEW / PROVIDER_NOT_ENTERED` from the exact event. |
| Durable acceptance | Receipt schema v21 requires the recovered disposition, explicit non-entry to the provider, and matching full-row Outbox hashes before and after recovery. Missing exact audit evidence remains fail-closed. |
| Safety limits | Recovery is read-only and cannot acknowledge delivery, schedule retry, invoke a provider, cancel or close an incident, or grant activation. Docker/Podman execution and REL-013 external archival remain open. |
| Result | **THE ENGINE RECEIPT CANNOT CLAIM RECOVERY IF THE PROVIDER IS RE-ENTERED OR THE CONTACT OUTBOX CHANGES.** |
| Next handoff | Execute the clean v21 journey on Docker or Podman and correct the first real recovery-read or persistence discrepancy. |

### Operator visibility for ambiguous delivery after closure

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `bb4ee3886db125243dfe040113bf76c8eca8b59c`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch fifty-nine commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | A durable `DELIVERY_RESULT_AMBIGUOUS` Contact audit now makes the Human Safety API expose the case as `HUMAN_REVIEW`, even when the parent RoadEvent is already closed. The RoadEvent remains terminal, current recommendations remain withheld, and the immutable event remains visible in the operator timeline. |
| Local acceptance | API coverage closes the RoadEvent, injects the exact durable ambiguity event, and requires `HUMAN_REVIEW` without a mutation or recommendation revival. Dashboard coverage requires the Arabic human-review label plus the immutable event and reason in the rendered timeline. |
| Safety limits | This is visibility only: it does not reopen the incident, acknowledge delivery, schedule retry, invoke a provider, authorize activation, or resolve the ambiguity. PostgreSQL engine execution and REL-013 external archival remain open. |
| Result | **A CLOSED INCIDENT WITH AN UNRESOLVED AMBIGUOUS CONTACT RESULT CAN NO LONGER APPEAR OPERATIONALLY RESOLVED.** |
| Next handoff | Bind the committed ambiguity event to the Human Safety read disposition in the disposable PostgreSQL journey and receipt v22. |

### PostgreSQL proof for operator-visible Contact ambiguity

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `83f676ac656aae893fbea98b82f834f8f0ec18ec`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch sixty commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean and no overlapping test or journey process was active. |
| Added behavior | After recovering the durable Contact ambiguity, the disposable journey now runs the operator-facing state precedence against the exact tenant, purpose, case, session, message event, and closed RoadEvent. |
| Durable acceptance | Receipt schema v22 requires `HUMAN_REVIEW / PARENT_CLOSED` and a full Outbox-row hash unchanged by the Human Safety read. A missing or mismatched ambiguity event yields neither a passing receipt nor a false resolved state. |
| Safety limits | The read does not reopen or mutate the RoadEvent, resolve uncertainty, acknowledge delivery, schedule retry, invoke a provider, or authorize activation. Docker/Podman execution and REL-013 external archival remain open. |
| Result | **THE ENGINE RECEIPT CANNOT PASS IF A DURABLE AMBIGUOUS CONTACT RESULT IS HIDDEN BEHIND THE CLOSED-PARENT LABEL.** |
| Next handoff | Execute the clean v22 journey on Docker or Podman and correct the first real state-precedence or read-only persistence discrepancy. |

### Closed-incident command fence for operator-visible ambiguity

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `aa6b527f2de480c81c2d5d48203ba0fad61e5fd6`; live comparison kept `main` at `8096312169dc7f769a45b419d5678b5bd5f461ad`, the review branch sixty-one commits ahead and zero behind, with no branch PR or workflow run. The worktree was clean. No Docker, Podman, or local PostgreSQL server binary was available to execute v22. |
| Added behavior | The Operations command center now treats the trusted `CASE_CLOSED` response marker as a command fence even when unresolved delivery ambiguity intentionally presents the safety case as `HUMAN_REVIEW`. Takeover, escalation, and reassignment controls remain disabled. |
| Local acceptance | Dashboard coverage renders the immutable ambiguity timeline and Arabic human-review state while requiring all three command predicates to be false and their submit controls disabled. |
| Safety limits | The operator can observe uncertainty but cannot mutate the closed Contact or RoadEvent through ordinary Human Safety commands. No acknowledgement, resolution, dispatch, provider call, activation, or cloud action was added. |
| Result | **OPERATOR VISIBILITY OF A CLOSED-INCIDENT AMBIGUITY NO LONGER IMPLIES FALSE COMMAND AUTHORITY.** |
| Next handoff | Keep closed ambiguous delivery cases pinned in the operator queue regardless of personal or assignment filters, without enabling commands. |

### Closed-delivery ambiguity queue pin

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub showed candidate `0443bba8a842dd6142707b3411a35341abecfabb`; current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9`, with the review branch sixty-two commits ahead and thirty-six behind. No branch PR or workflow run existed, the worktree was clean, and the thirty-six newer `main` commits did not touch the Operations dashboard files changed here. |
| Added behavior | A case carrying both the trusted `CASE_CLOSED` marker and immutable `DELIVERY_RESULT_AMBIGUOUS` audit is now part of the urgent safety queue. It remains visible under personal and assignment filters even when low-severity, deadline-free, and assigned to another operator. Its queue priority is below overdue/imminent deadlines and above ordinary cases. |
| Local acceptance | Dashboard coverage uses a low-severity, deadline-free ambiguity assigned to another operator, selects `MY_CASES`, and requires the case to remain first and visible. Existing coverage still requires takeover, escalation, and reassignment predicates and controls to stay disabled. |
| Safety limits | Pinning changes visibility and ordering only. It grants no command authority, acknowledgement, resolution, dispatch, provider call, activation, collection, or cloud action. The branch has not yet been reconciled with the thirty-six newer `main` commits. |
| Result | **A CLOSED CONTACT DELIVERY AMBIGUITY CANNOT BE FILTERED OUT OF THE OPERATOR SAFETY QUEUE OR USED TO ENABLE COMMANDS.** |
| Next handoff | Reconcile and test the review candidate against the thirty-six newer `main` commits without merging into `main` or triggering paid evidence workflows. |

### Current-main integration candidate

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `41405f004eab3c88c449f90d755f9c8b7e53b259` was sixty-three commits ahead of and thirty-six behind `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9`, with no PR or workflow run. The worktree was clean and no overlapping execution was found. |
| Integrated behavior | The thirty-six `main` commits are combined with the ROS Brain candidate on the review branch only. The sole shared path, `packages/contracts/src/index.ts`, retains the Brain snapshot/next-evidence exports and adds the sensor-perception, cognitive-road-state, Saudi-safety, benchmark, and assurance exports from `main`; all other `main` paths were non-overlapping. |
| Local acceptance | TypeScript build and no-emit checks pass for all five projects. The combined tree passes 607 API, 33 dashboard, 36 mobile, and 8 domain tests, plus the new perception benchmark's eleven-case receipt and four invariant tests. Repository, runtime-composition, archive conditional-write, retention, negative-gate, and eight external-evidence policy checks pass. |
| Safety limits | This is a review-branch integration candidate, not a `main` merge or release. It adds no activation, dispatch, collection, deployment, cloud resource, or spending authority. PostgreSQL v22 remains unexecuted without Docker or Podman, and REL-013 still requires external immutable evidence. |
| Result | **THE ROS BRAIN CANDIDATE AND CURRENT SENSOR-AGNOSTIC MAIN BASE NOW HAVE ONE LOCALLY VERIFIED, NON-DESTRUCTIVE REVIEW TREE.** |
| Next handoff | Bind the sensor-agnostic cognitive road-state output to an owner-versioned ROS Brain input snapshot adapter while preserving abstention, Tenant + Purpose isolation, and recommendation-only authority. |

### Cognitive Road State snapshot ownership adapter

| Field | Current record |
|---|---|
| Resume point | GitHub candidate `019d5f737dcf19a47684d7d86cf27d51adbf545f` was sixty-four commits ahead of current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9` and zero behind, with no branch PR or workflow run. The local tree exactly matched the candidate tree and no overlapping execution was found. |
| Added behavior | A read-only adapter now accepts Cognitive Road State only through a `COGNITIVE_STATE_LEDGER` owner port and emits the versioned `ros-eye.cognitive-input-binding.v1` seam. It requires exact Tenant + Purpose + Case scope, positive revision, matching owner/state digest, and a state validity window containing the snapshot time. |
| Local acceptance | Coverage proves exact binding without exposing entities or observation identifiers, propagation of material contradiction as mandatory abstention, explicit absence without an invented revision, cross-purpose rejection, and fail-closed digest/time drift. |
| Safety limits | The adapter exports only revision, digest, validity times, and abstention posture. It does not collect sensor data, persist the state, change severity, issue a recommendation, activate a command, or alter the existing durable snapshot v1 schema. |
| Result | **COGNITIVE ROAD STATE CAN CROSS INTO THE ROS BRAIN SNAPSHOT BOUNDARY ONLY AS AN EXACT, OWNER-VERSIONED, SCOPE-BOUND, NON-EXECUTABLE RECEIPT.** |
| Next handoff | Add the cognitive binding as a required column set in a new append-only durable input-snapshot policy/migration, with old v1 rows remaining readable but never promoted as cognitive-bound evidence. |

### Durable Cognitive Road State input-snapshot policy

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub candidate `24a59357405c51cb67a27a5941f8a2f3279dcc83` was sixty-five commits ahead of current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9` and zero behind, with no branch PR or pull-request-triggered workflow run. The local tree matched the candidate tree and no overlapping execution was found. |
| Added behavior | Policy `ros-eye.input-snapshot.v2` is now represented by a required append-only Cognitive Road State binding. It can exist only for the exact Tenant + Purpose + Case + input version + v1 snapshot digest + capture time, and stores the owner revision/digest, validity window, abstention posture, source-ledger authority, and binding-policy version. |
| Durable acceptance | The repository fails closed when the exact v1 base is absent, treats only an exact replay as idempotent, rejects scope or validity drift before SQL, and returns a v2 receipt only when the extension row exists. The migration enforces the exact composite foreign key, non-null column set, version/authority checks, validity window, and rejection of UPDATE or DELETE. The combined candidate passed 617 API, 33 dashboard, 36 mobile, and 8 domain tests, plus fifteen perception contract/benchmark checks, all five project builds and no-emit checks, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks. |
| Legacy boundary | Existing v1 rows remain readable through their existing repository. They are never backfilled, rewritten, or returned as v2 cognitive evidence without the required extension row. The Cognitive Road State payload, entities, and observations remain under their source module's ownership. |
| Safety limits | The binding grants no sensor collection, recommendation, risk reduction, incident mutation, dispatch, provider call, activation, or execution authority. A live PostgreSQL migration remains unverified without Docker/Podman, and local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A SNAPSHOT CAN CLAIM THE COGNITIVE V2 POLICY ONLY THROUGH A COMPLETE, IMMUTABLE, OWNER-VERSIONED BINDING TO ITS EXACT V1 BASE.** |
| Next handoff | Compose the owner adapter, v1 snapshot append, and required v2 binding in one repeatable-read capture transaction, then prove rollback leaves neither a partial base nor a promoted v2 receipt. |

### Atomic cognitive input-snapshot capture

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub candidate `cd02a592f4f7dfe004f8a5922a3bebcf75e6c767` was sixty-seven commits ahead of current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9` and zero behind, with no branch PR or pull-request-triggered workflow run. The worktree was clean and no overlapping execution was found. |
| Added behavior | A dedicated capture service now reads the five existing source-ledger receipts and Cognitive Road State through the same SQL connection, then appends the v1 base and required v2 binding under one `REPEATABLE READ, READ WRITE` transaction. The production composition accepts a transaction-bound cognitive owner port, and runtime readiness now requires the v2 relation and its safety-critical columns. |
| Atomic acceptance | Missing cognitive owner state returns `SOURCE_UNAVAILABLE` before either insert. An exact replay is idempotent. A fail-closed result or persistence exception after the v1 insert forces rollback, leaving neither a partial v1 base nor a v2 receipt; the original persistence error remains visible. |
| Local evidence | The combined candidate passed 623 API, 33 dashboard, 36 mobile, and 8 domain tests, plus fifteen perception contract/benchmark checks, all five project builds and no-emit checks, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks. The focused atomic/cognitive/base and production-composition suite passed 17 of 17. |
| Safety limits | The transaction reads owner receipts and writes version bindings only. It copies no Cognitive Road State payload, grants no collection, recommendation, risk reduction, incident mutation, dispatch, activation, or execution authority, and preserves `SHADOW_ONLY`. Docker/Podman execution and REL-013 external archival remain open. |
| Result | **A COGNITIVE V2 RECEIPT CAN NO LONGER COMMIT WITHOUT ITS EXACT V1 BASE, AND A NEW V1 BASE CANNOT SURVIVE FAILURE OF ITS REQUIRED V2 BINDING.** |
| Next handoff | Require the governed recommendation journal to verify the exact v2 cognitive receipt and propagate `requiresAbstention` before accepting a shadow recommendation, while retaining v1 history as non-cognitive legacy evidence. |

### Cognitive-bound governed recommendation journal

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub candidate `234614af0e8ac20854438c12f57cfb9d165010f3` was sixty-eight commits ahead of current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9` and zero behind, with no branch PR or pull-request-triggered workflow run. No overlapping local test or build process was active. |
| Added behavior | Before any shadow journal INSERT, the governed writer now loads the exact cognitive `v2` receipt inside the existing `REPEATABLE READ` transaction and requires its Tenant + Purpose + Case + input version, base digest, and capture time to match the verified `v1` snapshot. A missing or mismatched receipt fails closed. |
| Abstention boundary | `cognitive_requires_abstention=true` is propagated as `EVALUATION_BLOCKED`; the recommendation remains visible to the caller for human review but is not persisted. The new migration independently checks the exact cognitive receipt and prohibits an abstaining recommendation insert. Existing immutable journal rows remain nullable legacy `v1` history and are not promoted to cognitive evidence. |
| Local evidence | The cognitive/journal/use-case/runtime and atomic-snapshot suite passed 33 of 33. The combined candidate passed 625 API, 33 dashboard, 36 mobile, and 8 domain tests (702 total), plus fifteen perception contract/benchmark checks. TypeScript build and no-emit checks passed for all five projects, along with repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks. |
| Safety limits | The change verifies receipts and writes immutable recommendation metadata only. It grants no collection, severity mutation, incident closure, dispatch, provider call, activation, or execution authority; every stored row remains `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, `activationAuthorized=false`, and pending human review. The PostgreSQL migration remains unexecuted on a live engine without Docker/Podman, and REL-013 external immutable archival remains open. |
| Result | **A SHADOW RECOMMENDATION CANNOT ENTER THE GOVERNED JOURNAL WITHOUT ITS EXACT NON-ABSTAINING COGNITIVE V2 RECEIPT.** |
| Next handoff | Bind the recommendation fingerprint and journal row to the cognitive receipt identity in the public read model, then prove a later cognitive revision withholds the prior recommendation without rewriting either history. |

### Cognitive receipt identity in the public recommendation read model

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub candidate `01ca0e952ccdc545b200885cff3589ed321ac4dd` was sixty-nine commits ahead of current `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9` and zero behind, with no branch PR or workflow run. No overlapping local build or journey process was active. |
| Added behavior | The governed read now verifies the journal's cognitive policy, revision, digest, and non-abstention flag against the exact durable `v2` receipt, then compares that receipt with the latest scoped cognitive receipt inside the same read-only `REPEATABLE READ` transaction. Only a current match is exposed through the Human Safety API and Arabic operator view. |
| Invalidation acceptance | A later cognitive revision/digest returns `WITHHELD / CURRENT_INPUT_CHANGED`, removes the prior recommendation from the live view, retains pending human review, and leaves the append-only recommendation and receipt histories unchanged. Missing, malformed, mismatched, or abstaining receipts fail closed. |
| Local evidence | The focused governed-read, Human Safety HTTP, and dashboard suites passed 32 of 32. The combined candidate passed 626 API, 33 dashboard, 36 mobile, and 8 domain tests (703 total), plus fifteen perception contract/benchmark checks. TypeScript build and no-emit checks passed for all five projects, along with repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks. |
| Safety limits | This is a read-model and visibility change only. It grants no collection, severity mutation, incident closure, dispatch, provider call, activation, or execution authority; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, `activationAuthorized=false`, and human review remain mandatory. PostgreSQL execution remains unverified without Docker/Podman, and local evidence is not REL-013 external immutable archival. |
| Result | **A PRIOR SHADOW RECOMMENDATION CAN NO LONGER APPEAR CURRENT AFTER ITS COGNITIVE SOURCE RECEIPT CHANGES.** |
| Next handoff | Bind high-risk resolution authorization to the same cognitive receipt identity and reject its use after cognitive revision drift without rewriting authorization history. |

### Cognitive-bound high-risk closure authorization

| Field | Current record |
|---|---|
| Resume point | On 2026-09-19, GitHub candidate `a461a469503f44577c0f0613627557bbb3eb96b0` was seventy commits ahead of `main` at `cfecaae07ef9673d80054ea11bd26ee2305e69e9`, with no branch PR or workflow run and no overlapping local process. During verification, `main` advanced in two eleven-commit batches through `14037e9f7a633d6c9af537f98a7643478829f60e` to `3255a94a7f78607014a410e083174483fa2c2c2f`; the non-conflicting adapter-certification, epistemic-coverage, and pinned local object-storage changes were integrated into the review candidate and the combined tree was reverified after each batch. |
| Added behavior | Every newly issued high-risk closure authorization now copies the exact cognitive `v2` policy, revision, and digest from the governed snapshot. The serializable close transaction requires that exact non-abstaining receipt and also requires it to remain the latest scoped cognitive receipt before changing the RoadEvent, audit log, or outbox. |
| Legacy and invalidation boundary | Historical authorizations without cognitive identity remain readable but cannot execute a high-risk close. A newer cognitive revision or digest invalidates use of the prior authorization without updating or deleting its history. The migration adds an all-or-none `v2` column set and exact composite foreign key to the append-only cognitive receipt. |
| Local evidence | The focused domain, application, Human Safety HTTP, and PostgreSQL repository suites passed 49 of 49. After integrating current `main`, the combined candidate passed 649 API, 33 dashboard, 36 mobile, and 8 domain tests (726 total), plus thirty-two perception, benchmark, adapter-certification, and epistemic-coverage checks. TypeScript build and no-emit checks passed for all five projects, along with repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks. |
| Safety limits | Closure still requires an explicit human supervisor and never derives authority from the recommendation or cognitive receipt. The change grants no collection, severity reduction, dispatch, provider call, activation, or autonomous execution; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. PostgreSQL execution remains unverified without Docker/Podman, and local evidence is not REL-013 external immutable archival. |
| Result | **A HIGH-RISK CLOSURE AUTHORIZATION CAN NO LONGER BE USED AFTER ITS COGNITIVE SOURCE RECEIPT CHANGES, AND ITS ORIGINAL HISTORY REMAINS IMMUTABLE.** |
| Next handoff | Add this cognitive authorization binding and drift rejection to the disposable PostgreSQL journey and its next receipt, proving commit and rollback on a real engine without weakening REL-013. |

### Append-only high-risk closure authorization journal

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `f1cf9e6454633d06df5539016e181727f834497a` was seventy-seven commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. The approved cadence remains hourly. |
| Added behavior | Every newly issued closure authorization is now copied to an independent append-only journal in the same transaction as the RoadEvent, audit, and outbox writes. The row is bound to the exact Tenant + Purpose + Case + authorized event version and, when source-bound, to the complete v1 snapshot and cognitive v2 policy/revision/digest identity. Runtime readiness now requires the relation and its critical scope and source-binding columns. |
| Atomic and immutable acceptance | The repository writes the authorization row before audit and outbox and fails the transaction unless exactly one row is appended. The migration independently enforces scoped RoadEvent ownership, exact v1/v2 foreign keys, all-or-none source identity, and rejects UPDATE or DELETE. The journal records human authorization evidence only and grants no closure or activation authority. |
| Local evidence | The focused PostgreSQL repository and migration suite passed 17 of 17. The full workspace passed 653 API, 33 dashboard, 36 mobile, and 8 domain tests (730 total). Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey exited 127 before execution because neither Docker nor Podman is installed; therefore the migration and trigger are not claimed as proven on a live PostgreSQL engine. |
| Safety limits | The journal adds immutable authorization provenance; it does not create authorization, derive it from a recommendation, or execute a close. Human supervisor authorization remains required; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` are unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A NEW HIGH-RISK CLOSURE AUTHORIZATION CANNOT BE PERSISTED WITHOUT AN INDEPENDENT, SCOPE-BOUND, SOURCE-BOUND, APPEND-ONLY HISTORY ROW IN THE SAME TRANSACTION.** |
| Next handoff | Add journal persistence, mutation rejection, and post-restart recovery to the disposable PostgreSQL journey and its next receipt, proving the exact behavior on a live engine. |

### PostgreSQL closure-authorization journal receipt

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `65cffc695fd4645e926f993eb155902f0772dc68` was seventy-eight commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. The approved cadence remains hourly. |
| Added behavior | The disposable cognitive-closure journey now writes the exact scoped v1/v2-bound human authorization into `road_event_closure_authorization_journal`. It then attempts both UPDATE and DELETE, accepts only the migration trigger's append-only rejection, records the exact row identity, restarts PostgreSQL, and requires the same identity to remain singular and unchanged. |
| Receipt boundary | Receipt `ros-brain.local-postgres-journey-receipt.v26` is withheld unless mutation rejection, pre-restart state, and post-restart state are all present and exact. The manifest digest includes the migration and journey scripts, while `externalArchiveReceipt` remains null. |
| Local evidence | The focused repository and PostgreSQL harness contract passed 51 of 51. The full workspace passed 654 API, 33 dashboard, 36 mobile, and 8 domain tests (731 total). Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey exited 127 before execution because neither Docker nor Podman is installed; therefore no PostgreSQL `v26` receipt is claimed. |
| Safety limits | The fixture stores and reads human authorization provenance only. It grants no collection, severity reduction, dispatch, provider call, activation, or autonomous closure authority; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. A local receipt would not satisfy REL-013 external immutable archival. |
| Result | **THE NEXT LIVE RECEIPT IS BLOCKED UNLESS POSTGRESQL ENFORCES THE JOURNAL'S APPEND-ONLY TRIGGER AND PRESERVES THE EXACT SOURCE-BOUND ROW ACROSS RESTART.** |
| Next handoff | Run the clean `v26` journey on Docker or Podman and fix the first actual migration, trigger, or restart-persistence discrepancy before accepting its receipt. |

### Journal-bound high-risk closure gate

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `f497731cd5c9ff1fb6d85052689fa31795bfdee0` was seventy-nine commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. The approved cadence remains hourly. |
| Added behavior | The serializable high-risk closure check now requires the exact independent authorization-journal row as well as the RoadEvent authorization fields, governed v1 snapshot, and current non-abstaining cognitive v2 receipt. The journal match covers Tenant + Purpose + Case + authorized event version, human actor, authorization time and reason, and the exact v1/v2 source identity. A missing or mismatched journal rejects closure before RoadEvent, audit, or outbox writes. |
| Journey contract | Both the pre-restart drift attempt and the post-restart retry consume the exact journal row in their closure gates. Receipt `ros-brain.local-postgres-journey-receipt.v27` is withheld unless those rejection and unchanged-write-set proofs succeed. |
| Local evidence | The focused PostgreSQL repository and harness contract passed 52 of 52. The full workspace passed 655 API, 33 dashboard, 36 mobile, and 8 domain tests (732 total). Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey exited 127 before execution because neither Docker nor Podman is installed; therefore no PostgreSQL `v27` receipt is claimed. |
| Safety limits | The journal is evidence of prior explicit human authorization, not a source of authority. The change grants no collection, severity reduction, dispatch, provider call, activation, or autonomous closure; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **HIGH-RISK CLOSURE NOW FAILS CLOSED WHEN ITS INDEPENDENT APPEND-ONLY AUTHORIZATION RECORD IS ABSENT OR DOES NOT EXACTLY MATCH THE CURRENT GOVERNED SOURCE.** |
| Next handoff | Run the clean `v27` journey on Docker or Podman and fix the first actual journal-gate, transaction, or restart-persistence discrepancy before accepting its receipt. |

### Journal-verified closure authorization read model

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `3b04c5d5dc2bd55b98f6b801e54d6360238db2f0` was eighty commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | PostgreSQL RoadEvent reads now expose a closure authorization only when an independent journal row exactly matches the current Tenant + Purpose + Case + Version, human actor, authorization time and reason, and complete v1/v2 source identity. If the row is absent or mismatched, the authorization is withheld from the application and operator read model while the underlying append-only history remains untouched. |
| Fail-closed acceptance | An exact journal match restores the governed authorization. A missing journal row returns no authorization, so a non-closed high-risk case remains in human review instead of appearing resolved. The same scoped query is used by single-case and list reads; no caller can self-assert the journal match. |
| Local evidence | The focused PostgreSQL repository suite passed 19 of 19 after building all workspace dependencies. The full workspace passed 656 API, 33 dashboard, 36 mobile, and 8 domain tests (733 total). Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live PostgreSQL journey remains unclaimed without Docker or Podman. |
| Safety limits | This is visibility hardening only. It neither creates authorization nor closes an incident, and grants no collection, severity reduction, dispatch, provider call, activation, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **AN AUTHORIZATION STORED ONLY ON THE ROAD EVENT CAN NO LONGER APPEAR ACTIONABLE TO OPERATORS WITHOUT ITS EXACT INDEPENDENT APPEND-ONLY JOURNAL RECORD.** |
| Next handoff | Add the journal-match disposition to the disposable PostgreSQL operator-read journey and require it to remain withheld after restart when the journal row is absent or mismatched. |

### Post-restart closure-authorization read proof

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `7aeef1686f8c989e6fe680175e51289872d0ec3a` was eighty-one commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The disposable PostgreSQL journey now evaluates the exact operator-read journal match after the database restart. It requires the intact event and journal to produce `AUTHORIZED`, temporarily changes the RoadEvent authorization reason inside a savepoint, requires that mismatch to produce `WITHHELD`, rolls the savepoint back, and requires `AUTHORIZED` to be restored. |
| Atomic acceptance | The proof hashes the RoadEvent and independent journal and counts RoadEvent audit and outbox rows before the mismatch. Receipt `ros-brain.local-postgres-journey-receipt.v28` is withheld unless rollback restores the exact event and the event, audit, outbox, and journal write-set remains unchanged. The journey manifest now binds the new proof script. |
| Local evidence | The focused PostgreSQL harness contract passed 35 of 35. The full workspace passed 657 API, 33 dashboard, 36 mobile, and 8 domain tests (734 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. The live journey remains unclaimed until Docker or Podman is available. |
| Safety limits | This proves a read-time visibility boundary only; it does not create authorization, close an incident, collect data, change severity, dispatch, call a provider, activate, or act autonomously. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. A local receipt would not satisfy REL-013 external immutable archival. |
| Result | **THE NEXT LIVE RECEIPT IS BLOCKED UNLESS A POST-RESTART JOURNAL MISMATCH IS WITHHELD AND ITS ROLLBACK LEAVES NO DURABLE WRITE.** |
| Next handoff | Run the clean `v28` journey on Docker or Podman and fix the first actual mismatch-disposition, rollback, or restart-persistence discrepancy before accepting its receipt. |

### Missing-journal closure-authorization read proof

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `525481f3699972e04c964066f01556e89ae9c80f` was eighty-two commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The post-restart operator-read proof now creates a transaction-scoped legacy RoadEvent carrying human authorization fields but no independent journal row. The read disposition must be `WITHHELD`, then the savepoint is rolled back before the existing mismatch and restoration checks continue. |
| Fail-closed acceptance | Receipt `ros-brain.local-postgres-journey-receipt.v29` is withheld unless exact journal evidence reads `AUTHORIZED`, missing journal evidence reads `WITHHELD`, mismatched evidence reads `WITHHELD`, rollback restores `AUTHORIZED`, and the RoadEvent, audit, outbox, and journal write-set remains unchanged. |
| Local evidence | The focused PostgreSQL harness contract passed 36 of 36. The full workspace passed 658 API, 33 dashboard, 36 mobile, and 8 domain tests (735 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. The live journey remains unclaimed until Docker or Podman is available. |
| Safety limits | The temporary fixture is rolled back and does not create durable authorization or history. The change grants no collection, severity reduction, dispatch, provider call, activation, or autonomous closure; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **BOTH MISSING AND MISMATCHED INDEPENDENT JOURNAL EVIDENCE ARE NOW REQUIRED TO REMAIN NON-ACTIONABLE IN THE NEXT POST-RESTART RECEIPT.** |
| Next handoff | Run the clean `v29` journey on Docker or Podman and fix the first actual missing-journal, mismatch, rollback, or restart-persistence discrepancy before accepting its receipt. |

### Journal verification across the operator queue

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `3b8930f39a8be3de89a609fcbc090171913116c6` was eighty-three commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The PostgreSQL list path that feeds the operator queue is now directly covered with matched and missing-journal rows in one page. It preserves an authorization only for the exact journal match and withholds the other row without hiding the incident itself or changing pagination. |
| Fail-closed acceptance | The list query must perform the same Tenant + Purpose + Case + Version journal check as the single-case read. One unsafe row cannot inherit another row's match, and the withheld incident remains visible for human review. |
| Local evidence | The focused PostgreSQL repository suite passed 20 of 20. The full workspace passed 659 API, 33 dashboard, 36 mobile, and 8 domain tests (736 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build dependencies were regenerated before the focused test. |
| Safety limits | This adds queue-path regression evidence and no execution authority. It does not collect data, change severity, close an incident, dispatch, call a provider, activate, or act autonomously. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A MISSING JOURNAL ROW CAN NO LONGER BE REGRESSED INTO AN ACTIONABLE CLOSURE AUTHORIZATION THROUGH THE PAGINATED OPERATOR LIST PATH.** |
| Next handoff | Carry the same withheld disposition through the authenticated RoadEvent HTTP list response and prove that operator clients receive the incident without executable closure authorization. |

### Journal-withheld authorization at the authenticated HTTP boundary

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `8c026b77c44959710738ec34784e70822c5cc4ba` was eighty-four commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The authenticated RoadEvent list boundary is now directly covered for the persistence-withheld shape: the incident remains in the operator page while `closureAuthorization` is explicitly `null`. The HTTP envelope cannot turn the absence of an exact journal-verified authorization into an executable closure capability. |
| Fail-closed acceptance | An authenticated operator with matching Tenant + Purpose receives the case identity and review data, but no closure actor, reason, timestamp, or governed source binding when persistence withholds authorization. The existing authorization and scope checks remain in force. |
| Local evidence | The focused HTTP suite passed 5 of 5. The full workspace passed 660 API, 33 dashboard, 36 mobile, and 8 domain tests (737 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed, so no live `v29` receipt is claimed. |
| Safety limits | This is boundary regression evidence only. It neither creates authorization nor closes an incident, and grants no collection, severity reduction, dispatch, provider call, activation, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A JOURNAL-WITHHELD INCIDENT REMAINS VISIBLE THROUGH THE AUTHENTICATED HTTP LIST WITHOUT AN EXECUTABLE CLOSURE AUTHORIZATION.** |
| Next handoff | Carry the explicit null authorization through the operations-dashboard gateway and rendering path, proving that the incident remains reviewable while closure controls stay unavailable. |

### Journal-withheld authorization in operator closure controls

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `f3a5005285799bad7d8a537b14fa6ab17e85e854` was eighty-six commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, or overlapping local process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The operations dashboard now keeps a journal-withheld RoadEvent visible for review while explicitly marking closure unavailable. The `CLOSED` option is disabled when `closureAuthorization` is null, and a direct controller call fails before any gateway request. Other authorized lifecycle transitions remain available. |
| Fail-closed acceptance | A null authorization cannot be converted into a closure attempt by DOM manipulation or direct controller invocation. Once a supervisor creates a visible authorization through the existing governed path, the close option becomes available again; the dashboard still grants no authority beyond the server-side checks. |
| Local evidence | The focused dashboard suite passed 34 of 34. The full workspace passed 660 API, 34 dashboard, 36 mobile, and 8 domain tests (738 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed, so no live `v29` receipt is claimed. |
| Safety limits | This is a defense-in-depth operator boundary; PostgreSQL and API remain authoritative. It does not create authorization, close an incident, collect data, change severity, dispatch, call a provider, activate, or act autonomously. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A JOURNAL-WITHHELD CASE REMAINS REVIEWABLE, BUT THE DASHBOARD CANNOT SUBMIT OR DISPLAY AN AVAILABLE CLOSE ACTION UNTIL GOVERNED HUMAN AUTHORIZATION IS PRESENT.** |
| Next handoff | Add the withheld-versus-authorized closure-control state to the authenticated browser workflow across the real HTTP gateway, proving no closure request is emitted before authorization and that the exact authorized revision restores the control. |

### Exact authorization revision across the authenticated dashboard gateway

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `e2214dd664d316f5010be3101a8ae564fe3da8a1` was eighty-seven commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The authenticated dashboard workflow now proves that a journal-withheld RoadEvent renders with `CLOSED` disabled and rejects a direct closure attempt before the HTTP gateway emits any transition request. Supervisor authorization returns revision 8; only that exact revision re-enables the control and is sent as `expectedVersion: 8` in the subsequent authenticated closure request. |
| Fail-closed acceptance | Before authorization, no `POST /transition` exists in the observed request sequence. After authorization, the gateway carries trusted Bearer, Tenant, and Purpose context without self-asserted identity headers, and the closure request is accepted only with the exact authorized revision. |
| Local evidence | The focused dashboard suite passed 34 of 34. The full workspace passed 660 API, 34 dashboard, 36 mobile, and 8 domain tests (738 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | The HTTP endpoint is exercised through the production `HttpRoadEventGateway` request contract with a deterministic in-process fetch boundary; no external service, real incident, dispatch, or closure was invoked. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **THE AUTHENTICATED DASHBOARD EMITS ZERO CLOSURE REQUESTS WHILE AUTHORIZATION IS WITHHELD AND RESTORES THE CONTROL ONLY FOR THE EXACT SUPERVISOR-AUTHORIZED REVISION.** |
| Next handoff | Add authenticated HTTP conflict evidence showing that cognitive or event revision drift after authorization returns 409, marks the selected view stale, disables closure, and emits no automatic retry. |

### Authorization drift conflict at the authenticated dashboard boundary

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `71380fcf0360f4c6132aa9c23cefbe6daeabe803` was eighty-eight commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The authenticated dashboard workflow now exercises an authorized revision that conflicts at closure time. HTTP 409 is sanitized, marks the selected case stale, disables every transition including `CLOSED`, and emits exactly one transition request with no automatic retry. |
| Fail-closed acceptance | A cognitive or RoadEvent revision conflict cannot retain an actionable closure control or leak the server's internal conflict reason. The operator receives a bounded refresh instruction, while the selected incident and human-review context remain visible. |
| Local evidence | The focused dashboard suite passed 35 of 35. The full workspace passed 660 API, 35 dashboard, 36 mobile, and 8 domain tests (739 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | This verifies fail-closed client behavior against the production HTTP gateway contract with a deterministic in-process response. It performs no external call or incident mutation and grants no collection, dispatch, severity reduction, activation, or autonomous closure. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **AN AUTHORIZATION-REVISION CONFLICT NOW FAILS CLOSED IN THE AUTHENTICATED OPERATOR PATH WITHOUT RETRY, INTERNAL-DATA LEAKAGE, OR A REMAINING CLOSURE CONTROL.** |
| Next handoff | Prove that an explicit operator refresh after the 409 reads the newer revision, keeps the incident reviewable with authorization withheld, and never reuses or retries the stale closure request. |

### Explicit recovery from a stale closure conflict

| Field | Current record |
|---|---|
| Resume point | On 2026-09-20, GitHub candidate `85f818ca88e7dd41ad055f3f96c4cacfc98d1a05` was eighty-nine commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | After an authenticated closure request conflicts, only an explicit operator refresh reads the newer revision. The refreshed incident remains visible at revision 9 with `closureAuthorization=null`; ordinary review transitions remain available, while `CLOSED` remains disabled. |
| Fail-closed acceptance | The stale request is emitted exactly once and is never retried or rebound to revision 9. Refresh performs only authenticated list, detail, and timeline reads, clears the stale transport state, and cannot revive the invalidated authorization. |
| Local evidence | The focused dashboard suite passed 35 of 35. The full workspace passed 660 API, 35 dashboard, 36 mobile, and 8 domain tests (739 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | This validates client recovery over the production HTTP gateway contract with deterministic in-process responses. It does not create a replacement authorization, close an incident, call an external service, dispatch, activate, or act autonomously. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A CONFLICTED CLOSURE REQUEST CANNOT BE REPLAYED OR REVIVED: EXPLICIT REFRESH RECOVERS THE NEWER INCIDENT ONLY WITH AUTHORIZATION WITHHELD.** |
| Next handoff | Require a new governed supervisor authorization against revision 9 and prove that only its returned revision can re-enable closure; the invalidated revision-8 authorization must remain historical and unusable. |

### Revision-bound reauthorization after conflict recovery

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `2999db2a1128e7feec9be28e70ac9b3714f32356` was ninety commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | After refresh exposes revision 9 with authorization withheld, the authenticated dashboard can re-enable closure only by issuing a new supervisor authorization with `expectedVersion=9`. The returned revision 10 carries the replacement authorization; the invalidated revision-8 authorization remains visible only as historical audit evidence. |
| Fail-closed acceptance | The conflicted closure request remains singular and is never retried. The replacement request is singular and exactly revision-bound; closure stays disabled throughout revision 9 and becomes available only from the trusted revision-10 response. The earlier authorization cannot be rebound or reused. |
| Test-gate repair | The Domain package no longer relies on a shell-dependent recursive glob that could report success with zero tests. It now uses the repository test-file runner and executes all eight RoadEvent safety tests on a clean workspace. |
| Local evidence | The focused dashboard suite passed 35 of 35. The full workspace passed 660 API, 35 dashboard, 36 mobile, and 8 domain tests (739 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | This validates the browser/controller boundary against the production HTTP gateway contract using deterministic in-process responses. It does not close an incident, call an external service, dispatch, activate, or act autonomously. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A CONFLICT-INVALIDATED AUTHORIZATION REMAINS HISTORICAL AND UNUSABLE; ONLY A NEW SUPERVISOR AUTHORIZATION BOUND TO REVISION 9 RETURNS THE REVISION 10 CONTROL STATE.** |
| Next handoff | Bind the same conflict-refresh-reauthorize sequence to the in-process API HTTP handler so the real handler, not only the dashboard fetch boundary, proves 409, withheld refresh, and exact replacement authorization envelopes. |

### API-handler proof of conflict recovery and exact reauthorization

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `547d8e1ed066de159edad24ff763baa3b64db64e` was ninety-one commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The in-process production RoadEvent HTTP handler now proves the recovery sequence itself: revision 8 is authorized, a governed severity update advances to revision 9 and withholds that authorization, the stale revision-8 closure returns HTTP 409, the detail read remains reviewable with `closureAuthorization=null`, and one replacement supervisor authorization bound to revision 9 returns revision 10. |
| Fail-closed acceptance | The stale authorization cannot close or rebind the incident. Both authorization records remain append-only in the audit timeline at revisions 8 and 10, while only the replacement authorization appears on the current revision. Tenant, purpose, supervisor authority, expected-version validation, and distinct idempotency identities cross the actual HTTP handler. |
| Local evidence | The focused RoadEvent HTTP suite passed 6 of 6. The full workspace passed 661 API, 35 dashboard, 36 mobile, and 8 domain tests (740 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | This is an in-process handler and memory-repository proof; it executes no external HTTP call, PostgreSQL engine, incident closure, dispatch, activation, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **THE REAL API HANDLER NOW FAILS A STALE CLOSURE WITH 409, RETURNS REVISION 9 WITH AUTHORIZATION WITHHELD, AND ACCEPTS ONLY A NEW REVISION-9 SUPERVISOR AUTHORIZATION TO PRODUCE REVISION 10.** |
| Next handoff | Drive the same HTTP-handler sequence through the PostgreSQL repository adapter so the 409, withheld refresh, replacement authorization journal, and two-entry audit history are proven in one transaction-backed integration test. |

### PostgreSQL-adapter rollback and exact reauthorization proof

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `4dc99092c20a8c65783f579916aea989a3855031` was ninety-two commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The production `PostgresRoadEventRepository` orchestration now proves that a revision-8 closure attempt rolls back after the stored row has advanced to revision 9. The subsequent scoped read returns revision 9 with authorization withheld, and only a replacement supervisor authorization bound to expected revision 9 produces revision 10 and appends the current authorization journal entry. |
| Fail-closed acceptance | The stale attempt issues no RoadEvent update, authorization-journal append, audit append, or outbox append and ends in exactly one rollback. The replacement path commits once, preserves the historical revision-8 authorization, and appends revision 10 to both the authorization journal and audit history with versioned v2 source evidence. |
| Local evidence | The focused PostgreSQL-repository suite passed 21 of 21. The full workspace passed 662 API, 35 dashboard, 36 mobile, and 8 domain tests (741 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. |
| Safety limits | This exercises the real repository transaction and SQL orchestration against a stateful deterministic PostgreSQL client double; it is not evidence from a live PostgreSQL engine or restart. No external call, incident closure, dispatch, activation, or autonomous action occurs. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged; local evidence is not REL-013 external immutable archival. |
| Result | **A STALE CLOSURE ROLLS BACK WITHOUT PARTIAL WRITES; REVISION 9 REMAINS REVIEWABLE WITH AUTHORIZATION WITHHELD, AND ONLY AN EXACT REVISION-9 REAUTHORIZATION COMMITS REVISION 10 WHILE PRESERVING THE REVISION-8 HISTORY.** |
| Next handoff | Add this rollback-withheld-reauthorize sequence to the local PostgreSQL journey and its next receipt, then prove it after restart on an available Docker or Podman engine. |

### PostgreSQL journey contract for exact closure reauthorization

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `c62dff25a756fcfa5a351fa91278547fb576a343` was ninety-three commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | The disposable PostgreSQL journey now establishes an append-only revision-8 authorization, keeps the current revision 9 authorization withheld, rejects a stale revision-8 closure through an explicit savepoint rollback, and accepts only a replacement supervisor authorization bound to revision 9 to create revision 10. |
| Fail-closed acceptance | The stale attempt must leave the RoadEvent, Audit, Outbox, and authorization journal unchanged. The replacement commits one current authorization, one audit entry, and one outbox entry; journal and audit histories must remain exactly `[8, 10]`, and the hash of the historical revision-8 journal row must remain unchanged. |
| Receipt boundary | Receipt `ros-brain.local-postgres-journey-receipt.v30` is withheld unless the stale rollback is unchanged, refresh is `WITHHELD`, replacement is `COMMITTED`, authorization history is `8,10`, and current version is `10`. The journey manifest binds the new proof script; `externalArchiveReceipt` remains null. |
| Local evidence | Shell syntax checks and the focused PostgreSQL harness contract passed 37 of 37. The full workspace passed 663 API, 35 dashboard, 36 mobile, and 8 domain tests (742 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey exited 127 before execution because neither Docker nor Podman is installed; therefore no PostgreSQL `v30` receipt or live transaction result is claimed. |
| Safety limits | The fixture exercises scoped human authorization provenance only. It grants no collection, severity reduction, incident closure, dispatch, provider call, activation, or autonomous action; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. A local receipt would not satisfy REL-013 external immutable archival. |
| Result | **THE V30 CONTRACT NOW REQUIRES A ZERO-WRITE STALE ROLLBACK, A WITHHELD REVISION-9 READ, AND ONE EXACT REVISION-9 REAUTHORIZATION THAT PRESERVES THE REVISION-8 HISTORY. LIVE ENGINE EXECUTION REMAINS OPEN.** |
| Next handoff | Run the clean `v30` journey on Docker or Podman and fix the first actual SQL, transaction, or receipt discrepancy before accepting the receipt. |

### Post-restart durability of exact closure reauthorization

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `fdc349d5c3950fd931bc62d00be267928ec72e1c` was ninety-four commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty starting worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | After the exact revision-9 replacement authorization produces revision 10, the disposable journey now records the cluster identity and complete reauthorization state, performs a distinct third PostgreSQL restart, and requires the same current authorization and append-only history afterward. |
| Restart acceptance | Before and after restart, the state must remain exactly `RECOVERY|10|AUTHORIZED|8,10|8,10|1|<historical-v8-journal-md5>`: the current journal match remains actionable only for revision 10, journal and authorization-audit histories remain `[8,10]`, exactly one current closure-authorization outbox event remains, and the historical revision-8 journal hash cannot change. The cluster system identifier must remain stable while the postmaster start time must change. |
| Receipt boundary | Receipt `ros-brain.local-postgres-journey-receipt.v31` is withheld unless the complete state is equal before and after the distinct restart and the restart identity chain is continuous. The receipt records both states and both postmaster start times; `externalArchiveReceipt` remains null. |
| Local evidence | Shell syntax checks and the focused PostgreSQL harness contract passed 38 of 38. The full workspace passed 664 API, 35 dashboard, 36 mobile, and 8 domain tests (743 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey cannot execute without Docker or Podman, so no PostgreSQL `v31` receipt or live restart result is claimed. |
| Safety limits | This is a fail-closed journey and receipt contract, not live-engine evidence. It grants no collection, severity reduction, incident closure, dispatch, provider call, activation, or autonomous action; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **THE V31 RECEIPT IS NOW BLOCKED UNLESS THE EXACT REVISION-10 REAUTHORIZATION, `[8,10]` APPEND-ONLY HISTORY, SINGLE OUTBOX WRITE, AND HISTORICAL REVISION-8 HASH SURVIVE A DISTINCT POSTGRESQL RESTART.** |
| Next handoff | Run the clean `v31` journey on Docker or Podman and fix the first actual SQL, transaction, restart, or receipt discrepancy before accepting the receipt. |

### Post-restart exact closure finalization

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `f88446cba3289211ee3a5e8eb5d1606cfcfa8135` was ninety-five commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty starting worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | After the distinct PostgreSQL restart, the journey rejects the historical revision-8 authorization without a write, consumes the exact current revision-10 supervisor authorization once to close the fixture at revision 11, and rejects a duplicate revision-10 retry. |
| Atomic acceptance | Historical and duplicate attempts leave the RoadEvent, Audit, and Outbox unchanged. The accepted path requires the exact Tenant + Purpose + Case + Version journal row and current non-abstaining cognitive snapshot, appends one `road_event.closed` audit and one `RoadEventClosed` outbox event, preserves authorization histories `[8,10]`, preserves the revision-8 journal hash, and exposes no current actionable authorization after version advances to 11. |
| Receipt boundary | Receipt `ros-brain.local-postgres-journey-receipt.v32` is withheld unless the post-restart proof reports historical `REJECTED`, exact `CONSUMED`, duplicate `REJECTED`, history `8,10`, and final state `CLOSED|11`. The new finalization script is included in the journey manifest; `externalArchiveReceipt` remains null. |
| Local evidence | Shell syntax checks and the focused PostgreSQL harness contract passed 39 of 39. The full workspace passed 665 API, 35 dashboard, 36 mobile, and 8 domain tests (744 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey cannot execute without Docker or Podman, so no PostgreSQL `v32` receipt or live transaction result is claimed. |
| Safety limits | This is a transaction and receipt contract over disposable data, not authority derived from ROS recommendations. Human supervisor evidence remains mandatory; no collection, severity reduction, dispatch, provider call, activation, or autonomous closure is granted. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **THE V32 CONTRACT NOW REQUIRES THE RESTARTED INCIDENT TO REJECT HISTORICAL AUTHORITY, CONSUME THE EXACT CURRENT HUMAN AUTHORIZATION ONCE, AND REJECT REPLAY WITHOUT DUPLICATING AUDIT OR OUTBOX WRITES.** |
| Next handoff | Run the clean `v32` journey on Docker or Podman and fix the first actual SQL, transaction, restart, finalization, or receipt discrepancy before accepting the receipt. |

### Terminal closure durability after a distinct restart

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `3075578038fe62bbb68e8ed52d77a631245efcd9` was ninety-six commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty starting worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | After exact revision-10 authorization is consumed and the disposable incident closes at revision 11, the journey captures the complete terminal state, performs another distinct PostgreSQL restart, and requires the identical state afterward. |
| Restart acceptance | Before and after restart, the state must remain exactly `CLOSED|11|WITHHELD|8,10|8,10|1|1|<historical-v8-journal-md5>`: no current closure authorization is actionable, journal and authorization-audit histories remain `[8,10]`, exactly one closure Audit and one closure Outbox record remain, and the historical revision-8 authorization hash cannot change. The cluster system identifier must remain stable while the postmaster start time must change. |
| Receipt boundary | Receipt `ros-brain.local-postgres-journey-receipt.v33` is withheld unless the terminal state is complete before restart, identical afterward, and bound into the continuous restart provenance chain. The receipt records both states and both postmaster start times; `externalArchiveReceipt` remains null. |
| Local evidence | Shell syntax checks and the focused PostgreSQL harness contract passed 40 of 40. The full workspace passed 666 API, 35 dashboard, 36 mobile, and 8 domain tests (745 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The live journey exited 127 before execution because neither Docker nor Podman is installed; therefore no PostgreSQL `v33` receipt or live restart result is claimed. |
| Safety limits | This is a fail-closed journey and receipt contract over disposable data, not live-engine or operational evidence. It grants no collection, severity reduction, dispatch, provider call, activation, or autonomous closure; `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **THE V33 RECEIPT IS NOW BLOCKED UNLESS THE CLOSED REVISION-11 INCIDENT REMAINS TERMINAL, ITS CONSUMED AUTHORIZATION REMAINS WITHHELD, AND ITS SINGLE AUDIT/OUTBOX WRITES AND `[8,10]` HISTORY SURVIVE A DISTINCT POSTGRESQL RESTART EXACTLY.** |
| Next handoff | Run the clean `v33` journey on Docker or Podman and fix the first actual SQL, transaction, terminal-state, restart, or receipt discrepancy before accepting the receipt. |

### Terminal incident controls in the authenticated dashboard

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `9c556bc94640f752c6ad6e9574f2c0b7cfba3a26` was ninety-seven commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind, with no branch PR, workflow run, dirty starting worktree, or overlapping test process. Both delivery documents remained present and the approved cadence remained hourly. |
| Added behavior | A terminal RoadEvent (`CLOSED`, `FALSE_POSITIVE`, or `DUPLICATE`) remains visible in the operations dashboard, but the controller now disables every transition and closure-authorization capability. Direct method invocation fails locally before the authenticated HTTP gateway can emit a request. |
| Operator presentation | A closed incident explicitly renders `تم استهلاك التفويض — الحالة مغلقة نهائيًا`; the transition selector and closure-authorization form are disabled. A retained authorization in an immediate closure response cannot make the terminal state actionable again. |
| Local evidence | The focused operations-dashboard suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey still exits 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | This is a browser/controller fail-closed boundary. It does not reopen or mutate an incident, call an external service, dispatch, activate, or grant authority. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A TERMINAL INCIDENT CAN STILL BE REVIEWED, BUT IT CANNOT EMIT A NEW TRANSITION OR CLOSURE-AUTHORIZATION REQUEST FROM THE OPERATIONS DASHBOARD.** |
| Next handoff | Prove the same zero-request behavior after an explicit authenticated refresh returns the durable closed revision with `closureAuthorization=null`, preserving the visible audit timeline. |

### Durable terminal refresh in the authenticated dashboard

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `e1c66cfe916b172bdf53cf44945649fe8c6280e7` was ninety-eight commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process or candidate workflow run existed. The repository had unrelated open pull requests, but this review branch had no pull request. |
| Added behavior | The authenticated browser journey now performs an explicit list/detail/timeline refresh after closure, reads the durable `CLOSED` revision with `closureAuthorization=null`, and keeps both the authorization and closure audit entries visible. |
| Fail-closed acceptance | The refreshed terminal incident must disable transition and closure-authorization capabilities. Direct attempts to reopen or reauthorize must fail locally and add zero HTTP requests after the refresh boundary. |
| Local evidence | The focused operations-dashboard suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey still cannot execute without Docker or Podman, so no live `v33` receipt is claimed. |
| Safety limits | This is a browser/controller proof over an authenticated test gateway. It grants no reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **AN EXPLICIT AUTHENTICATED REFRESH PRESERVES THE CLOSED INCIDENT AND ITS AUDIT TIMELINE WHILE EMITTING ZERO NEW MUTATION REQUESTS.** |
| Next handoff | Prove the same durable terminal state is preserved when the operator changes selection away from the closed incident and returns to it, without restoring any critical control. |

### Terminal selection round trip in the authenticated dashboard

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `7c09ad28ea26e49e4862ce5f6a39f50480f1a2d8` was ninety-nine commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. |
| Added behavior | The authenticated operator journey now leaves the durable closed incident, selects a separate active incident, and returns through fresh detail and timeline reads. The returned incident remains `CLOSED` with `closureAuthorization=null` and retains both historical audit entries. |
| Fail-closed acceptance | The active incident may expose its ordinary transition capability, but returning to the closed incident must disable transition and closure authorization again. Direct reopen and reauthorization attempts must add zero HTTP requests after the return boundary. |
| Local evidence | The focused operations-dashboard suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey still cannot execute without Docker or Podman, so no live `v33` receipt is claimed. |
| Safety limits | This is a selection-state isolation proof over an authenticated test gateway. It grants no reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **SWITCHING TO AN ACTIVE INCIDENT CANNOT LEAK ITS CONTROLS INTO A DURABLE CLOSED INCIDENT WHEN THE OPERATOR RETURNS.** |
| Next handoff | Prove the same isolation when a stale active incident fails to load while the previously viewed closed incident remains fail-closed and cannot inherit stale controls or timeline data. |

### Failed incident selection clears prior critical context

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `30774b660fe4660b4ca1c4310e8a0ab1aef4f4bd` was one hundred commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. |
| Added behavior | If authenticated detail or timeline loading fails while changing incidents, the dashboard now clears the previous selected incident and its timeline, marks the state stale and failed, and renders no critical detail context until a fresh selection succeeds. |
| Fail-closed acceptance | The prior closed incident's audit entries must disappear from the failed-selection detail view. Transition and closure-authorization capabilities remain false, direct invocation fails before the gateway, and the internal dependency error remains sanitized. |
| Local evidence | The focused operations-dashboard suite passed 36 of 36 after correcting one expected-path fixture error found by the first run. The full workspace then passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey still cannot execute without Docker or Podman, so no live `v33` receipt is claimed. |
| Safety limits | This is a read-failure isolation boundary. It grants no mutation, reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A FAILED INCIDENT SELECTION CAN NO LONGER RETAIN OR MISATTRIBUTE THE PREVIOUS INCIDENT'S CRITICAL DETAIL OR AUDIT TIMELINE.** |
| Next handoff | Add an explicit retry path that can recover from the cleared failure state only through fresh authenticated detail and timeline reads, with controls derived solely from the recovered incident. |

### Explicit authenticated incident-selection retry

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `2777511f33d0d0f36fa337dc32d921e368d382ef` was one hundred and one commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | A failed authenticated incident selection now exposes one explicit retry control bound to that failed incident. Retry performs fresh detail and timeline reads; success clears stale/failure state and derives every control from the newly read incident. A queue reload or successful selection clears retry eligibility. |
| Fail-closed acceptance | Failure retains no selected incident or prior timeline and exposes no critical control. Recovery must add exactly two authenticated GET requests, restore only the selected active incident with its own empty timeline and withheld closure authorization, remove the retry control, and reject a second retry before network access. |
| Local evidence | The focused operations-dashboard build and suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | Retry is read-only and carries the existing authenticated Tenant + Purpose scope. It grants no mutation, reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A CLEARED SELECTION FAILURE CAN RECOVER ONLY THROUGH FRESH AUTHENTICATED DETAIL AND TIMELINE READS, WITHOUT REUSING THE PRIOR INCIDENT'S CONTROLS OR AUDIT DATA.** |
| Next handoff | Prove that a failed retry remains cleared and fail-closed, then that a later explicit retry can recover through another fresh read pair without duplicating or restoring stale context. |

### Repeated authenticated retry remains fail-closed

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `750ffd602b9bbaf4d21f70102952d6b9060305fc` was one hundred and two commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added evidence | The authenticated operator journey now exercises a failed explicit retry before recovery. That retry adds exactly one fresh detail/timeline read pair, retains `failure/stale`, keeps selection and timeline empty, keeps all critical controls disabled, preserves sanitized error presentation, and leaves retry available for a later explicit attempt. |
| Recovery acceptance | Only after the dependency recovers does another explicit retry add a second fresh read pair and restore the intended active incident. Its empty timeline and withheld closure authorization are used; no audit entry or control from the previously viewed closed incident returns. A further retry is rejected locally with zero network traffic. |
| Local evidence | The focused operations-dashboard build and suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | Both retry attempts are authenticated read-only operations under the existing Tenant + Purpose scope. They grant no mutation, reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A FAILED RETRY CANNOT REVIVE STALE CONTEXT; A LATER RECOVERY REQUIRES ANOTHER COMPLETE AUTHENTICATED READ PAIR.** |
| Next handoff | Make incident-selection retry single-flight so rapid duplicate operator actions cannot create overlapping read pairs or race the recovered dashboard state. |

### Single-flight authenticated incident-selection retry

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `d8213a3560079e97c59bb7a1b2a05b7492104de4` was one hundred and three commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | Concurrent explicit retries for the same failed incident selection now share one in-flight promise. The controller issues only one authenticated detail/timeline read pair and delivers the same recovered state to every duplicate caller; the guard clears when that attempt settles. |
| Fail-closed acceptance | Two concurrent retry calls must return the same promise and add exactly two GET requests rather than four. Recovery must contain only the newly read incident and its timeline, remove retry eligibility, and reject a later retry locally without network traffic. |
| Local evidence | The focused operations-dashboard build and suite passed 36 of 36. The full workspace passed 666 API, 36 dashboard, 36 mobile, and 8 domain tests (746 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | Retry remains an authenticated read-only operation under the existing Tenant + Purpose scope. It grants no mutation, reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous action. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **RAPID DUPLICATE RETRY ACTIONS ARE COALESCED INTO ONE AUTHENTICATED READ PAIR AND CANNOT RACE EACH OTHER INTO THE RECOVERED DASHBOARD STATE.** |
| Next handoff | Prevent an in-flight retry from overwriting a newer explicit operator selection or queue reload by binding completion to the latest selection intent. |

### Latest authenticated read intent wins

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `c959c5682c65d6038cea7725bc8512365550d5af` was one hundred and four commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | Every authenticated queue load or incident selection now advances a controller-owned read intent. A slower earlier retry may finish its network reads, but it cannot replace the state produced by a newer explicit incident selection or queue reload. |
| Race acceptance | A delayed retry followed by another incident selection must return the newer incident state and leave it selected. A delayed retry followed by a queue reload must leave the refreshed queue with no selected incident. Both stale completions must be ignored without restoring retry eligibility or prior timeline data. |
| Local evidence | The focused operations-dashboard build and suite passed 37 of 37, including authenticated delayed-response coverage for selection and reload supersession. The full workspace passed 666 API, 37 dashboard, 36 mobile, and 8 domain tests (747 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | The intent token controls only which authenticated read result may update browser state. It does not cancel transport, mutate incidents, reopen state, collect data, reduce severity, dispatch, activate, call providers, or grant autonomous authority. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A STALE RETRY RESULT CAN NO LONGER OVERWRITE A NEWER OPERATOR SELECTION OR QUEUE RELOAD.** |
| Next handoff | Bind delayed closure-authorization and transition follow-up results to the initiating incident intent so a critical completion cannot overwrite a newer operator selection. |

### Critical completion remains bound to its initiating incident

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `00ac342dc9b02a02883acd2f70c33852c01218a2` was one hundred and five commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | Closure authorization and RoadEvent transition now retain the authenticated read intent from which the operator initiated them. If the operator selects another incident before the response arrives, the completed mutation cannot replace that newer selection, fetch an obsolete follow-up timeline, or mark the newer view stale. |
| Race acceptance | A delayed closure authorization followed by a newer selection must leave the newer incident selected and emit no post-completion timeline read for the old incident. After a fresh read exposes the exact authorization revision, a delayed closure transition must obey the same rule. The remote request is not misrepresented as cancelled; only its obsolete browser-state projection is discarded. |
| Local evidence | The focused operations-dashboard build and suite passed 38 of 38. The authenticated journey proved both delayed authorization and delayed closure transition while moving to a newer incident. The full workspace passed 666 API, 38 dashboard, 36 mobile, and 8 domain tests (748 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | The intent binding does not revoke or cancel a mutation already accepted by the API. It prevents only stale browser-state projection; the durable API and append-only audit remain authoritative and require a fresh authenticated read when the operator returns. It grants no reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous authority. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A DELAYED CRITICAL COMPLETION CAN NO LONGER OVERWRITE OR STALE A NEWER INCIDENT VIEW.** |
| Next handoff | Prove that a delayed critical failure after the operator changes selection leaves the newer view healthy and reports the failure as belonging only to the originating incident. |

### Superseded critical failure remains incident-scoped

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `f92f4252ae7b1411557f746150b245b0b7d7975a` was one hundred and six commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | If a closure-authorization or transition request fails after the operator has selected another incident, the controller now raises a sanitized incident-scoped failure carrying the originating incident ID and action type. It does not copy the old request's stale or error state into the newer incident view. |
| Fail-closed acceptance | The delayed failure message must name only the initiating incident and action, omit the server's internal detail, and require reopening the originating incident to verify its outcome. The newer incident must remain selected, non-stale, error-free, and governed solely by its own controls. |
| Local evidence | The focused operations-dashboard build and suite passed 39 of 39. The authenticated HTTP journey delayed an authorization failure until after a newer incident was selected and verified incident attribution, sanitization, and healthy newer-state isolation. The full workspace passed 666 API, 39 dashboard, 36 mobile, and 8 domain tests (749 total), plus 32 perception, benchmark, certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | This browser error type does not infer whether an ambiguous remote mutation committed. It grants no retry, reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous authority; a fresh authenticated read remains required. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **A FAILURE FROM AN ABANDONED INCIDENT VIEW CAN NO LONGER STALE OR MISLABEL THE INCIDENT THE OPERATOR IS CURRENTLY REVIEWING.** |
| Next handoff | Make each critical dashboard action single-flight so repeated confirmation or rapid submission cannot emit duplicate mutation requests with distinct idempotency keys. |

### Critical dashboard mutations are single-flight

| Field | Current record |
|---|---|
| Resume point | On 2026-09-21, GitHub candidate `e3ab805015af574d8f9ef6aecaf1cd9bdc37af09` was one hundred and seven commits ahead of current `main` at `3255a94a7f78607014a410e083174483fa2c2c2f` and zero behind. Its tree matched the clean local candidate, both delivery documents remained present, and no overlapping test process, branch pull request, or candidate workflow run existed. The approved cadence remains hourly. |
| Added behavior | Each closure authorization or RoadEvent transition is now one controller-scoped flight through mutation and authenticated Timeline refresh. Repeated confirmation of the exact incident, version, action, and normalized reason joins the existing result and emits no second HTTP mutation. A different critical command arriving during that flight is rejected locally before HTTP and instructs the operator to wait and refresh. |
| Concurrency acceptance | Concurrent duplicate authorization and closure calls must each emit exactly one authenticated mutation and one follow-up Timeline read. A competing reason or transition during either flight must fail locally. The guard must release only after the shared result settles, without changing server authority, version checks, or terminal-state rules. |
| Local evidence | The focused operations-dashboard build and suite passed 40 of 40 after correcting one test-only Timeline count discovered by the first run. The full workspace passed 666 API, 40 dashboard, 36 mobile, and 8 domain tests (750 total), plus 32 perception, benchmark, adapter-certification, and epistemic-coverage contract checks. Build, no-emit TypeScript, repository/runtime composition, retention, negative-gate, archive conditional-write, and eight external-evidence policy checks passed. The PostgreSQL journey exited 127 before execution because neither Docker nor Podman is installed; no live `v33` receipt is claimed. |
| Safety limits | Single-flight is an in-memory browser control, not durable idempotency across reloads or a claim that an ambiguous remote mutation did not commit. It grants no reopening, collection, severity reduction, dispatch, activation, provider call, or autonomous authority. `RECOMMENDATION_ONLY`, `SHADOW_ONLY`, and `activationAuthorized=false` remain unchanged. Local evidence does not satisfy REL-013 external immutable archival. |
| Result | **RAPID OR REPEATED CRITICAL CONFIRMATION CAN NO LONGER CREATE MULTIPLE MUTATION REQUESTS IN ONE DASHBOARD FLIGHT.** |
| Next handoff | Bind a stable client operation identity to an exact critical command so an explicitly governed retry after an ambiguous transport outcome can reuse its idempotency key instead of creating a second logical mutation. |

## Hourly report and definition of done

The report must stand alone and lead with observable progress. Use this compact record:

| Field | What to record |
|---|---|
| Date and cycle | Actual execution date, active outcome, and carry-over if any. |
| Candidate | Baseline plus current candidate SHA or an explicit uncommitted working-diff identity. |
| Delivered behavior | What a caller/operator can now do or observe, with the changed seam. |
| Evidence | Exact checks run, exit status, material results, and artifact/test locations. |
| Result | Confirmed, partial, unverified, or failed for each acceptance criterion. |
| Remaining gap | Concrete unresolved dependency, risk, or failing requirement; no generic "all complete" claim. |
| Cost and environment | Resources actually used and any proposed next environment step; do not infer cloud activity. |
| Rollback/forward-fix | Safest reversible response without deleting incident, evidence, or audit history; owner Mohamed Qahtan. |
| Next objective | The single next dependency-ordered outcome and its acceptance condition. |

A local cycle is done when its behavior is implemented, acceptance is directly evidenced on the combined candidate, the diff is reviewed, limitations are explicit, and the next handoff is ready. Documentation alone cannot close an implementation objective. Tests of the planner alone cannot close API/dashboard integration.

The founder's **2026-09-08** instruction replaces the prior 09:00 daily cadence with one continuation cycle every hour. A scheduled run must locate the current branch/main state, continue any unfinished safety-relevant work first, and report only actions actually performed. If its available tools cannot edit, test, or persist code, it records that limitation rather than claiming a completed build. A successful schedule update does not prove a future execution has happened.

## Quality, evidence, and scope gates

- Preserve the accepted [Modular Monolith architecture](../02-architecture/adr/ADR-001-modular-monolith.md) and existing [Human Safety lifecycle/authority policy](../10-human-safety/lifecycle-and-authority.md).
- Follow [operational release gates](../09-reliability/operational-readiness-and-release-gates.md) for release acceptance. Hourly progress never bypasses protected-branch reviews, mandatory checks, or candidate/base/tested-merge evidence binding.
- REL-013 still requires the approved external immutable archive with effective retention of at least 365 days and independently verified encryption, integrity, object version, and receipt provenance. Its availability after AWS deletion is unverified; a release stays blocked until the requirement is satisfied. A different archive implementation would require a reviewed governance change, not an implicit substitution in a daily task.
- Preserve [pilot hard-stop criteria](../07-pilot/kpi-stop-criteria.md) and the [shadow/rollback protocol](../07-pilot/shadow-canary-rollback.md). Numeric performance targets require their existing baseline and approval process.
- There is no automatic permission escalation from recommendation to execution. No day in this plan authorizes cloud spend/apply/deploy, government dispatch, public-road intervention, production-camera access, or vehicle control.
- When a mandatory gate is unavailable, continue useful authorized engineering with an explicit partial status. Do not fabricate a pass, weaken the gate, or recreate paid infrastructure to force a result.
