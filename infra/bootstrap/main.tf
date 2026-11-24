# Creates the GCS bucket that holds Terraform state for infra/main and infra/workloads.
# This root uses local state (git-ignored). It holds no secrets.

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "location" {
  type        = string
  default     = "US"
  description = "Bucket location"
}

provider "google" {
  project = var.project_id
}

resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "tfstate" {
  name                        = "${var.project_id}-ha-demo-tfstate"
  location                    = var.location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.storage]
}

output "state_bucket" {
  value = google_storage_bucket.tfstate.name
}
