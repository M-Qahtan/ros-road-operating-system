terraform {
  required_version = "= 1.15.8"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.61.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.0"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.expected_aws_account_id]

  default_tags {
    tags = merge(var.tags, {
      ManagedBy               = "Terraform"
      Project                 = "ROS"
      Environment             = "staging"
      Repository              = "${var.repository_owner}/${var.repository_name}"
      Control                 = "PLAN_ONLY"
      PilotGeography          = var.pilot_geography
      CloudJurisdiction       = var.cloud_jurisdiction
      SaudiHosted             = tostring(var.saudi_hosted)
      DataClassification      = var.staging_data_classification
      RealIncidentDataAllowed = tostring(var.real_incident_data_allowed)
    })
  }
}
