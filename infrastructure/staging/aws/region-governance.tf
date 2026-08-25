# Hosting and pilot geography are deliberately separate concepts.
# The current temporary cloud staging slice is pinned to AWS Europe (Frankfurt), eu-central-1.
# Riyadh is the pilot geography, not the AWS hosting region.
#
# Each variable below is locked to its approved value with Terraform variable
# validation. Attempts to widen or relabel this boundary therefore fail during
# Terraform input validation rather than becoming review-only warnings.

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
  description = "Jurisdiction of the currently selected AWS staging region. eu-central-1 is Europe (Frankfurt), Germany / European Union."
  type        = string
  default     = "Germany / European Union"

  validation {
    condition     = var.cloud_jurisdiction == "Germany / European Union"
    error_message = "eu-central-1 must be represented as Germany / European Union; it must not be labeled Riyadh or Saudi Arabia."
  }
}

variable "saudi_hosted" {
  description = "Whether this exact cloud staging slice is hosted in Saudi Arabia. Must remain false for eu-central-1."
  type        = bool
  default     = false

  validation {
    condition     = var.saudi_hosted == false
    error_message = "eu-central-1 is not Saudi-hosted. A Saudi-hosted claim requires a separately reviewed in-jurisdiction Saudi deployment."
  }
}

variable "staging_data_classification" {
  description = "Maximum data class allowed in the temporary Frankfurt staging slice."
  type        = string
  default     = "SYNTHETIC_NON_SENSITIVE_ONLY"

  validation {
    condition     = var.staging_data_classification == "SYNTHETIC_NON_SENSITIVE_ONLY"
    error_message = "Temporary Frankfurt staging is limited to SYNTHETIC_NON_SENSITIVE_ONLY data."
  }
}

variable "real_incident_data_allowed" {
  description = "Whether real incident/evidence/medical/legal or other sensitive operational data may enter this staging slice."
  type        = bool
  default     = false

  validation {
    condition     = var.real_incident_data_allowed == false
    error_message = "Real incident/evidence/medical/legal data is forbidden in the temporary Frankfurt staging slice."
  }
}
