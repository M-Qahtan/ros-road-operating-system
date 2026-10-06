# ROS Universal Adaptive Interface System — UAIS v1.0

**Status:** Architecture & Product Baseline  
**Workstream:** Issue #186  
**Branch:** `feat/universal-adaptive-interface-v1`  
**Scope:** Mobile, Tablet, Web, Desktop, Wall Display, Vehicle Display  
**Safety posture:** Simulation / Advisory only; no direct actuation

## 1. Executive Principle

> **One ROS Experience, Many Surfaces.**

ROS SHALL look, behave, and communicate like one coherent operating system across every supported display. Consistency does **not** mean pixel-identical screens. It means identical semantics, hierarchy, state meaning, trust language, and interaction logic, adapted to each physical context.

The same RoadEvent on five surfaces MUST remain the same event. Evidence, confidence, freshness, authority, purpose, uncertainty, and safety state MUST not change meaning because the screen changed.

## 2. Experience Invariants

Every ROS surface SHALL preserve these invariants:

1. **Human Safety First** — safety and emergency access rank above speed, density, throughput, or aesthetics.
2. **Calm Intelligence** — intelligence is demonstrated by reducing cognitive work, not by adding widgets.
3. **Progressive Disclosure** — start with the minimum decision-relevant information; reveal depth on demand.
4. **Evidence-Bound Interaction** — important recommendations expose source, confidence, freshness, reason, and uncertainty.
5. **Uncertainty is First-Class** — `ABSTAIN`, `REQUEST_MORE_EVIDENCE`, and `HUMAN_REVIEW` are mature outcomes, not UI errors.
6. **Brand Color != Safety State Color** — ROS identity remains stable while operational state colors communicate meaning.
7. **Graceful Degradation** — offline, stale, partially observable, degraded, and contained states are designed states.
8. **No Silent Authority Expansion** — a richer screen never grants more authority.
9. **RTL-First, Bidirectional by Architecture** — Arabic RTL is primary; English LTR and Urdu RTL are structural targets.
10. **Accessible by Default** — WCAG 2.2 AA baseline for non-vehicle surfaces; vehicle HMI receives a stricter driver-safe profile.

## 3. Supported Surface Profiles

### 3.1 HANDHELD
Primary roles: road user, field reporter, safety companion.

Interaction: touch, voice, limited attention.  
Density: very low.  
Primary objective: one obvious next safe action.

### 3.2 TABLET
Primary roles: field responder, passenger, supervisor in motion but not driving.

Interaction: touch + optional keyboard.  
Density: low-to-medium.  
Primary objective: spatial context, task progression, evidence capture, handoff.

### 3.3 DESKTOP
Primary roles: operator, supervisor, analyst, partner user.

Interaction: keyboard + mouse + shortcuts.  
Density: medium-to-high with progressive disclosure.  
Primary objective: operational awareness, triage, investigation, decision support.

### 3.4 WALL
Primary roles: command room, executive room, presentation, NOC.

Interaction: mostly view-only; control from another device.  
Density: high spatially but low interactionally.  
Primary objective: shared situational awareness, trends, mission state, exceptions.

### 3.5 VEHICLE
Primary role: driver while vehicle is moving; passenger/parked modes may expose additional detail.

Interaction: glance, steering-wheel controls, large touch targets, optional voice.  
Density: minimal while moving.  
Primary objective: safe, glanceable, advisory information.

The vehicle profile SHALL NOT become a miniature operations dashboard.

## 4. Adaptive Composition Model

ROS SHALL use a two-layer adaptation model:

```
Experience Contract
  ├─ semantics
  ├─ states
  ├─ components
  ├─ actions
  ├─ evidence
  └─ accessibility intent
        ↓
Surface Adapter
  ├─ density
  ├─ layout
  ├─ scale
  ├─ input mode
  ├─ distance
  ├─ motion
  └─ allowed actions
```

Adaptation SHALL consider:
- viewport size and aspect ratio;
- user distance from display;
- primary input modality;
- whether the user is driving;
- environmental brightness;
- urgency and severity;
- connectivity and freshness;
- user role and authority;
- language direction;
- accessibility preferences;
- `prefers-reduced-motion`.

Responsive behavior MUST NOT be implemented as breakpoints alone.

## 5. Shared Information Architecture

All surfaces derive from five ROS spaces:

- **ROS / COMPANION** — user safety, trip safety, proactive alerts, Human Safety Session.
- **ROS / OPERATIONS** — RoadEvent truth, priority queue, evidence, responders, missions.
- **ROS / BRAIN** — cognitive state, hypotheses, competing futures, counterfactuals, uncertainty.
- **ROS / HEART** — safety, authority, purpose, privacy, consent, evidence, governance.
- **ROS / IMMUNE** — system health, anomalies, degraded/contained modes, recovery confidence.

Surface profiles select how much of each space is exposed, not whether the underlying meaning changes.

## 6. Universal Component Semantics

The following components SHALL have stable semantics across surfaces:

- `RoadEventCard`
- `SafetyState`
- `EvidenceChip`
- `ConfidenceIndicator`
- `FreshnessBadge`
- `SourceLineage`
- `DecisionCard`
- `HumanReviewGate`
- `MissionStep`
- `MapCallout`
- `SystemHealth`
- `ConnectivityState`
- `StaleDataState`
- `SafeAction`
- `CriticalAlert`

A component may render differently per surface, but the label, meaning, ordering rules, and safety state mapping SHALL remain the same.

## 7. Decision Language

The UI SHALL use the same governed outcomes everywhere:

- **RECOMMEND** — bounded recommendation is supported.
- **ABSTAIN** — ROS intentionally declines to recommend.
- **REQUEST_MORE_EVIDENCE** — decision quality is insufficient; additional evidence is requested.
- **HUMAN_REVIEW** — authorized human decision is required.

These states SHALL be represented as deliberate outcomes, never as generic “error” styling.

## 8. Cross-Surface Continuity

ROS SHALL support continuity of context:

- a RoadEvent opened on desktop can be opened on tablet with the same event state;
- a user alert on mobile maps to the same event identity visible in operations;
- a wall display can show a mission while operator controls remain on desktop;
- a vehicle advisory references the same mission/event but exposes only driver-safe information;
- handoff never transfers authority implicitly.

Future implementation SHOULD use stable deep links or event identifiers, role-aware projections, and server-side authorization.

## 9. Vehicle HMI Profile

### 9.1 Moving Vehicle Mode

When the vehicle is moving:
- maximum one primary message;
- maximum one optional secondary action;
- no dense tables;
- no raw event timeline;
- no evidence graph;
- no scrolling task during critical alerts;
- no configuration flows;
- no multi-step form;
- no operator-only controls;
- minimum visual competition with navigation and OEM safety UI;
- voice is supplementary, never the sole safety channel;
- recommendations remain `ADVISORY_ONLY`;
- vehicle-local safety logic retains final physical veto.

### 9.2 Parked / Passenger Mode

Additional context MAY be exposed only when policy and platform state allow it. Authority does not increase.

### 9.3 Standards Posture

Driver-facing UI SHALL be reviewed against:
- ISO 15005:2017 dialogue-management principles;
- ISO 15008:2017 visual legibility requirements;
- future ISO 15008 Edition 4 only after publication; drafts are tracked but not claimed as compliance targets.

## 10. Wall / Command Display Profile

Wall mode SHALL optimize for recognition from distance:
- larger typography;
- fewer interaction affordances;
- exception-first layout;
- mission and RoadEvent states visible without hover;
- color never as the only state indicator;
- operator actions remain on an authenticated control surface;
- animations are sparse and state-driven.

## 11. Design Language

### 11.1 Brand Core
Master identity remains fixed.

Core brand palette:
- Deep Navy: `#081D33`
- ROS Blue: `#1565FF`
- Sky Signal: `#4DB7FF`
- Neutral: `#A7B0BB`
- Light Neutral: `#E6EAF0`

### 11.2 Visual Motifs
Use restrained:
- Road Flow;
- Cognitive Rings;
- Evidence Nodes;
- Uncertainty Space.

Avoid:
- decorative HUD clutter;
- excessive glassmorphism;
- neon cyberpunk styling;
- motion without semantic purpose;
- dashboards that prioritize KPI quantity over operator decisions.

## 12. Typography and Scale

Typography SHALL use semantic roles rather than fixed sizes:
- Display
- H1/H2/H3
- Body
- Label
- Microcopy
- Numeric Critical
- Driver Glance

Each surface adapter maps roles to an appropriate scale.

Wall and vehicle profiles SHALL use larger physical-size targets than handheld/desktop.

## 13. Motion Grammar

Motion is allowed only to:
- explain state transition;
- preserve spatial continuity;
- direct attention to a new risk;
- confirm a completed action;
- show uncertainty resolution.

Motion SHALL:
- respect `prefers-reduced-motion`;
- never loop decoratively in critical views;
- avoid flashing;
- avoid competing animations;
- remain interruptible by higher severity states.

## 14. Localization and Direction

- Arabic is primary.
- Layout SHALL use logical properties where possible.
- Icons whose meaning depends on direction SHALL mirror deliberately.
- Numeric/technical identifiers MAY remain LTR inside RTL layout.
- English and Urdu SHALL not require component forks.
- Text expansion SHALL be tested.
- Safety meaning SHALL not depend on idioms difficult to translate.

## 15. Accessibility

Non-vehicle surfaces:
- WCAG 2.2 AA baseline.
- keyboard-complete;
- visible focus;
- skip links where appropriate;
- semantic regions/headings;
- screen-reader labels;
- live regions only for meaningful state transitions;
- 44px minimum touch targets where practical;
- no color-only meaning;
- contrast tested in light/dark;
- zoom/text scaling resilience.

Vehicle profile:
- separate ergonomic and distraction acceptance testing;
- no assumption that WCAG alone is sufficient for safe driving UX.

## 16. Data and Integration Simplicity

UI MUST consume canonical projections, not vendor-specific payloads.

Preferred flow:

```
Domain / Integration Events
       ↓
Canonical ROS Experience Projection
       ↓
Role + Purpose + Surface Policy
       ↓
Shared Experience Contract
       ↓
Surface Adapter
       ↓
HANDHELD / TABLET / DESKTOP / WALL / VEHICLE
```

Vendor integrations SHALL terminate behind adapters. UI components SHALL not encode provider-specific rules.

## 17. Degraded and Failure UX

The following states MUST be explicit:
- offline;
- reconnecting;
- stale data;
- partial sensor coverage;
- conflicting evidence;
- reduced confidence;
- permission denied;
- location unavailable;
- integration unavailable;
- safe mode;
- human-only mode.

A degraded system MUST look calmer, not noisier. The UI SHALL never imply live certainty from stale data.

## 18. Existing ROS Integration Targets

Initial implementation SHALL evolve, not discard:
- `apps/mobile/src/field-companion.ts`
- `apps/mobile/src/render.ts`
- `apps/operations-dashboard/src/dashboard.ts`
- Human Safety dashboard/render flows
- existing browser workflow and accessibility tests

The migration SHALL preserve tested safety behavior while extracting reusable presentation contracts and surface policies.

## 19. Implementation Work Packages

### WP-UI-00 — Baseline
- inventory existing UI semantics;
- freeze safety-state vocabulary;
- define tokens and surface profiles.

### WP-UI-01 — Shared Contracts
- type definitions for surface profile, density, intent, decision state, evidence display;
- shared token package or generated artifacts;
- no production behavior changes.

### WP-UI-02 — Mobile / Handheld
- redesign Field Companion using universal components;
- Human Safety Session;
- offline/stale/permission states.

### WP-UI-03 — Desktop Operations
- shared RoadEvent/Evidence/Decision components;
- operator-first focus and keyboard workflow;
- cognitive-load reduction.

### WP-UI-04 — Wall
- view-only adaptive composition;
- mission/event display;
- distance legibility checks.

### WP-UI-05 — Vehicle
- advisory-only prototype;
- moving/parked profile separation;
- driver distraction and legibility review.

### WP-UI-06 — Brain / Heart / Immune
- explainable cognitive state;
- governed decision language;
- health/degraded modes.

### WP-UI-07 — Cross-Surface Continuity
- event identity/deep-link model;
- role-aware handoff;
- no authority transfer.

### WP-UI-08 — Independent QA
- accessibility;
- RTL/LTR;
- responsive/surface matrix;
- safety state integrity;
- vehicle review;
- regression evidence.

## 20. Definition of Done

A surface is not “done” when it looks polished.

It is done only when:
- semantics match the universal contract;
- all required states are implemented;
- RTL/LTR behavior passes;
- keyboard/touch/role-specific inputs pass;
- accessibility gates pass;
- stale/offline/degraded cases pass;
- safety-state meanings are identical across surfaces;
- vehicle profile contains no forbidden dense/operator interaction while moving;
- screenshots and test evidence are archived;
- independent review is complete.

## 21. Non-Goals

UAIS v1 does NOT:
- grant live road authority;
- perform direct vehicle control;
- replace OEM safety HMI;
- claim ISO certification;
- publish production integrations;
- make all screens literally identical.

The target is **coherent identity + coherent semantics + context-safe adaptation**.
