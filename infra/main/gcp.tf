data "google_project" "this" {}

resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "monitoring.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "images" {
  location      = "us"
  repository_id = "ha-demo"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# Autopilot nodes pull images as the default compute service account.
resource "google_artifact_registry_repository_iam_member" "node_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}

locals {
  # Temporal region code (gcp-us-east4) -> GCP region (us-east4)
  gcp_regions = {
    for r in [var.primary_region, var.replica_region] : r => trimprefix(r, "gcp-")
  }
}

# One GKE Autopilot cluster per Temporal region. Autopilot enables Google Managed
# Prometheus collection by default, so PodMonitoring resources just work.
resource "google_container_cluster" "region" {
  for_each = local.gcp_regions

  name                = "ha-demo-${each.value}"
  location            = each.value
  enable_autopilot    = true
  deletion_protection = false

  depends_on = [google_project_service.apis]
}
