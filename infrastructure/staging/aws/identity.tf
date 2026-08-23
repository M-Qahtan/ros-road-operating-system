variable "oidc_issuer" {
  description = "Approved HTTPS issuer for ROS staging OIDC. DNS/routing must resolve through the reviewed private identity path."
  type        = string

  validation {
    condition     = can(regex("^https://[^/@:]+(?::[0-9]+)?(?:/.*)?$", var.oidc_issuer))
    error_message = "oidc_issuer must be a credential-free HTTPS URL."
  }
}

variable "oidc_jwks_url" {
  description = "Approved HTTPS JWKS URL reachable through reviewed private connectivity."
  type        = string

  validation {
    condition     = can(regex("^https://[^/@:]+(?::[0-9]+)?(?:/.*)?$", var.oidc_jwks_url))
    error_message = "oidc_jwks_url must be a credential-free HTTPS URL."
  }
}

variable "oidc_audience" {
  description = "Exact OIDC audience accepted by ROS staging."
  type        = string

  validation {
    condition     = length(trimspace(var.oidc_audience)) >= 3 && length(var.oidc_audience) <= 256
    error_message = "oidc_audience must contain 3-256 characters."
  }
}

variable "oidc_allowed_bindings" {
  description = "Explicit client/tenant/purpose bindings accepted by ROS staging."
  type = list(object({
    clientId = string
    tenantId = string
    purpose  = string
  }))

  validation {
    condition = (
      length(var.oidc_allowed_bindings) >= 1 &&
      length(var.oidc_allowed_bindings) <= 64 &&
      alltrue([
        for binding in var.oidc_allowed_bindings :
        length(trimspace(binding.clientId)) > 0 &&
        length(trimspace(binding.tenantId)) > 0 &&
        contains([
          "INCIDENT_TRIAGE",
          "EMERGENCY_COORDINATION",
          "TRAFFIC_COORDINATION",
          "INSURANCE_COORDINATION",
          "TOWING_COORDINATION",
          "ROUTE_COORDINATION"
        ], binding.purpose)
      ]) &&
      length(distinct([
        for binding in var.oidc_allowed_bindings :
        jsonencode([binding.clientId, binding.tenantId, binding.purpose])
      ])) == length(var.oidc_allowed_bindings)
    )
    error_message = "oidc_allowed_bindings must contain 1-64 unique supported client/tenant/purpose bindings."
  }
}

variable "identity_private_cidr" {
  description = "Reviewed private CIDR containing the staging OIDC/JWKS endpoint. Never use 0.0.0.0/0."
  type        = string

  validation {
    condition = (
      can(cidrhost(var.identity_private_cidr, 0)) &&
      var.identity_private_cidr != "0.0.0.0/0" &&
      can(regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)", var.identity_private_cidr))
    )
    error_message = "identity_private_cidr must be an RFC1918 IPv4 CIDR and may not be 0.0.0.0/0."
  }
}

variable "identity_private_connectivity_review_reference" {
  description = "Human-reviewed reference proving the OIDC/JWKS path is private and approved."
  type        = string

  validation {
    condition     = length(trimspace(var.identity_private_connectivity_review_reference)) >= 6
    error_message = "identity_private_connectivity_review_reference is required."
  }
}

resource "aws_vpc_security_group_egress_rule" "runtime_to_private_identity" {
  security_group_id = aws_security_group.runtime.id
  cidr_ipv4         = var.identity_private_cidr
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "ROS runtime to reviewed private OIDC/JWKS endpoint"
}
