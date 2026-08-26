# ROS Frankfurt private DNS / TLS contract

This contract applies only to the temporary ROS engineering staging slice in AWS `eu-central-1` (Frankfurt, Germany / European Union).

It does **not** change the Riyadh pilot geography, does **not** make the environment Saudi-hosted, and does **not** authorize real incident/evidence/medical/legal data, Terraform apply, deployment, public-road operation or live external integrations.

## Private endpoint name

The staging API server name is fixed to:

`api.ros-staging.internal`

The private hosted zone is:

`ros-staging.internal`

The zone is associated only with the staging VPC. Route 53 aliases `api.ros-staging.internal` to the internal Application Load Balancer. No public hosted zone or public DNS record is created by this module.

## Certificate contract

The internal HTTPS listener continues to receive an exact `tls_certificate_arn` input. The executable PLAN_ONLY graph additionally requires that this ARN identify the single matching ACM certificate with all of these properties:

- account and region already satisfy the existing `tls_certificate_arn` validation;
- certificate server name: `api.ros-staging.internal`;
- ACM status: `ISSUED`;
- certificate type for this temporary staging slice: `IMPORTED`;
- lookup must be unambiguous (`most_recent = false`), so multiple matching certificates fail closed;
- the ARN returned by the ACM lookup must equal the exact supplied `tls_certificate_arn`.

For the current synthetic-only staging path, an imported privately generated certificate may be used only after a separate bounded ACM-import authorization. Imported certificates are not treated as automatically renewed; expiry, rotation and client trust remain explicit operational evidence requirements.

## Trust boundary

A self-signed/private certificate is not implicitly trusted by browsers or devices. Any later controlled staging client must trust the corresponding certificate/CA through an explicitly reviewed trust path. This module does not distribute trust anchors and does not weaken TLS verification.

## PLAN_ONLY implications

Static `terraform validate` does not prove certificate existence. During the real AWS PLAN_ONLY session, the `aws_acm_certificate.staging_alb` data lookup must resolve exactly one matching issued imported certificate. Missing, ambiguous, expired/non-issued or mismatched certificate state makes the real plan NO-GO.

The resulting private DNS and certificate resources are proposal inputs only until an exact binary Terraform plan is independently reviewed and a later, separate apply authorization is granted. No such apply authorization exists in this contract.
