variable "aws_region" {
  description = "Active ROS REL-013 evidence Region. Frankfurt is the only approved target."
  type        = string
  default     = "eu-central-1"

  validation {
    condition     = var.aws_region == "eu-central-1"
    error_message = "Gate C active evidence Region must be eu-central-1 (Frankfurt)."
  }
}

variable "expected_aws_account_id" {
  description = "Exact approved AWS account ID; provider operations fail closed in every other account."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_aws_account_id))
    error_message = "expected_aws_account_id must be exactly 12 decimal digits."
  }
}

variable "existing_github_oidc_provider_arn" {
  description = "Existing account-level GitHub Actions OIDC provider ARN. Frankfurt must reuse it and never create another provider."
  type        = string
  nullable    = false

  validation {
    condition = can(regex(
      "^arn:[a-z0-9-]+:iam::[0-9]{12}:oidc-provider/token\\.actions\\.githubusercontent\\.com$",
      var.existing_github_oidc_provider_arn
    ))
    error_message = "existing_github_oidc_provider_arn must identify token.actions.githubusercontent.com."
  }
}

variable "evidence_bucket_name" {
  description = "Globally unique Frankfurt S3 bucket name for immutable ROS evidence."
  type        = string

  validation {
    condition = (
      length(var.evidence_bucket_name) >= 3
      && length(var.evidence_bucket_name) <= 56
      && can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.evidence_bucket_name))
      && endswith(var.evidence_bucket_name, "-eu-central-1")
    )
    error_message = "evidence_bucket_name must be DNS-compatible and end with -eu-central-1."
  }
}

variable "audit_bucket_name" {
  description = "Optional Frankfurt immutable CloudTrail audit bucket. Defaults to <evidence_bucket_name>-audit."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = var.audit_bucket_name == null || (
      length(var.audit_bucket_name) >= 3
      && length(var.audit_bucket_name) <= 63
      && can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.audit_bucket_name))
      && endswith(var.audit_bucket_name, "-eu-central-1-audit")
    )
    error_message = "audit_bucket_name must be null or DNS-compatible and end with -eu-central-1-audit."
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
  description = "Exact GitHub repository owner permitted by the Frankfurt OIDC trust."
  type        = string
  default     = "M-Qahtan"

  validation {
    condition     = var.repository_owner == "M-Qahtan"
    error_message = "repository_owner must remain M-Qahtan for Gate C."
  }
}

variable "repository_name" {
  description = "Exact GitHub repository permitted by the Frankfurt OIDC trust."
  type        = string
  default     = "ros-road-operating-system"

  validation {
    condition     = var.repository_name == "ros-road-operating-system"
    error_message = "repository_name must remain ros-road-operating-system for Gate C."
  }
}

variable "repository_id" {
  description = "Immutable GitHub repository ID."
  type        = string
  default     = "1310606342"

  validation {
    condition     = var.repository_id == "1310606342"
    error_message = "repository_id must remain the approved immutable repository ID 1310606342."
  }
}

variable "repository_owner_id" {
  description = "Immutable GitHub repository-owner ID."
  type        = string
  default     = "125224479"

  validation {
    condition     = var.repository_owner_id == "125224479"
    error_message = "repository_owner_id must remain the approved owner ID 125224479."
  }
}

variable "trusted_branch" {
  description = "Only the protected main branch can obtain the Frankfurt archive role."
  type        = string
  default     = "main"

  validation {
    condition     = var.trusted_branch == "main"
    error_message = "trusted_branch must remain main for Gate C."
  }
}

variable "archive_workflow_name" {
  description = "Exact GitHub workflow name permitted by the AWS OIDC trust."
  type        = string
  default     = "Archive CI Evidence"

  validation {
    condition     = var.archive_workflow_name == "Archive CI Evidence"
    error_message = "archive_workflow_name must remain Archive CI Evidence."
  }
}

variable "tags" {
  description = "Additional AWS resource tags."
  type        = map(string)
  default     = {}
}
