locals {
  # `.internal` is reserved for private-use naming and must not be presented as a
  # public or Saudi-hosted DNS boundary. This name exists only inside the ROS
  # temporary Frankfurt staging VPC.
  private_dns_zone_name = "ros-staging.internal"
  api_private_fqdn      = "api.ros-staging.internal"
}

resource "aws_route53_zone" "staging_private" {
  name    = local.private_dns_zone_name
  comment = "ROS temporary Frankfurt synthetic-only staging private DNS"

  vpc {
    vpc_id = aws_vpc.staging.id
  }

  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.staging_private.zone_id
  name    = local.api_private_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.internal.dns_name
    zone_id                = aws_lb.internal.zone_id
    evaluate_target_health = true
  }
}

# The executable PLAN_ONLY package must bind the exact supplied ARN to one
# unambiguous, ISSUED imported certificate for the private ROS staging server
# name. If no matching certificate exists, if more than one matches, or if the
# selected ARN differs, Terraform fails closed before a truthful plan can pass.
data "aws_acm_certificate" "staging_alb" {
  domain      = local.api_private_fqdn
  statuses    = ["ISSUED"]
  types       = ["IMPORTED"]
  most_recent = false
}

resource "terraform_data" "tls_certificate_contract" {
  input = {
    server_name     = local.api_private_fqdn
    certificate_arn = var.tls_certificate_arn
  }

  lifecycle {
    precondition {
      condition     = data.aws_acm_certificate.staging_alb.arn == var.tls_certificate_arn
      error_message = "tls_certificate_arn must identify the single ISSUED imported ACM certificate for api.ros-staging.internal in the approved Frankfurt account/region."
    }
  }
}
