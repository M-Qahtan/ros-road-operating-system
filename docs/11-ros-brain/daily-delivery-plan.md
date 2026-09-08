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
| Invalidation behavior | A revision change, content correction with the same revision but a different digest, contact creation/removal, scope drift, source mismatch, or invalid chronology prevents `VERIFIED`. Missing or malformed receipts remain `UNVERIFIED`. |
| Ownership boundary | Source modules still own their revisions and canonical digests. The contract verifies receipts but does not mint them, read new data, mutate a case, or grant authority. |
| Fresh local evidence | Relevant TypeScript builds and no-emit checks passed; 4/4 new RoadEvent ledger adapter tests, 18/18 focused snapshot/ledger tests, and 540/540 workspace tests passed. Repository/composition/retention/negative gates passed, including 8/8 external-evidence logic tests. |
| Result | **PARTIAL CYCLE 2 ROAD EVENT SOURCE LEDGER VERIFIED.** Schema and read adapter are implemented, but the migration was not executed on a live PostgreSQL engine and existing RoadEvent mutation transactions do not yet append ledger receipts. No recommendation persistence, CI/archive receipt, merge, deployment, or field readiness was established. |
| Next handoff | Make RoadEvent create and severity-reassessment transactions append canonical `CASE` and `SEVERITY` receipts atomically, including correction and rollback tests. |

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
