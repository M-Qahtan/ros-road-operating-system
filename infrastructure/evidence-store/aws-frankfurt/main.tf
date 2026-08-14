data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  repository_full_name       = "${var.repository_owner}/${var.repository_name}"
  trusted_ref                = "refs/heads/${var.trusted_branch}"
  oidc_subject               = "repo:${local.repository_full_name}:ref:${local.trusted_ref}"
  evidence_prefix            = "evidence/github/${var.repository_id}"
  audit_bucket_name          = coalesce(var.audit_bucket_name, "${var.evidence_bucket_name}-audit")
  trail_name                 = "ros-evidence-euc1-${var.repository_id}"
  trail_arn                  = "arn:${data.aws_partition.current.partition}:cloudtrail:${var.aws_region}:${data.aws_caller_identity.current.account_id}:trail/${local.trail_name}"
  root_arn                   = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
  expected_oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${var.expected_aws_account_id}:oidc-provider/token.actions.githubusercontent.com"
}

resource "terraform_data" "validate_frankfurt_identity" {
  input = {
    account_id        = data.aws_caller_identity.current.account_id
    region            = var.aws_region
    oidc_provider_arn = var.existing_github_oidc_provider_arn
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_aws_account_id
      error_message = "AWS caller identity does not match expected_aws_account_id."
    }

    precondition {
      condition     = var.aws_region == "eu-central-1"
      error_message = "Gate C active evidence Region must remain eu-central-1 (Frankfurt)."
    }

    precondition {
      condition     = var.existing_github_oidc_provider_arn == local.expected_oidc_provider_arn
      error_message = "Frankfurt must reuse the exact existing GitHub OIDC provider ARN in the approved AWS account."
    }
  }
}

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "EnableAccountAdministration"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [local.root_arn]
    }
  }

  statement {
    sid    = "AllowFrankfurtCloudTrailEncryption"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:GenerateDataKey*"
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:cloudtrail:arn"
      values   = [local.trail_arn]
    }
  }
}

resource "aws_kms_key" "evidence" {
  description             = "ROS REL-013 Frankfurt CI and release evidence encryption key"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "evidence" {
  name          = "alias/ros-evidence-euc1-${var.repository_id}"
  target_key_id = aws_kms_key.evidence.key_id
}

resource "aws_s3_bucket" "evidence" {
  bucket              = var.evidence_bucket_name
  object_lock_enabled = true
  force_destroy       = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "audit" {
  bucket              = local.audit_bucket_name
  object_lock_enabled = true
  force_destroy       = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket              = aws_s3_bucket.evidence.id
  object_lock_enabled = "Enabled"

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.evidence]
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket              = aws_s3_bucket.audit.id
  object_lock_enabled = "Enabled"

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.evidence.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.evidence.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket = aws_s3_bucket.audit.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_ownership_controls" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "evidence_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyLegacyTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "NumericLessThan"
      variable = "s3:TlsVersion"
      values   = ["1.2"]
    }
  }

  statement {
    sid       = "DenyNonKMSUploads"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid       = "DenyUnexpectedKMSKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.evidence.arn]
    }
  }

  statement {
    sid       = "DenyNonComplianceUploads"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:object-lock-mode"
      values   = ["COMPLIANCE"]
    }
  }

  statement {
    sid       = "DenyUploadsWithoutRetainUntil"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Null"
      variable = "s3:object-lock-retain-until-date"
      values   = ["true"]
    }
  }

  statement {
    sid    = "DenyRetentionBelowMinimum"
    effect = "Deny"
    actions = [
      "s3:PutObject",
      "s3:PutObjectRetention"
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "NumericLessThan"
      variable = "s3:object-lock-remaining-retention-days"
      values   = [tostring(var.retention_days)]
    }
  }
}

resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = data.aws_iam_policy_document.evidence_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.evidence]
}

data "aws_iam_policy_document" "audit_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyLegacyTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "NumericLessThan"
      variable = "s3:TlsVersion"
      values   = ["1.2"]
    }
  }

  statement {
    sid       = "AllowCloudTrailBucketCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "AllowCloudTrailDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/cloudtrail/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.audit]
}

resource "aws_cloudtrail" "evidence" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  s3_key_prefix                 = "cloudtrail"
  kms_key_id                    = aws_kms_key.evidence.arn
  enable_logging                = true
  enable_log_file_validation    = true
  include_global_service_events = true
  is_multi_region_trail         = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.evidence.arn}/"]
    }
  }

  depends_on = [
    terraform_data.validate_frankfurt_identity,
    aws_s3_bucket_policy.audit,
    aws_s3_bucket_object_lock_configuration.audit,
    aws_s3_bucket_server_side_encryption_configuration.audit
  ]
}

data "aws_iam_policy_document" "archive_trust" {
  statement {
    sid     = "GitHubMainArchiveWorkflowFrankfurtOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.existing_github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.oidc_subject]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [local.repository_full_name]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_id"
      values   = [var.repository_id]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_owner_id"
      values   = [var.repository_owner_id]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:ref"
      values   = [local.trusted_ref]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:workflow"
      values   = [var.archive_workflow_name]
    }
  }

  depends_on = [terraform_data.validate_frankfurt_identity]
}

resource "aws_iam_role" "github_archive" {
  name                 = "ros-evidence-archive-euc1-${var.repository_id}"
  description          = "Append-only GitHub OIDC writer for ROS immutable evidence in Frankfurt"
  assume_role_policy   = data.aws_iam_policy_document.archive_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "archive" {
  statement {
    sid    = "VerifyFrankfurtEvidenceBucketPosture"
    effect = "Allow"
    actions = [
      "s3:GetBucketEncryption",
      "s3:GetBucketLocation",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetBucketPolicyStatus",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning"
    ]
    resources = [aws_s3_bucket.evidence.arn]
  }

  statement {
    sid    = "AppendAndVerifyFrankfurtEvidenceObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectRetention",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:PutObjectRetention"
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/${local.evidence_prefix}/*"]
  }

  statement {
    sid    = "UseFrankfurtEvidenceKMSKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey"
    ]
    resources = [aws_kms_key.evidence.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.eu-central-1.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [var.expected_aws_account_id]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:aws:s3:arn"
      values   = [aws_s3_bucket.evidence.arn]
    }
  }
}

resource "aws_iam_role_policy" "github_archive" {
  name   = "append-and-verify-ros-evidence-euc1"
  role   = aws_iam_role.github_archive.id
  policy = data.aws_iam_policy_document.archive.json
}

data "aws_iam_policy_document" "independent_verifier" {
  statement {
    sid    = "VerifyFrankfurtBucketPosture"
    effect = "Allow"
    actions = [
      "s3:GetBucketEncryption",
      "s3:GetBucketLocation",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetBucketPolicyStatus",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning"
    ]
    resources = [aws_s3_bucket.evidence.arn, aws_s3_bucket.audit.arn]
  }

  statement {
    sid       = "DiscoverFrankfurtEvidenceReceipts"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.evidence.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.evidence_prefix}/*"]
    }
  }

  statement {
    sid    = "ReadAndVerifyFrankfurtEvidenceVersions"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectRetention",
      "s3:GetObjectVersion"
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/${local.evidence_prefix}/*"]
  }

  statement {
    sid    = "DecryptFrankfurtEvidenceForIndependentVerification"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.evidence.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.eu-central-1.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [var.expected_aws_account_id]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:aws:s3:arn"
      values   = [aws_s3_bucket.evidence.arn]
    }
  }

  statement {
    sid    = "VerifyFrankfurtCloudTrailStatus"
    effect = "Allow"
    actions = [
      "cloudtrail:GetTrail",
      "cloudtrail:GetTrailStatus"
    ]
    resources = [aws_cloudtrail.evidence.arn]
  }
}

resource "aws_iam_policy" "independent_verifier" {
  name        = "ros-evidence-independent-verifier-euc1-${var.repository_id}"
  description = "Read-only policy for independent REL-013 Frankfurt evidence verification"
  policy      = data.aws_iam_policy_document.independent_verifier.json
}
