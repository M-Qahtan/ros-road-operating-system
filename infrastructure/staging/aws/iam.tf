data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name_prefix        = "${var.name_prefix}-execution-"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid    = "ReadRuntimeSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.database_ca.arn,
      aws_secretsmanager_secret.redis_url.arn
    ]
  }

  statement {
    sid    = "DecryptRuntimeSecrets"
    effect = "Allow"
    actions = [
      "kms:Decrypt"
    ]
    resources = [aws_kms_key.runtime.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name_prefix = "${var.name_prefix}-secrets-"
  role        = aws_iam_role.ecs_execution.id
  policy      = data.aws_iam_policy_document.ecs_execution_secrets.json
}

resource "aws_iam_role" "api_task" {
  name_prefix        = "${var.name_prefix}-api-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

resource "aws_iam_role" "worker_task" {
  name_prefix        = "${var.name_prefix}-worker-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
}

data "aws_iam_policy_document" "api_evidence_access" {
  statement {
    sid    = "ListEvidenceBucket"
    effect = "Allow"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket"
    ]
    resources = [aws_s3_bucket.evidence.arn]
  }

  statement {
    sid    = "ReadWriteEvidenceObjectsWithoutDelete"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectVersion",
      "s3:PutObject"
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]
  }

  statement {
    sid    = "UseEvidenceKmsKey"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.evidence.arn]
  }
}

resource "aws_iam_role_policy" "api_evidence_access" {
  name_prefix = "${var.name_prefix}-evidence-"
  role        = aws_iam_role.api_task.id
  policy      = data.aws_iam_policy_document.api_evidence_access.json
}
