resource "aws_cloudwatch_log_group" "api" {
  name              = "/ros/staging/api"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.runtime.arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ros/staging/worker"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.runtime.arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecs_cluster" "staging" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_lb" "internal" {
  name               = "${var.name_prefix}-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for subnet in aws_subnet.app : subnet.id]

  enable_deletion_protection = true
  drop_invalid_header_fields = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name_prefix}-api"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.staging.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 15
    timeout             = 5
    path                = "/ready"
    protocol            = "HTTP"
    matcher             = "200"
  }

  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.tls_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

locals {
  expected_ecr_prefix = "${var.expected_aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/"

  api_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "ROS_RUNTIME_PROFILE", value = "persistent" },
    { name = "ROS_AUTH_PROFILE", value = "oidc" },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "OIDC_ISSUER", value = var.oidc_issuer },
    { name = "OIDC_JWKS_URL", value = var.oidc_jwks_url },
    { name = "OIDC_AUDIENCE", value = var.oidc_audience },
    { name = "OIDC_ALLOWED_BINDINGS", value = jsonencode(var.oidc_allowed_bindings) },
    { name = "OIDC_MAX_TOKEN_AGE_SECONDS", value = "600" },
    { name = "OIDC_MAX_CLOCK_SKEW_SECONDS", value = "30" },
    { name = "OIDC_JWKS_TIMEOUT_MS", value = "2000" },
    { name = "OIDC_JWKS_CACHE_TTL_SECONDS", value = "300" },
    { name = "OIDC_JWKS_MIN_REFRESH_SECONDS", value = "5" },
    { name = "DATABASE_POOL_MAX", value = "20" },
    { name = "DATABASE_CONNECTION_TIMEOUT_MS", value = "2000" },
    { name = "DATABASE_IDLE_TIMEOUT_MS", value = "10000" },
    { name = "REDIS_CONNECT_TIMEOUT_MS", value = "2000" },
    { name = "REDIS_MAX_RECONNECT_ATTEMPTS", value = "5" },
    { name = "OBJECT_STORAGE_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
    { name = "OBJECT_STORAGE_REGION", value = var.aws_region },
    { name = "OBJECT_STORAGE_BUCKET", value = aws_s3_bucket.evidence.id }
  ]

  runtime_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
    { name = "DATABASE_SSL_CA_PEM", valueFrom = aws_secretsmanager_secret.database_ca.arn },
    { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn }
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "ros-api"
      image     = var.api_image_uri
      essential = true
      command   = ["node", "apps/api/dist/main.js"]
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
        name          = "http"
      }]
      environment = local.api_environment
      secrets     = local.runtime_secrets
      readonlyRootFilesystem = true
      linuxParameters = {
        initProcessEnabled = true
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition     = startswith(var.api_image_uri, local.expected_ecr_prefix)
      error_message = "api_image_uri must use the approved account-local ECR registry."
    }
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "ros-worker"
      image     = var.worker_image_uri
      essential = true
      command   = ["node", "apps/api/dist/outbox-worker-main.js"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "ROS_RUNTIME_PROFILE", value = "persistent" },
        { name = "REDIS_CONNECT_TIMEOUT_MS", value = "2000" },
        { name = "REDIS_MAX_RECONNECT_ATTEMPTS", value = "5" }
      ]
      secrets = local.runtime_secrets
      readonlyRootFilesystem = true
      linuxParameters = {
        initProcessEnabled = true
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition     = startswith(var.worker_image_uri, local.expected_ecr_prefix)
      error_message = "worker_image_uri must use the approved account-local ECR registry."
    }
  }
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  platform_version = "LATEST"

  network_configuration {
    subnets          = [for subnet in aws_subnet.app : subnet.id]
    security_groups  = [aws_security_group.runtime.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "ros-api"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false

  health_check_grace_period_seconds = 60

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "${var.name_prefix}-worker"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  platform_version = "LATEST"

  network_configuration {
    subnets          = [for subnet in aws_subnet.app : subnet.id]
    security_groups  = [aws_security_group.runtime.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false
}
