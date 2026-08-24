# Hosting and pilot geography are deliberately separate concepts.
# The current cloud staging slice is pinned to AWS Middle East (UAE), me-central-1.
# Riyadh is the pilot geography, not the AWS hosting region.

variable "pilot_geography" {
  description = "Operational pilot geography. This does not make the cloud environment Saudi-hosted."
  type        = string
  default     = "Riyadh, Saudi Arabia"

  validation {
    condition     = var.pilot_geography == "Riyadh, Saudi Arabia"
    error_message = "The controlled pilot geography must remain Riyadh, Saudi Arabia unless separately governed."
  }
}

variable "cloud_jurisdiction" {
  description = "Jurisdiction of the currently selected AWS staging region. me-central-1 is Middle East (UAE)."
  type        = string
  default     = "United Arab Emirates"

  validation {
    condition     = var.cloud_jurisdiction == "United Arab Emirates"
    error_message = "me-central-1 must be represented as United Arab Emirates; it must not be labeled Riyadh or Saudi Arabia."
  }
}

variable "saudi_hosted" {
  description = "Whether this exact cloud staging slice is hosted in Saudi Arabia. Must remain false for me-central-1."
  type        = bool
  default     = false

  validation {
    condition     = var.saudi_hosted == false
    error_message = "me-central-1 is not Saudi-hosted. A Saudi-hosted claim requires a separately reviewed Saudi-region deployment."
  }
}

variable "staging_data_classification" {
  description = "Maximum data class allowed in the temporary UAE staging slice."
  type        = string
  default     = "SYNTHETIC_NON_SENSITIVE_ONLY"

  validation {
    condition     = var.staging_data_classification == "SYNTHETIC_NON_SENSITIVE_ONLY"
    error_message = "Temporary UAE staging is limited to SYNTHETIC_NON_SENSITIVE_ONLY data."
  }
}

variable "real_incident_data_allowed" {
  description = "Whether real incident/evidence/medical/legal or other sensitive operational data may enter this staging slice."
  type        = bool
  default     = false

  validation {
    condition     = var.real_incident_data_allowed == false
    error_message = "Real incident/evidence/medical/legal data is forbidden in the temporary UAE staging slice."
  }
}

check "staging_region_governance" {
  assert {
    condition = (
      var.aws_region == "me-central-1" &&
      var.pilot_geography == "Riyadh, Saudi Arabia" &&
      var.cloud_jurisdiction == "United Arab Emirates" &&
      var.saudi_hosted == false &&
      var.staging_data_classification == "SYNTHETIC_NON_SENSITIVE_ONLY" &&
      var.real_incident_data_allowed == false
    )
    error_message = "ROS staging governance mismatch: Riyadh is the pilot geography; me-central-1 is UAE cloud staging and may contain synthetic/non-sensitive data only."
  }
}
