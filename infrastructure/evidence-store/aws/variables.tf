variable "aws_region" {
  description = "AWS region for the ROS evidence store. Riyadh is the approved default."
  type        = string
  default     = "me-central-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region identifier."
  }
}

variable "evidence_bucket_name" {
  description = "Globally unique S3 bucket name for immutable ROS evidence."
  type        = string

  validation {
    condition = length(var.evidence_bucket_name) >= 3 && length(var.evidence_bucket_name) <= 56 && can(regex(
      "^[a-z0-9][a-z0-9.-]*[a-z0-9]$",
      var.evidence_bucket_name
    ))
    error_message = "evidence_bucket_name must be a 3-56 character DNS-compatible S3 name."
  }
}

variable "audit_bucket_name" {
  description = "Optional globally unique bucket for immutable CloudTrail data-event logs. Defaults to <evidence_bucket_name>-audit."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.audit_bucket_name == null || (
      length(var.audit_bucket_name) >= 3
      && length(var.audit_bucket_name) <= 63
      && can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.audit_bucket_name))
    )
    error_message = "audit_bucket_name must be null or a 3-63 character DNS-compatible S3 name."
  }
}

variable "retention_days" {
  description = "Minimum WORM retention. Values below ROS REL-013 are rejected."
  type        = number
  default     = 365

  validation {
    condition     = var.retention_days == floor(var.retention_days) && var.retention_days >= 365 && var.retention_days <= 36500
    error_message = "retention_days must be an integer between 365 and 36500."
  }
}

variable "repository_owner" {
  description = "GitHub repository owner used in OIDC trust conditions."
  type        = string
  default     = "M-Qahtan"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+$", var.repository_owner))
    error_message = "repository_owner contains invalid characters."
  }
}

variable "repository_name" {
  description = "GitHub repository name used in OIDC trust conditions."
  type        = string
  default     = "ros-road-operating-system"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+$", var.repository_name))
    error_message = "repository_name contains invalid characters."
  }
}

variable "repository_id" {
  description = "Immutable GitHub repository ID."
  type        = string
  default     = "1310606342"

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.repository_id))
    error_message = "repository_id must be a positive decimal identifier."
  }
}

variable "repository_owner_id" {
  description = "Immutable GitHub repository-owner ID."
  type        = string
  default     = "125224479"

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.repository_owner_id))
    error_message = "repository_owner_id must be a positive decimal identifier."
  }
}

variable "trusted_branch" {
  description = "Only this protected branch can obtain the append-only AWS role."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]+$", var.trusted_branch)) && !strcontains(var.trusted_branch, "..")
    error_message = "trusted_branch is invalid."
  }
}

variable "archive_workflow_name" {
  description = "Exact GitHub workflow name permitted by the AWS OIDC trust."
  type        = string
  default     = "Archive CI Evidence"

  validation {
    condition     = length(var.archive_workflow_name) >= 1 && length(var.archive_workflow_name) <= 100
    error_message = "archive_workflow_name must be between 1 and 100 characters."
  }
}

variable "create_github_oidc_provider" {
  description = "Create GitHub's AWS OIDC provider. Set false when the account already manages it centrally."
  type        = bool
  default     = true
}

variable "existing_github_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN when create_github_oidc_provider is false."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.existing_github_oidc_provider_arn == null || can(regex(
      "^arn:[a-z0-9-]+:iam::[0-9]{12}:oidc-provider/token\\.actions\\.githubusercontent\\.com$",
      var.existing_github_oidc_provider_arn
    ))
    error_message = "existing_github_oidc_provider_arn must identify token.actions.githubusercontent.com."
  }
}

variable "tags" {
  description = "Additional AWS resource tags."
  type        = map(string)
  default     = {}
}
