variable "aws_region" {
  description = "ROS staging AWS region. This slice is intentionally pinned to Riyadh."
  type        = string
  default     = "me-central-1"

  validation {
    condition     = var.aws_region == "me-central-1"
    error_message = "ROS staging is currently approved for me-central-1 only."
  }
}

variable "expected_aws_account_id" {
  description = "Exact 12-digit AWS account allowed for PLAN_ONLY review."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_aws_account_id))
    error_message = "expected_aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "repository_owner" {
  type    = string
  default = "M-Qahtan"
}

variable "repository_name" {
  type    = string
  default = "ros-road-operating-system"
}

variable "name_prefix" {
  description = "Stable resource prefix for the controlled staging environment."
  type        = string
  default     = "ros-staging"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,24}$", var.name_prefix))
    error_message = "name_prefix must be 3-24 lowercase alphanumeric/hyphen characters."
  }
}

variable "vpc_cidr" {
  description = "Isolated RFC1918 staging VPC CIDR. Prefix /16 through /20 keeps derived app/data subnets operationally sized."
  type        = string
  default     = "10.70.0.0/16"

  validation {
    condition = (
      can(cidrhost(var.vpc_cidr, 0)) &&
      can(regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.).*/(1[6-9]|20)$", var.vpc_cidr))
    )
    error_message = "vpc_cidr must be a valid RFC1918 IPv4 CIDR with prefix length /16 through /20."
  }
}

variable "availability_zone_count" {
  description = "Number of AZs used for application and data tiers."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "availability_zone_count must be 2 or 3."
  }
}

variable "api_image_uri" {
  description = "Immutable ROS API container image URI pinned by sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image_uri))
    error_message = "api_image_uri must be immutable and end with @sha256:<64 lowercase hex>."
  }
}

variable "worker_image_uri" {
  description = "Immutable ROS worker container image URI pinned by sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image_uri))
    error_message = "worker_image_uri must be immutable and end with @sha256:<64 lowercase hex>."
  }
}

variable "tls_certificate_arn" {
  description = "ACM certificate ARN for the internal staging ALB HTTPS listener."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:acm:[^:]+:[0-9]{12}:certificate/[0-9a-f-]+$", var.tls_certificate_arn))
    error_message = "tls_certificate_arn must be a valid ACM certificate ARN."
  }
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "api_desired_count" {
  type    = number
  default = 2

  validation {
    condition     = var.api_desired_count >= 2
    error_message = "api_desired_count must remain at least 2 for the HA staging proposal."
  }
}

variable "worker_desired_count" {
  type    = number
  default = 2

  validation {
    condition     = var.worker_desired_count >= 2
    error_message = "worker_desired_count must remain at least 2 for the HA staging proposal."
  }
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "fargate_platform_version" {
  description = "Exact Linux Fargate platform version approved in me-central-1 during the real PLAN_ONLY session. LATEST is forbidden."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.fargate_platform_version))
    error_message = "fargate_platform_version must be an exact semantic platform version such as 1.4.0; LATEST is not allowed."
  }
}

variable "postgres_engine_version" {
  description = "Exact PostgreSQL engine version approved for me-central-1 during the real PLAN_ONLY session."
  type        = string
}

variable "postgres_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "postgres_allocated_storage_gb" {
  type    = number
  default = 100

  validation {
    condition     = var.postgres_allocated_storage_gb >= 100
    error_message = "postgres_allocated_storage_gb must be at least 100 GiB."
  }
}

variable "postgres_backup_retention_days" {
  type    = number
  default = 7

  validation {
    condition     = var.postgres_backup_retention_days >= 7 && var.postgres_backup_retention_days <= 35
    error_message = "postgres_backup_retention_days must be between 7 and 35 days."
  }
}

variable "database_name" {
  type    = string
  default = "ros"
}

variable "database_username" {
  type    = string
  default = "ros_runtime"
}

variable "database_ssl_ca_pem" {
  description = "Approved AWS RDS CA bundle PEM injected through Secrets Manager for verified PostgreSQL TLS."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.database_ssl_ca_pem)) > 0
    error_message = "database_ssl_ca_pem must contain the approved RDS trust bundle."
  }
}

variable "redis_engine_version" {
  description = "Exact Redis/Valkey-compatible engine version approved during the real PLAN_ONLY session."
  type        = string
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "evidence_retention_days" {
  type    = number
  default = 365

  validation {
    condition     = var.evidence_retention_days >= 365
    error_message = "Evidence Object Lock COMPLIANCE retention must be at least 365 days."
  }
}

variable "audit_retention_days" {
  description = "CloudTrail audit-log Object Lock COMPLIANCE retention."
  type        = number
  default     = 365

  validation {
    condition     = var.audit_retention_days >= 365
    error_message = "Audit Object Lock COMPLIANCE retention must be at least 365 days."
  }
}

variable "log_retention_days" {
  type    = number
  default = 365

  validation {
    condition     = var.log_retention_days >= 90
    error_message = "log_retention_days must be at least 90 days for staging evidence review."
  }
}

variable "oncall_owner" {
  description = "Approved human/team on-call owner recorded in staging governance evidence."
  type        = string

  validation {
    condition     = length(trimspace(var.oncall_owner)) >= 3
    error_message = "oncall_owner must name the approved human/team owner."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
