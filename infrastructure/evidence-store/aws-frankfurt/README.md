# ROS REL-013 Frankfurt evidence plane

This Terraform root is the **active replacement Gate C evidence plane** for Frankfurt (`eu-central-1`). It is intentionally isolated from the quarantined legacy root at `../aws/`.

Security and governance invariants:

- Frankfurt is hard-locked to `eu-central-1`.
- The existing account-level GitHub OIDC provider is required by ARN and is never created here.
- A distinct Frankfurt archive IAM role prevents dual-state IAM ownership.
- Evidence and audit buckets use S3 Object Lock `COMPLIANCE`, versioning, SSE-KMS, public-access blocking, TLS enforcement, `prevent_destroy`, and `force_destroy = false`.
- CloudTrail is created from Frankfurt, is multi-Region, validates log files, and records evidence-bucket S3 object data events.
- The independent verifier policy is read-only and unattached by this root.
- The Frankfurt state key is `ros/rel-013/evidence-store/eu-central-1/terraform.tfstate` in the existing encrypted backend bucket.
- No long-lived AWS credentials belong in repository configuration.

## PR validation boundary

Pull-request CI may only run non-mutating validation (`fmt`, backend-disabled `init`, `validate`, static architecture checks, negative fail-closed checks, and legacy non-interference checks). It must not contact the live Terraform backend or mutate AWS.

A saved plan is a later R2 governance action after this implementation is reviewed and merged. Any future apply requires independent review and explicit approval of the exact saved-plan SHA-256.

See:

- `docs/10-engineering/gate-c-frankfurt-region-remediation.md`
- `docs/10-engineering/gate-c-frankfurt-implementation-plan.md`
- `docs/10-engineering/external-evidence-store-runbook.md`
