terraform {
  required_version = ">= 1.6"

  # Partial config: pass the bucket at init time
  #   terraform init -backend-config="bucket=<state_bucket>"
  backend "gcs" {
    prefix = "main"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    temporalcloud = {
      source  = "temporalio/temporalcloud"
      version = ">= 1.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}

provider "google" {
  project = var.project_id
}

# Authenticates with TEMPORAL_CLOUD_API_KEY from the environment
# (an account-level key that can create namespaces and service accounts).
provider "temporalcloud" {}
