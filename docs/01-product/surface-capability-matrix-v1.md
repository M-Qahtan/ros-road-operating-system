# ROS Surface Capability Matrix v1.0

| Capability | Handheld | Tablet | Desktop | Wall | Vehicle Moving |
|---|---|---|---|---|---|
| Trip safety summary | Primary | Primary | Context | Summary | Primary |
| Proactive hazard alert | Primary | Primary | Monitor | Exception | Primary |
| Human Safety Session | Primary | Responder assist | Supervise | Status only | Minimal / voice assist |
| RoadEvent details | Minimal | Medium | Full | Summary | Minimal |
| Evidence list | On demand | Medium | Full | Aggregate | Hidden |
| Confidence + freshness | Simple | Standard | Full | Summary | Simple |
| Source lineage | Hidden/on demand | On demand | Full | Hidden | Hidden |
| Contradiction detail | Plain-language | Medium | Full | Exception | Plain-language only |
| RECOMMEND | Yes | Yes | Yes | Status | Advisory only |
| ABSTAIN | Yes | Yes | Yes | Status | Yes |
| REQUEST_MORE_EVIDENCE | Plain language | Yes | Yes | Status | Plain language |
| HUMAN_REVIEW | Status | Actionable by role | Full workflow | Status | Status only |
| Mission timeline | Minimal | Medium | Full | Full visual | Next step only |
| System health | Minimal | Medium | Full | Aggregate | Only if driver-relevant |
| Configuration | Limited | Limited | Full by role | None | None while moving |
| Dense tables | No | Rare | Yes | No interaction | Forbidden |
| Keyboard shortcuts | No | Optional | Primary | Controller surface | OEM controls only |
| Touch | Primary | Primary | Optional | None/rare | Large targets |
| Voice | Optional | Optional | Optional | No | Optional supplementary |
| Offline mode | Required | Required | Required | Cached status | Required safe fallback |
| Stale-data warning | Required | Required | Required | Required | Required |
| Light/Dark adaptation | Yes | Yes | Yes | Yes | Day/Night vehicle policy |
| RTL Arabic | Required | Required | Required | Required | Required |

## Interaction Budgets

### Handheld
- one primary action per critical state;
- maximum two competing calls to action;
- progressive detail.

### Tablet
- one primary task plus contextual side information;
- touch-first layouts.

### Desktop
- full keyboard workflow;
- multiple panes allowed when they preserve priority hierarchy.

### Wall
- no critical function requires interaction on the wall itself;
- optimized for distance and group comprehension.

### Vehicle Moving
- one primary message;
- one optional secondary action;
- no scrolling critical workflow;
- no dense evidence;
- no configuration;
- no direct actuation;
- no operator-only function.
