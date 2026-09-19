# ROS Engineering Control Plane v1.0

## Purpose

The Engineering Control Plane is the governance layer around ROS development. It improves speed without trading away safety, evidence quality, architecture coherence, or founder control.

It does **not** become part of the road runtime and does **not** grant operational authority.

## Control loop

```text
Founder / Authorized Goal
        ↓
Architecture + Authority Classification
        ↓
Task Decomposition (WIP ≤ 3)
        ↓
Implementation Agents
        ↓
Execution-Control Guardrails
        ↓
Tool Policy Guardrails
        ↓
Tests + Security + Supply-Chain Gates
        ↓
Evidence Package
        ↓
Independent Review
        ↓
Founder / Authorized Merge or Activation Gate
```

## Mandatory gates

### G0 — Intent and authority
Record:
- requested outcome;
- allowed environment;
- allowed mutations;
- forbidden actions;
- exact approval boundary.

### G1 — Architecture
Determine whether the change:
- follows existing architecture;
- requires an ADR;
- introduces a new dependency/runtime/language;
- affects Heart, Brain, evidence, identity, authority, privacy, or safety.

No new framework enters ROS core because it is interesting. New technology follows:
`Benchmark → ADR → Prototype → Compare → Adopt/Reject`.

### G2 — Hazard and abuse analysis
For material changes, record:
- failure modes;
- unsafe authority expansion;
- stale/forged/replayed evidence risks;
- prompt/tool abuse risk;
- privacy/data-minimization risk;
- rollback/fail-closed behavior.

### G3 — Implementation
Keep tasks bounded and composable. Default WIP = 1; maximum durable parallel WIP = 3 without explicit override.

### G4 — Verification
Applicable verification includes:
- unit/integration/E2E tests;
- lint/typecheck/build;
- deterministic safety invariants;
- dependency/SAST/CI posture;
- architecture-drift review;
- evidence integrity.

### G5 — Evidence
Every release-significant assertion needs inspectable evidence. Prefer exact candidate SHA binding.

Minimum evidence tuple:
```text
Requirement
Hazard / abuse case
Code or configuration change
Test / verification
Evidence artifact
Reviewer / decision
```

### G6 — Independent review
Required for:
- safety-critical logic;
- authority or trust-boundary changes;
- security/identity/privacy changes;
- deployment/infrastructure enablement;
- evidence verifier changes;
- new runtime/framework adoption.

### G7 — Merge / activation
Passing engineering gates means **engineering-ready**, not automatically merge-ready, deployment-ready, or public-road-ready.

Separate decisions:
- merge authorization;
- sandbox activation;
- external integration;
- staging deployment;
- production deployment;
- public-road authority.

## Runtime safety invariants

These invariants must remain explicit in code and tests:

- `directVehicleControl = false`;
- permitted vehicle output remains `ADVISORY_ONLY`;
- an unsafe/forged/contradictory candidate may force `ABSTAIN`;
- missing decision-critical visibility may force `REQUEST_MORE_EVIDENCE`;
- no model or adapter can self-authorize activation;
- certification does not equal activation;
- simulation evidence does not equal field evidence;
- non-detection never silently becomes proof of safe emptiness.

## Agent/tool placement

| Layer | Primary tools | Purpose |
|---|---|---|
| Coordination | Codex Coordinator | bounded ownership, WIP, collision avoidance |
| Execution discipline | Short Circuit, AI Psychiatry | phased work, stop conditions, anti-loop controls |
| Tool authority | ArmorCodex | deny/approval rules around risky actions |
| Architecture | Architecture Compass | ADRs, drift, architectural lineage |
| Software security | Endor Labs Agent Kit | dependency/SAST/CI-CD posture |
| UI evidence | Visual Truth, Browser Recorder | development UI refinement and explicit QA/demo recording |
| Model economics | Model Compass | model/reasoning/cost selection |
| Specialized engineering | SwiftUI Expert, Code Ontology, hgraph | only where the technical domain warrants it |

## Technology adoption rule

The following are **not baseline ROS dependencies**: hgraph, Flower, VillageSQL, GulfPulse News Images, Vera, Dyslex.ai.

They may be evaluated only when a bounded ROS need exists and the evaluation can prove measurable benefit without increasing safety or operational risk.

## Definition of Done

A change may be marked engineering-complete only when:
1. scope and authority are explicit;
2. acceptance criteria are met;
3. applicable tests/gates pass;
4. hazard/security/privacy impacts are addressed;
5. rollback/fail-closed path exists;
6. evidence is bound to the exact candidate;
7. architecture documentation is current;
8. independent review is complete where required;
9. no unresolved critical finding is hidden;
10. the result does not overstate simulation, certification, or readiness.

## Current adoption boundary

This control plane may govern repository engineering immediately.

It does not authorize:
- AWS or other cloud mutations;
- Terraform apply/destroy;
- production deployment;
- public-road activation;
- live partner credentials;
- live camera or device access;
- emergency dispatch;
- traffic-signal actuation;
- direct vehicle control.
