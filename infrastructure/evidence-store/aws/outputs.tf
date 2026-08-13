output "evidence_bucket_name" {
  description = "Set as GitHub repository variable ROS_EVIDENCE_BUCKET."
  value       = aws_s3_bucket.evidence.id
}

output "audit_bucket_name" {
  description = "Immutable CloudTrail audit bucket."
  value       = aws_s3_bucket.audit.id
}

output "evidence_kms_key_arn" {
  description = "Set as GitHub repository variable ROS_EVIDENCE_KMS_KEY_ARN."
  value       = aws_kms_key.evidence.arn
}

output "github_archive_role_arn" {
  description = "Set as GitHub repository variable ROS_EVIDENCE_AWS_ROLE_ARN."
  value       = aws_iam_role.github_archive.arn
}

output "aws_account_id" {
  description = "Set as GitHub repository variable ROS_EVIDENCE_AWS_ACCOUNT_ID."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Set as GitHub repository variable ROS_EVIDENCE_AWS_REGION."
  value       = var.aws_region
}

output "evidence_prefix" {
  description = "Only this append-only prefix is writable by GitHub Actions."
  value       = local.evidence_prefix
}

output "independent_verifier_policy_arn" {
  description = "Attach only to the separately governed read-only release/safety reviewer role."
  value       = aws_iam_policy.independent_verifier.arn
}

output "github_repository_variables" {
  description = "Non-secret repository variables required by archive-ci-evidence.yml."
  value = {
    ROS_EVIDENCE_AWS_ACCOUNT_ID = data.aws_caller_identity.current.account_id
    ROS_EVIDENCE_AWS_REGION     = var.aws_region
    ROS_EVIDENCE_AWS_ROLE_ARN   = aws_iam_role.github_archive.arn
    ROS_EVIDENCE_BUCKET         = aws_s3_bucket.evidence.id
    ROS_EVIDENCE_KMS_KEY_ARN    = aws_kms_key.evidence.arn
  }
}
