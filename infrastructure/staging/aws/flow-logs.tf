resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/ros/staging/vpc-flow"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "vpc_flow_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.expected_aws_account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ec2:${var.aws_region}:${var.expected_aws_account_id}:vpc-flow-log/*"]
    }
  }
}

resource "aws_iam_role" "vpc_flow" {
  name_prefix        = "${var.name_prefix}-vpc-flow-"
  assume_role_policy = data.aws_iam_policy_document.vpc_flow_assume.json
}

data "aws_iam_policy_document" "vpc_flow_publish" {
  statement {
    sid    = "WriteOnlyToRosVpcFlowLogGroup"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams"
    ]
    resources = ["${aws_cloudwatch_log_group.vpc_flow.arn}:*"]
  }

  statement {
    sid       = "DescribeLogGroupsOnly"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "vpc_flow_publish" {
  name_prefix = "${var.name_prefix}-vpc-flow-"
  role        = aws_iam_role.vpc_flow.id
  policy      = data.aws_iam_policy_document.vpc_flow_publish.json
}

resource "aws_flow_log" "staging" {
  iam_role_arn             = aws_iam_role.vpc_flow.arn
  log_destination          = aws_cloudwatch_log_group.vpc_flow.arn
  log_destination_type     = "cloud-watch-logs"
  traffic_type             = "ALL"
  vpc_id                   = aws_vpc.staging.id
  max_aggregation_interval = 60

  tags = {
    Name = "${var.name_prefix}-vpc-flow"
  }
}
