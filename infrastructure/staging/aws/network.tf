data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_prefix_list" "s3" {
  name = "com.amazonaws.${var.aws_region}.s3"
}

locals {
  selected_azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
  az_index     = { for index, az in local.selected_azs : az => index }

  interface_endpoint_services = toset([
    "ecr.api",
    "ecr.dkr",
    "logs",
    "secretsmanager",
    "kms",
    "sts"
  ])
}

resource "aws_vpc" "staging" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.name_prefix}-vpc"
  }
}

resource "aws_subnet" "app" {
  for_each = local.az_index

  vpc_id                  = aws_vpc.staging.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value)
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.name_prefix}-app-${each.key}"
    Tier = "application"
  }
}

resource "aws_subnet" "data" {
  for_each = local.az_index

  vpc_id                  = aws_vpc.staging.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value + 8)
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.name_prefix}-data-${each.key}"
    Tier = "data"
  }
}

resource "aws_route_table" "app" {
  for_each = local.az_index

  vpc_id = aws_vpc.staging.id

  tags = {
    Name = "${var.name_prefix}-app-${each.key}"
    Tier = "application"
  }
}

resource "aws_route_table" "data" {
  for_each = local.az_index

  vpc_id = aws_vpc.staging.id

  tags = {
    Name = "${var.name_prefix}-data-${each.key}"
    Tier = "data"
  }
}

resource "aws_route_table_association" "app" {
  for_each = local.az_index

  subnet_id      = aws_subnet.app[each.key].id
  route_table_id = aws_route_table.app[each.key].id
}

resource "aws_route_table_association" "data" {
  for_each = local.az_index

  subnet_id      = aws_subnet.data[each.key].id
  route_table_id = aws_route_table.data[each.key].id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.staging.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids = concat(
    [for route_table in aws_route_table.app : route_table.id],
    [for route_table in aws_route_table.data : route_table.id]
  )

  tags = {
    Name = "${var.name_prefix}-s3"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoint_services

  vpc_id              = aws_vpc.staging.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [for subnet in aws_subnet.app : subnet.id]
  security_group_ids  = [aws_security_group.vpc_endpoints.id]

  tags = {
    Name = "${var.name_prefix}-${replace(each.value, ".", "-")}"
  }
}
