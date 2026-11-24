terraform {
  required_version = ">= 1.6"

  # terraform init -backend-config="bucket=<state_bucket>"
  backend "gcs" {
    prefix = "workloads"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
  }
}

data "terraform_remote_state" "main" {
  backend = "gcs"
  config = {
    bucket = var.state_bucket
    prefix = "main"
  }
}

data "google_client_config" "current" {}

locals {
  main    = data.terraform_remote_state.main.outputs
  primary = local.main.regions[var.primary_region]
  replica = local.main.regions[var.replica_region]
}

# One Kubernetes provider per regional cluster. The clusters already exist (infra/main),
# so these can be configured at plan time.
provider "kubernetes" {
  alias                  = "primary"
  host                   = "https://${local.primary.cluster_endpoint}"
  cluster_ca_certificate = base64decode(local.primary.cluster_ca)
  token                  = data.google_client_config.current.access_token
}

provider "kubernetes" {
  alias                  = "replica"
  host                   = "https://${local.replica.cluster_endpoint}"
  cluster_ca_certificate = base64decode(local.replica.cluster_ca)
  token                  = data.google_client_config.current.access_token
}
