# Security Baseline

## Critical data

Precise location, identity, health indicators, incident evidence, device signals and operator decisions are restricted data.

## Required controls

- OIDC/OAuth2 identity and short-lived sessions;
- MFA for operators;
- RBAC and least privilege;
- encryption in transit and at rest;
- secrets manager;
- signed evidence upload URLs;
- immutable audit and evidence hashes;
- rate limiting, input validation and dependency scanning;
- retention, deletion and de-identification policies;
- no sensitive values in application logs.

## Pilot gate

No critical vulnerability, successful backup restore, permission tests, incident runbooks and verified audit coverage for every P0 action.
