# ROS Whole-Body Gap Matrix

Status vocabulary: `BUILT`, `PARTIAL`, `SHADOW_ONLY`, `MISSING`, `BLOCKED_EXTERNAL`, `DEPRECATED`.

Baseline inspected: `main@3255a94a7f78607014a410e083174483fa2c2c2f`.
Executive branch baseline: `agent/whole-body-executive-builder@4ef7147343c7dc69ab5e30f9cdb32e90f97bd504`.

This matrix is an integration control artifact, not a readiness claim. A component is not promoted to BUILT solely because research code or documentation exists; executable integration, tests, telemetry, failure behavior, and evidence are required.

| Organ / subsystem | Current classification | Existing track / evidence | Whole-body exit gate |
|---|---|---|---|
| DNA / Constitution | PARTIAL | #181 invariants; existing requirements/hazard/governance docs | Machine-check critical invariants + requirement→hazard→code→test→evidence links |
| Skeleton / canonical contracts | PARTIAL | Core models/APIs exist | Freeze P0 cross-organ contracts and versioning |
| Skin / zero-trust ingress | PARTIAL | OIDC/MFA/JWT/ABAC baseline exists | Runtime server-side tenant/purpose enforcement + negative tests |
| Senses | PARTIAL | ROS Eye, reports, sensor-agnostic work | At least one canonical reference adapter exercised end-to-end |
| Sensory neurons / adapters | PARTIAL | #166/#165 sensor-agnostic track | Adapter certification V1 + health/calibration/lineage/failure isolation evidence |
| Nervous system | BUILT | Durable PostgreSQL/Redis/Outbox runtime and resilience harness are already present on current main; historical exact-head evidence from #82/#91/#92 is ancestral to main | Re-run the bounded resilience proof on the final Whole-Body candidate SHA and bind artifact hashes |
| Synapses / events | PARTIAL | Existing event contracts | Versioned canonical envelope with purpose/jurisdiction/freshness/trace/provenance |
| Spinal safety reflex | PARTIAL | Safety gates/fail-closed behavior exist | Deterministic bounded reflex tests independent of deep cognition |
| CPAL / EIL | PARTIAL | CPAL/EIL adversarial research exists | Integrated runtime path + independence/replay/contradiction tests |
| CRS working memory | PARTIAL | #167 CRS track | Versioned current-state store + freshness/uncertainty/expiry integrated |
| Brain | SHADOW_ONLY | Cognitive Brain research track | Only independently gated modules may enter decision-support path |
| Cerebellum / coordination | PARTIAL | Planning/4D/counterfactual concepts | Heart-approved advisory sequencing; no authority bypass |
| Brainstem / homeostasis | PARTIAL | Health/degraded/self-model concepts | Dependency health + degraded/safe mode tests |
| Heart | PARTIAL | Human Safety / authority gates exist | Machine-testable veto over Brain/planner/vendor outputs |
| Trusted circulation | PARTIAL | Events/features/evidence refs architecture | No raw high-volume streams in transactional core; bounded flow proven |
| RCINS / RCIS immunity | PARTIAL | Immune tracks and war-game research | Whole-body containment; compromise can only reduce authority |
| Liver / data detox | PARTIAL | Validation/quarantine patterns | Explicit sanitize/classify/quarantine boundary with negative tests |
| Kidneys / privacy-retention | PARTIAL | Purpose/privacy/evidence controls | TTL/minimization/expiry/legal-hold/deletion policy tests |
| Endocrine / policy | PARTIAL | Mission/policy/feature-gate concepts | Versioned immutable-per-decision policy snapshot |
| Muscles / action layer | PARTIAL | Notifications/ops/advisory paths | Heart-approved advisory outputs only; auditable effect requests |
| Authorized effectors | BLOCKED_EXTERNAL | External operators/vehicles/agencies | Controlled mocks/sandbox only until separate authority |
| Mobile Safety Companion | PARTIAL | User app baseline | Critical controlled E2E flow + accessibility/RTL/device evidence |
| Operations dashboard | PARTIAL | Ops dashboard baseline | RoadEvent/evidence/human-review/decision/audit controlled E2E |
| Evidence / audit memory | PARTIAL | Evidence/WORM/audit baseline | Durable evidence chain + replay/idempotency + integrity verification |
| Whole-body E2E | MISSING | Components exist separately | Deterministic sensor/report→RoadEvent→evidence→Heart→human review→advisory→notification→audit scenario |
| Local runnable package | PARTIAL | Existing container/runtime assets | One documented command path + health checks + deterministic scenario |
| HA/DR / recovery | PARTIAL | Runtime track | restart, DB/Redis interruption, rollback and degraded-mode evidence |
| Independent review | MISSING | Required by #181/#182 | Separate reviewer evidence for safety/security/authority-critical gates |

## Critical path

1. Freeze P0 canonical contracts and organ dependency graph.
2. Re-prove the already-integrated durable nervous-system path on the final Whole-Body candidate SHA; do not rebuild it.
3. Integrate evidence assurance: Adapter → CPAL/EIL → CRS.
4. Integrate Heart as mandatory veto between cognition/planning and every action output.
5. Integrate RCINS/RCIS whole-body containment.
6. Build deterministic controlled E2E scenario through Mobile + Operations + Evidence/Audit.
7. Exercise restart, replay, dependency loss, network partition, compromise, and rollback.
8. Freeze candidate SHA and submit evidence to independent review.

## Current highest-value engineering gate

**Extend the proven runtime substrate through Evidence Assurance → CPAL/EIL → CRS → Heart → Operations/Audit, then prove that full cross-organ path on one candidate SHA.**

Reconciliation finding: PR #92 head `ce098ef16af4cc901fe9744bcaf14a456111e6fb` is not a divergent stack that still needs replay onto main. Git compare shows it is an ancestor of current `main@3255a94a7f78607014a410e083174483fa2c2c2f` (`ahead_by=0`, `behind_by=277`, merge base equals #92 head). PR #82 was merged, and the runtime-resilience implementation files are present on current main. Therefore the previous `#82 → #91 → #92 → current main` reconciliation framing was stale. Historical green evidence remains bounded to its tested SHA and must not be treated as final-candidate proof; the final Whole-Body SHA still requires fresh reproducible runtime evidence.

The critical engineering work is now cross-organ integration above that substrate. Brain research remains SHADOW_ONLY until this path and independent gates are proven.

## Safety boundary

This artifact grants no authority for production, public-road operation, emergency dispatch, live camera access, signal actuation, direct vehicle actuation, cloud provisioning, online self-modification, or automatic restoration of revoked authority.
