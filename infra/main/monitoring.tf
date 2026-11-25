# Cloud Monitoring dashboard: shows the failover cutover in the GCP console, from the worker
# metrics Google Managed Prometheus already collects. Each chart is split by region, so during a
# failover the lines swap from one region to the other.
#
# Label note: GMP reserves `namespace` for the Kubernetes namespace (ha-demo), so the Temporal
# namespace label the workers emit arrives as `exported_namespace`.

locals {
  metric_filter = "namespace=\"ha-demo\", exported_namespace=\"${local.namespace_id}\""

  cutover_charts = [
    {
      title = "Transfer steps per second, by region"
      query = "sum by (region) (rate(transfer_steps_total{${local.metric_filter}}[30s]))"
    },
    {
      title = "Withdraws and deposits per second, by region"
      query = "sum by (region, step) (rate(transfer_steps_total{${local.metric_filter}}[30s]))"
    },
    {
      title = "Activities executed per second, by region (Temporal SDK)"
      query = "sum by (region) (rate(temporal_activity_execution_latency_count{${local.metric_filter}}[30s]))"
    },
    {
      title = "Workflow tasks received per second, by region (Temporal SDK)"
      query = "sum by (region) (rate(temporal_workflow_task_queue_poll_succeed_total{${local.metric_filter}}[30s]))"
    },
  ]
}

resource "google_monitoring_dashboard" "cutover" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "HA demo: ${var.namespace_name} failover"
    mosaicLayout = {
      columns = 12
      tiles = concat(
        [{
          xPos   = 0
          yPos   = 0
          width  = 12
          height = 2
          widget = {
            title = "How to read this"
            text = {
              format  = "MARKDOWN"
              content = "Active/Hot-Passive: workers run in both regions, but only the namespace's **active** region gets tasks. During a failover, every line moves from the old region to the new one. Metrics come from the .NET workers through Google Managed Prometheus."
            }
          }
        }],
        [for i, c in local.cutover_charts : {
          xPos   = (i % 2) * 6
          yPos   = 2 + floor(i / 2) * 4
          width  = 6
          height = 4
          widget = {
            title = c.title
            xyChart = {
              dataSets = [{
                plotType        = "LINE"
                timeSeriesQuery = { prometheusQuery = c.query }
              }]
              yAxis = { scale = "LINEAR" }
            }
          }
        }],
      )
    }
  })

  depends_on = [google_project_service.apis]
}
