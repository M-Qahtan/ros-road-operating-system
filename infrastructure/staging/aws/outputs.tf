output "staging_region" {
  description = "Approved ROS staging AWS region."
  value       = var.aws_region
}

output "vpc_id" {
  description = "ROS staging isolated VPC ID."
  value       = aws_vpc.staging.id
}

output "ecs_cluster_name" {
  description = "ROS staging ECS cluster name."
  value       = aws_ecs_cluster.staging.name
}

output "internal_alb_dns_name" {
  description = "Internal-only ROS staging ALB DNS name."
  value       = aws_lb.internal.dns_name
}

output "evidence_bucket_name" {
  description = "Private WORM evidence bucket name."
  value       = aws_s3_bucket.evidence.id
}

output "audit_bucket_name" {
  description = "Private immutable CloudTrail audit bucket name."
  value       = aws_s3_bucket.audit.id
}

output "cloudtrail_arn" {
  description = "ROS staging CloudTrail ARN used for management and evidence-object data events."
  value       = aws_cloudtrail.staging.arn
}

output "runtime_kms_key_arn" {
  description = "Runtime KMS key ARN."
  value       = aws_kms_key.runtime.arn
}

output "evidence_kms_key_arn" {
  description = "Evidence KMS key ARN."
  value       = aws_kms_key.evidence.arn
}

output "audit_kms_key_arn" {
  description = "CloudTrail audit-log KMS key ARN."
  value       = aws_kms_key.audit.arn
}

output "database_secret_arn" {
  description = "Secrets Manager ARN containing DATABASE_URL. The secret value is never output."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "redis_secret_arn" {
  description = "Secrets Manager ARN containing REDIS_URL. The secret value is never output."
  value       = aws_secretsmanager_secret.redis_url.arn
}

output "safety_alert_topic_arn" {
  description = "SNS topic for controlled staging alarms; no external subscription is created by this module."
  value       = aws_sns_topic.safety_alerts.arn
}

output "plan_only_authority" {
  description = "Non-sensitive reminder of this module's governance boundary."
  value = {
    terraform_apply_authorized = false
    deployment_authorized      = false
    public_road_authorized     = false
    external_live_integration  = false
  }
}
