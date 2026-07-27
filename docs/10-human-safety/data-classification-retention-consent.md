# ROS Eye data classification, retention, and consent boundaries

## Principles

- Purpose limitation and minimum necessary data.
- Deny-by-default access by role, case, and purpose.
- Raw sensitive content stays outside general logs, metrics, CI artifacts, and analytics.
- Retention is policy-driven and auditable; legal hold preserves audit integrity without widening access.
- Emergency processing is a governance state, not a claim of legal authority.

## Classification model

| Class | Examples | Default access | Telemetry | Retention interface |
|---|---|---|---|---|
| PUBLIC | protocol version, generic documentation | public | allowed | repository lifecycle |
| INTERNAL | service health, categorical status, coarse region | authorized staff | allow-listed | operational policy |
| RESTRICTED | case ID, structured indicator codes, contact state, source provenance | assigned case roles | categorical only | case retention policy |
| HIGHLY_RESTRICTED | precise location, contact identifier, raw conversation, evidence object/key, accessibility details | purpose-bound least privilege | prohibited | short approved retention or legal hold |
| SECURITY_SECRET | credentials, tokens, signing keys | workload identity/security admins | prohibited | secret manager rotation policy |

## Purpose and consent states

- `EXPLICIT`: the person has accepted the approved safety-contact purpose.
- `EMERGENCY_SAFETY_REVIEW`: processing is restricted to detecting and escalating credible immediate safety risk; it does not authorize diagnosis or real dispatch.
- `OPERATOR_ENTERED`: an authorized operator records minimum structured facts with reason and audit.
- `SIMULATION`: synthetic fixtures only; no real person or device data.
- `WITHDRAWN`: new optional processing stops; mandatory safety/audit preservation follows approved policy.
- `UNKNOWN`: no continuous monitoring or optional enrichment; move to review when safety risk is credible.

## Retention classes

- `EPHEMERAL_CONTACT`: transient channel/session data; delete or irreversibly redact after the approved short window.
- `CASE_OPERATIONAL`: structured state and indicator history retained for the approved case period.
- `AUDIT_IMMUTABLE`: decision/action metadata retained according to safety and regulatory policy.
- `EVIDENCE_RESTRICTED`: object metadata/content governed by evidence policy, quarantine, and legal hold.
- `SIMULATION`: deterministic fixtures and results may be retained as engineering evidence when they contain no real personal data.

## Mandatory controls

- Field-level masking for contact identifiers and precise location.
- No free-text medical narrative in general application state or logs.
- Case-scoped and tenant-scoped authorization tests.
- Versioned purpose and policy identifiers on sensitive records.
- Time-bounded break-glass access with reason, alert, immutable audit, and post-use review.
- Deterministic deletion/redaction workflows that preserve required audit references.
- Vendor adapters receive only the minimum data required by the approved channel purpose.

## External approvals

Production wording, retention periods, emergency-processing basis, clinical question catalog, and any government integration require independent legal, privacy, clinical, security, operational, and governmental approval. This architecture supplies technical controls and evidence; it does not create legal authority.
