terraform {
  required_version = ">= 1.10.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      ManagedBy  = "Terraform"
      Project    = "ROS"
      Repository = "${var.repository_owner}/${var.repository_name}"
      Control    = "REL-013"
    })
  }
}
