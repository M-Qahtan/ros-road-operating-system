locals {
  staging_log_group_arns = [
    "arn:aws:logs:${var.aws_region}:${var.expected_aws_account_id}:log-group:/ros/staging/api",
    "arn:aws:logs:${var.aws_region}:${var.expected_aws_account_id}:log-group:/ros/staging/worker"
  ]
}

data "aws_iam_policy_document" "logs_kms" {
  statement {
    sid    = "EnableAccountIamPermissions"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.expected_aws_account_id}:root"]
    }

    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "AllowCloudWatchLogsEncryption"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*"
    ]
    resources = ["*"]

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = local.staging_log_group_arns
    }
  }
}

resource "aws_kms_key" "logs" {
  description             = "ROS staging CloudWatch Logs encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.logs_kms.json

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${var.name_prefix}-logs"
  target_key_id = aws_kms_key.logs.key_id
}

data "aws_iam_policy_document" "ecs_execution_logs_kms" {
  statement {
    sid    = "UseLogsKmsViaCloudWatch"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:ReEncrypt*",
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:Describe*"
    ]
    resources = [aws_kms_key.logs.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["logs.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_logs_kms" {
  name_prefix = "${var.name_prefix}-logs-kms-"
  role        = aws_iam_role.ecs_execution.id
  policy      = data.aws_iam_policy_document.ecs_execution_logs_kms.json
}
