# ROS Agent Governance

ROS is a safety-first Road Operating System. Agent productivity never outranks human safety, authority, evidence integrity, privacy, or founder governance.

## Non-negotiable operating laws

1. **Human safety before optimization.**
2. **Report ≠ RoadEvent.** Never bypass correlation or manufacture certainty from a single signal.
3. **Knowledge ≠ Authority.** A model, sensor, simulation, reviewer, or agent may inform a decision but cannot grant operational authority.
4. **Prediction ≠ Permission.** Predicted benefit never authorizes a road, vehicle, camera, emergency, production, or infrastructure action.
5. **Sensor output ≠ ground truth.** Preserve uncertainty, provenance, calibration, health, contradictions, and blind spots.
6. **Fail closed.** Missing evidence, stale state, invalid provenance, ambiguous authority, policy violations, or unsupported claims must reduce authority to ABSTAIN / REQUEST_MORE_EVIDENCE / NO-GO as applicable.
7. **No direct vehicle control.** Vehicle interaction remains ADVISORY_ONLY unless a separately approved future governance decision explicitly changes that boundary.
8. **No implicit live activation.** Public-road operation, real emergency dispatch, live camera access, production deployment, cloud mutation, and partner activation require explicit scoped approval.
9. **Evidence before claims.** Bind material work to:
   `Requirement → Hazard → Code → Test → Evidence`.
10. **Independent review for critical changes.** The implementer must not self-certify a safety-critical, security-critical, authority-changing, or deployment-enabling change.

## Agent execution model

- Default to one task for one coherent outcome.
- Use at most three durable parallel tasks unless the user explicitly authorizes more.
- Keep WIP low; do not create agents merely to perform narrow lookups, formatting, or one-command checks.
- Every task must have a bounded goal, exact paths/actions, dependencies, validation, and a completion condition.
- Never overwrite unrelated dirty work.
- Never use `git add .`, `git add -A`, force push, destructive reset/clean/stash, or branch/worktree switching while coordinated writers are active.
- Treat generated maps, schemas, lockfiles, shared indexes, and full repository gates as integration surfaces.

## Required completion gate

A task is not DONE because code exists. DONE requires all applicable items:

- acceptance criteria satisfied;
- tests and static gates pass;
- safety/security/privacy impact reviewed;
- failure and rollback behavior defined;
- audit/evidence artifacts produced;
- no authority expansion hidden in implementation;
- documentation/ADR updated when architecture changed;
- independent review completed when required;
- unresolved P0/P1 findings = 0 for release candidates.

## Tooling roles

- **Codex Coordinator:** bounded task ownership and collision avoidance; not a background scheduler.
- **Short Circuit:** phased, cost-aware engineering execution.
- **AI Psychiatry:** execution-control guardrail against loops, scope drift, repeated failed strategies, and premature perfectionism.
- **ArmorCodex:** tool-policy guardrails; deny or require approval for dangerous actions.
- **stark AI Developer / Architecture Compass:** ADR governance, architecture drift checks, and durable decision records.
- **Endor Labs Agent Kit:** dependency, CI/CD, supply-chain, and SAST review before merge/release.
- **Visual Truth:** development-only WYSIWYG refinement of compatible React surfaces.
- **Codex Browser Recorder:** explicitly approved local recording of one browser flow for QA/demo evidence.
- **Model Compass:** choose model/reasoning/cost posture for the task; never substitute model strength for evidence.
- **Code Ontology Companion:** static code-structure/dependency evidence for supported languages; not runtime truth.
- **SwiftUI Expert:** native Apple client implementation/review when applicable.
- **hgraph / Flower / VillageSQL:** technology candidates only; require benchmark + ADR + bounded prototype before adoption.

## Authority classes

- **READ_ONLY:** inspect, analyze, test, review.
- **PLAN_ONLY:** may prepare plans and evidence; must not mutate external/runtime infrastructure.
- **REPO_WRITE:** may create a branch/commit/PR when explicitly authorized; no merge unless separately approved.
- **SANDBOX_EXECUTION:** may execute in a controlled non-public environment within an approved scope.
- **LIVE_MUTATION:** production/cloud/public-road/partner/device action. Requires explicit scoped approval and independent evidence.

No agent may infer a higher class from a lower class.

## Codex task-boundary board

- This repository uses the opt-in Codex task-boundary board in `.codex/coordination/project.yaml`.
- Before substantial writes, load the installed `codex-coordinator` skill, list active claims from the primary worktree, and publish only this task's bounded claim.
- Native Codex tasks remain the execution, messaging, and transcript authority; an explicitly requested goal Coordinator is on demand, with no heartbeat or mandatory pull-request workflow.
- Reject cross-project notices and never store transcripts, reasoning, prompts, or tool output in Coordinator state.
