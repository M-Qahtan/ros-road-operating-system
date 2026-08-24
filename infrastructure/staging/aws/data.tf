resource "aws_kms_key" "runtime" {
  description             = "ROS staging runtime data encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "runtime" {
  name          = "alias/${var.name_prefix}-runtime"
  target_key_id = aws_kms_key.runtime.key_id
}

resource "aws_kms_key" "evidence" {
  description             = "ROS staging evidence encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "evidence" {
  name          = "alias/${var.name_prefix}-evidence"
  target_key_id = aws_kms_key.evidence.key_id
}

resource "random_password" "database" {
  length           = 40
  special          = true
  override_special = "!#$%&*+-_=.?"
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${var.name_prefix}-postgres"
  subnet_ids = [for subnet in aws_subnet.data : subnet.id]

  tags = {
    Name = "${var.name_prefix}-postgres"
  }
}

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${var.name_prefix}-postgres-"
  family      = "postgres${split(".", var.postgres_engine_version)[0]}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.postgres_instance_class

  db_name  = var.database_name
  username = var.database_username
  password = random_password.database.result
  port     = 5432

  allocated_storage     = var.postgres_allocated_storage_gb
  max_allocated_storage = var.postgres_allocated_storage_gb * 2
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.runtime.arn

  multi_az               = true
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period = var.postgres_backup_retention_days
  backup_window           = "20:00-21:00"
  maintenance_window      = "Sun:21:00-Sun:22:00"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade      = false
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.name_prefix}-postgres-final"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.runtime.arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "random_password" "redis" {
  length           = 48
  special          = true
  override_special = "!&#$^<>-"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = [for subnet in aws_subnet.data : subnet.id]
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "ROS staging durable stream and coordination cache"

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
  kms_key_id                 = aws_kms_key.runtime.arn

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  snapshot_retention_limit = 7
  snapshot_window          = "19:00-20:00"
  maintenance_window       = "sun:22:00-sun:23:00"
  apply_immediately        = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "evidence" {
  bucket_prefix       = "${var.name_prefix}-evidence-"
  object_lock_enabled = true
  force_destroy       = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status     = "Enabled"
    mfa_delete = "Disabled"
  }
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

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.evidence_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.evidence]
}

data "aws_iam_policy_document" "evidence_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.evidence.arn,
      "${aws_s3_bucket.evidence.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = data.aws_iam_policy_document.evidence_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.evidence]
}

locals {
  database_url = "postgresql://${var.database_username}:${urlencode(random_password.database.result)}@${aws_db_instance.postgres.address}:5432/${var.database_name}"
  redis_url    = "rediss://:${urlencode(random_password.redis.result)}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}

resource "aws_secretsmanager_secret" "database_url" {
  name_prefix             = "${var.name_prefix}/database-url-"
  description             = "ROS staging PostgreSQL connection URL"
  kms_key_id              = aws_kms_key.runtime.arn
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

resource "aws_secretsmanager_secret" "database_ca" {
  name_prefix             = "${var.name_prefix}/database-ca-"
  description             = "ROS staging approved RDS CA bundle"
  kms_key_id              = aws_kms_key.runtime.arn
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "database_ca" {
  secret_id     = aws_secretsmanager_secret.database_ca.id
  secret_string = var.database_ssl_ca_pem
}

resource "aws_secretsmanager_secret" "redis_url" {
  name_prefix             = "${var.name_prefix}/redis-url-"
  description             = "ROS staging TLS Redis connection URL"
  kms_key_id              = aws_kms_key.runtime.arn
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = local.redis_url
}
