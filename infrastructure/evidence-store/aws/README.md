# AWS immutable evidence store

This Terraform root implements the founder-approved REL-013 control for the public ROS repository:

- S3 Object Lock in `COMPLIANCE` mode for at least 365 days;
- customer-managed KMS encryption;
- append-and-verify GitHub OIDC role with no delete or retention-bypass rights;
- a separate immutable CloudTrail audit bucket;
- an unattached read-only policy for an independent reviewer.

Do not apply from an unreviewed local state. Follow the complete [external evidence store runbook](../../../docs/10-engineering/external-evidence-store-runbook.md), use the partial encrypted S3 backend configuration, review the plan, and retain the first successful S3 receipt/version as the live REL-013 acceptance record.
