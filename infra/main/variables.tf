variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "namespace_name" {
  type        = string
  default     = "ha-money-transfer"
  description = "Temporal Cloud namespace name (the account suffix is added by Temporal)"
}

variable "primary_region" {
  type        = string
  default     = "gcp-us-east4"
  description = "Temporal Cloud region that starts as active. Must be a GCP region that supports Multi-region Replication with replica_region."
}

variable "replica_region" {
  type        = string
  default     = "gcp-us-central1"
  description = "Temporal Cloud replica region"
}

variable "retention_days" {
  type    = number
  default = 7
}

variable "api_key_ttl_hours" {
  type        = number
  default     = 2160 # 90 days
  description = "Lifetime of the generated service-account API keys"
}
