# ROS Universal Interface QA Gates v1.0

## Gate A — Semantic Consistency
- [ ] Same RoadEvent ID produces equivalent meaning on every surface.
- [ ] Decision state labels are invariant.
- [ ] Confidence/freshness meaning is invariant.
- [ ] Brand colors never replace safety semantics.
- [ ] Surface adaptation does not expand authority.

## Gate B — Responsive / Surface
Test at minimum:
- [ ] 360x800 handheld
- [ ] 430x932 handheld
- [ ] 768x1024 tablet
- [ ] 1366x768 desktop
- [ ] 1920x1080 desktop
- [ ] 2560x1440 workstation
- [ ] 3840x2160 wall
- [ ] representative in-vehicle landscape profiles

Validate:
- [ ] no horizontal overflow;
- [ ] no clipped critical text;
- [ ] no hidden safety state;
- [ ] touch targets remain usable;
- [ ] typography remains legible at expected distance.

## Gate C — RTL / LTR
- [ ] Arabic RTL complete.
- [ ] English LTR structural smoke test.
- [ ] Urdu RTL structural smoke test.
- [ ] directional icons reviewed.
- [ ] mixed Arabic/English IDs render correctly.

## Gate D — Accessibility
- [ ] keyboard-complete desktop flow;
- [ ] visible focus;
- [ ] heading hierarchy;
- [ ] landmarks;
- [ ] screen-reader labels;
- [ ] live regions limited to meaningful updates;
- [ ] contrast pass in light/dark;
- [ ] no color-only meaning;
- [ ] reduced motion respected;
- [ ] zoom/text scaling regression.

## Gate E — Safety States
Run all surfaces through:
- [ ] NORMAL
- [ ] EMERGING_RISK
- [ ] CONFIRMED_INCIDENT
- [ ] CONFLICTING_EVIDENCE
- [ ] EMERGENCY_MISSION
- [ ] DEGRADED
- [ ] OFFLINE
- [ ] STALE
- [ ] HUMAN_ONLY_SAFE_MODE

Expected invariant:
`RECOMMEND / ABSTAIN / REQUEST_MORE_EVIDENCE / HUMAN_REVIEW` remain semantically stable.

## Gate F — Vehicle
While moving:
- [ ] no dense tables;
- [ ] no configuration;
- [ ] no multi-step form;
- [ ] no operator actions;
- [ ] one primary message;
- [ ] max one optional secondary action;
- [ ] advisory-only;
- [ ] vehicle-local veto communicated in architecture;
- [ ] no misleading implication of direct control;
- [ ] separate parked/passenger profile tested.

## Gate G — Failure UX
- [ ] offline;
- [ ] reconnecting;
- [ ] stale;
- [ ] permission denied;
- [ ] location unavailable;
- [ ] partial observability;
- [ ] integration unavailable;
- [ ] degraded;
- [ ] contained.

No failure state may fabricate certainty.

## Gate H — Evidence
For each critical UI release archive:
- commit SHA;
- screenshots per surface;
- automated test log;
- accessibility report;
- RTL/LTR report;
- vehicle-HMI review notes;
- known limitations;
- reviewer approval.

## Merge Policy
No production merge solely on visual approval.
Required chain:

`Requirement → Hazard → Design → Code → Test → Evidence → Independent Review`
