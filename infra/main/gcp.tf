data "google_project" "this" {}

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
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

# --- Network: a dedicated VPC (the demo does not rely on a "default" network) -------------

locals {
  # Non-overlapping ranges per region: node subnet, pods, services.
  subnet_index = { for i, r in sort(keys(local.gcp_regions)) : r => i }
}

resource "google_compute_network" "demo" {
  name                    = "ha-demo"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "region" {
  for_each = local.gcp_regions

  name          = "ha-demo-${each.value}"
  region        = each.value
  network       = google_compute_network.demo.id
  ip_cidr_range = "10.${10 + local.subnet_index[each.key]}.0.0/20"

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.${100 + local.subnet_index[each.key]}.0.0/16"
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.${200 + local.subnet_index[each.key]}.0.0/20"
  }
}

# Private nodes reach Temporal Cloud and Artifact Registry through Cloud NAT.
resource "google_compute_router" "region" {
  for_each = local.gcp_regions

  name    = "ha-demo-${each.value}"
  region  = each.value
  network = google_compute_network.demo.id
}

resource "google_compute_router_nat" "region" {
  for_each = local.gcp_regions

  name                               = "ha-demo-${each.value}"
  router                             = google_compute_router.region[each.key].name
  region                             = each.value
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# --- GKE ------------------------------------------------------------------------------------

# One GKE Autopilot cluster per Temporal region. Autopilot enables Google Managed
# Prometheus collection by default, so PodMonitoring resources just work.
resource "google_container_cluster" "region" {
  for_each = local.gcp_regions

  name                = "ha-demo-${each.value}"
  location            = each.value
  enable_autopilot    = true
  deletion_protection = false

  network    = google_compute_network.demo.id
  subnetwork = google_compute_subnetwork.region[each.key].id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Private nodes, public control plane (so kubectl/Terraform can reach it).
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
  }

  depends_on = [google_project_service.apis, google_compute_router_nat.region]
}
