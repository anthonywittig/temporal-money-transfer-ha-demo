output "project_id" {
  value = var.project_id
}

output "namespace_id" {
  value = local.namespace_id
}

output "namespace_endpoint" {
  value = local.namespace_endpoint
}

output "image_repository" {
  value = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

# Temporal region -> { gcp_region, cluster, endpoint, ca, regional_endpoint }
output "regions" {
  value = {
    for temporal_region, gcp_region in local.gcp_regions : temporal_region => {
      gcp_region        = gcp_region
      cluster_name      = google_container_cluster.region[temporal_region].name
      cluster_endpoint  = google_container_cluster.region[temporal_region].endpoint
      cluster_ca        = google_container_cluster.region[temporal_region].master_auth[0].cluster_ca_certificate
      regional_endpoint = "${gcp_region}.gcp.api.temporal.io:7233"
    }
  }
}

output "worker_api_key" {
  value     = temporalcloud_apikey.worker.token
  sensitive = true
}

output "load_api_key" {
  value     = temporalcloud_apikey.load.token
  sensitive = true
}

output "failover_api_key" {
  value     = temporalcloud_apikey.failover.token
  sensitive = true
}

output "cutover_dashboard_url" {
  description = "Cloud Monitoring dashboard showing work moving between regions during a failover"
  value       = "https://console.cloud.google.com/monitoring/dashboards/custom/${element(split("/", google_monitoring_dashboard.cutover.id), 3)}?project=${var.project_id}"
}
