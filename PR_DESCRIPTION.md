## What changed

Introduces the first ROS engineering baseline for the Riyadh MVP:

- monorepo governance, CI and contribution workflow;
- RoadEvent domain model and safety-first state machine;
- PostgreSQL/PostGIS initial schema, outbox and audit foundations;
- API health baseline and shared contracts;
- Docker services for PostGIS, Redis and object storage;
- product scope, backlog, architecture ADRs, AI/data governance, safety playbooks, security controls and pilot gates.

## Why

ROS needs one coherent source of truth before feature development begins. This baseline converts the approved product, architecture, AI/data and safety decisions into an executable repository structure.

## Validation

- repository structural verification passed;
- TypeScript domain, contracts and API compilation passed using TypeScript 5.8.3;
- RoadEvent state-machine tests passed (2/2);
- unsafe direct transition from DETECTED to CLOSED is rejected.

## Notes

Agency integrations remain simulations. Predictive AI, medical diagnosis, legal fault determination and official road control are deliberately out of MVP scope.
