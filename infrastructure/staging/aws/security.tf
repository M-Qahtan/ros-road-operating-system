resource "aws_security_group" "alb" {
  name_prefix            = "${var.name_prefix}-alb-"
  description            = "ROS staging internal ALB"
  vpc_id                 = aws_vpc.staging.id
  revoke_rules_on_delete = true

  tags = {
    Name = "${var.name_prefix}-alb"
  }
}

resource "aws_security_group" "runtime" {
  name_prefix            = "${var.name_prefix}-runtime-"
  description            = "ROS staging ECS runtime"
  vpc_id                 = aws_vpc.staging.id
  revoke_rules_on_delete = true

  tags = {
    Name = "${var.name_prefix}-runtime"
  }
}

resource "aws_security_group" "database" {
  name_prefix            = "${var.name_prefix}-postgres-"
  description            = "ROS staging PostgreSQL"
  vpc_id                 = aws_vpc.staging.id
  revoke_rules_on_delete = true

  tags = {
    Name = "${var.name_prefix}-postgres"
  }
}

resource "aws_security_group" "redis" {
  name_prefix            = "${var.name_prefix}-redis-"
  description            = "ROS staging Redis"
  vpc_id                 = aws_vpc.staging.id
  revoke_rules_on_delete = true

  tags = {
    Name = "${var.name_prefix}-redis"
  }
}

resource "aws_security_group" "vpc_endpoints" {
  name_prefix            = "${var.name_prefix}-vpce-"
  description            = "ROS staging interface VPC endpoints"
  vpc_id                 = aws_vpc.staging.id
  revoke_rules_on_delete = true

  tags = {
    Name = "${var.name_prefix}-vpce"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "Controlled VPC/VPN clients only"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_runtime" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.runtime.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
  description                  = "HTTPS listener to ROS API target"
}

resource "aws_vpc_security_group_ingress_rule" "runtime_from_alb" {
  security_group_id            = aws_security_group.runtime.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
  description                  = "ROS API traffic from internal ALB"
}

resource "aws_vpc_security_group_egress_rule" "runtime_to_database" {
  security_group_id            = aws_security_group.runtime.id
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "ROS runtime to PostgreSQL"
}

resource "aws_vpc_security_group_egress_rule" "runtime_to_redis" {
  security_group_id            = aws_security_group.runtime.id
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "ROS runtime to Redis over TLS"
}

resource "aws_vpc_security_group_egress_rule" "runtime_to_interface_endpoints" {
  security_group_id            = aws_security_group.runtime.id
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "ROS runtime to AWS private endpoints"
}

resource "aws_vpc_security_group_egress_rule" "runtime_to_s3" {
  security_group_id = aws_security_group.runtime.id
  prefix_list_id    = data.aws_prefix_list.s3.id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "ROS runtime to S3 through gateway endpoint"
}

resource "aws_vpc_security_group_egress_rule" "runtime_dns_udp" {
  security_group_id = aws_security_group.runtime.id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 53
  to_port           = 53
  ip_protocol       = "udp"
  description       = "VPC DNS"
}

resource "aws_vpc_security_group_egress_rule" "runtime_dns_tcp" {
  security_group_id = aws_security_group.runtime.id
  cidr_ipv4         = var.vpc_cidr
  from_port         = 53
  to_port           = 53
  ip_protocol       = "tcp"
  description       = "VPC DNS fallback"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_runtime" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.runtime.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL only from ROS runtime"
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_runtime" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.runtime.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Redis only from ROS runtime"
}

resource "aws_vpc_security_group_ingress_rule" "endpoint_https_from_runtime" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  referenced_security_group_id = aws_security_group.runtime.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "AWS private endpoint access from ROS runtime"
}
