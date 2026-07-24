# Safety and Incident Response Playbooks

## Operating sequence

1. detect and validate;
2. create or attach to RoadEvent;
3. start safety conversation;
4. assess indicators, never diagnose;
5. escalate non-response and critical indicators;
6. prepare agency requests for human approval;
7. warn nearby road users and manage recommendations;
8. preserve evidence and chain of custody;
9. coordinate clearance only after safety controls;
10. restore road in stages, monitor, then close.

## Automation prohibitions

ROS must not autonomously:

- declare a person safe, injured or deceased;
- issue medical or legal conclusions;
- determine fault;
- send official emergency requests in the MVP without operator approval;
- officially close a road or control traffic signals;
- delete or alter evidence;
- close S3/S4 events.

## Human-in-the-loop triggers

No response, loss of consciousness, bleeding, breathing difficulty, fire, hazardous material, multiple casualties, conflicting signals, medium-confidence merge, severity reduction and any official external action.

## Initial SLA targets

| Action | Target |
|---|---:|
| Record signal | <= 2 seconds |
| Create RoadEvent | <= 10 seconds |
| Start safety conversation | <= 10 seconds after confirmation |
| Escalate no response | <= 30 seconds |
| Display event to operator | <= 5 seconds |
| Critical operator acknowledgement | <= 30 seconds |
| Escalate to supervisor | <= 60 seconds |

Targets are pilot hypotheses and must be measured before external commitments.
