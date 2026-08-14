# Gate C Frankfurt immutable OIDC subject remediation

## Trigger

After the Frankfurt evidence plane was applied and independently verified, the controlled GitHub cutover configured the five `ROS_EVIDENCE_*` repository variables and dispatched `ROS Eye Pilot Readiness` from protected `main` at `21d873fce1b235051fdbd34628cced2991681204`.

Source run `31783356558` completed successfully. The subscribed `Archive CI Evidence` run `31783379507` then failed before any evidence upload at `Configure short-lived AWS credentials` with:

`Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`

No WORM receipt was created by that failed archive run.

## Root cause

The live GitHub repository OIDC configuration reports the immutable repository prefix:

`repo:M-Qahtan@125224479/ros-road-operating-system@1310606342`

The applied Frankfurt IAM trust used the legacy name-only subject:

`repo:M-Qahtan/ros-road-operating-system:ref:refs/heads/main`

The role therefore rejected the GitHub OIDC token at STS before archival started.

## Remediation

Keep GitHub's stronger immutable repository identity and update only the Frankfurt archive-role trust subject to:

`repo:M-Qahtan@125224479/ros-road-operating-system@1310606342:ref:refs/heads/main`

The existing additional trust restrictions remain mandatory:

- audience `sts.amazonaws.com`;
- repository `M-Qahtan/ros-road-operating-system`;
- repository ID `1310606342`;
- repository owner ID `125224479`;
- ref `refs/heads/main`;
- workflow `Archive CI Evidence`.

Do not weaken GitHub OIDC back to a name-only subject. Do not create a second OIDC provider. Do not manually edit the IAM role outside Terraform.

## Governance boundary

This PR is source-only and must not mutate AWS. After review and merge, produce a new saved Terraform plan against the existing Frankfurt state. Expected scope is a trust-policy update to the existing Frankfurt archive role only, with no S3/KMS/CloudTrail replacement or legacy-state mutation.

The new saved-plan SHA-256 requires independent review and explicit founder approval before apply. After exact-plan apply, rerun the controlled source workflow and complete the first WORM receipt plus same-run replay proof.

Gate C remains `NO-GO` until the live receipt, immutable version verification, CloudTrail audit evidence, and replay VersionId reuse all pass independently.
