# The worker deployment for one region. The same image and settings run in every region;
# only the region and its Regional Endpoint differ.

terraform {
  required_providers {
    kubernetes = {
      source = "hashicorp/kubernetes"
    }
  }
}

variable "region" { type = string }
variable "regional_endpoint" { type = string }
variable "namespace_id" { type = string }
variable "image" { type = string }
variable "replicas" { type = number }
variable "api_key" {
  type      = string
  sensitive = true
}

locals {
  labels = { app = "money-transfer-worker" }
}

resource "kubernetes_namespace_v1" "demo" {
  metadata {
    name = "ha-demo"
  }
}

resource "kubernetes_secret_v1" "temporal" {
  metadata {
    name      = "temporal-worker"
    namespace = kubernetes_namespace_v1.demo.metadata[0].name
  }
  data = {
    TEMPORAL_API_KEY = var.api_key
  }
}

resource "kubernetes_deployment_v1" "worker" {
  metadata {
    name      = "money-transfer-worker"
    namespace = kubernetes_namespace_v1.demo.metadata[0].name
    labels    = local.labels
  }

  spec {
    replicas = var.replicas
    selector {
      match_labels = local.labels
    }

    template {
      metadata {
        labels = local.labels
      }

      spec {
        container {
          name  = "worker"
          image = var.image

          env {
            name  = "TEMPORAL_ADDRESS"
            value = var.regional_endpoint
          }
          env {
            name  = "TEMPORAL_NAMESPACE"
            value = var.namespace_id
          }
          env {
            name  = "REGION"
            value = var.region
          }
          env {
            name = "TEMPORAL_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.temporal.metadata[0].name
                key  = "TEMPORAL_API_KEY"
              }
            }
          }

          port {
            name           = "http"
            container_port = 8080
          }
          port {
            name           = "metrics"
            container_port = 9464
          }

          # Liveness must not depend on successful polls: a passive-region worker gets
          # NamespaceNotActive on every poll and must stay up as hot standby.
          liveness_probe {
            http_get {
              path = "/healthz"
              port = "http"
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }
            limits = {
              memory = "512Mi"
            }
          }
        }
      }
    }
  }
}

# Google Managed Prometheus scrapes the worker metrics every 5s.
resource "kubernetes_manifest" "pod_monitoring" {
  manifest = {
    apiVersion = "monitoring.googleapis.com/v1"
    kind       = "PodMonitoring"
    metadata = {
      name      = "money-transfer-worker"
      namespace = kubernetes_namespace_v1.demo.metadata[0].name
    }
    spec = {
      selector = { matchLabels = local.labels }
      endpoints = [{
        port     = "metrics"
        interval = "5s"
      }]
    }
  }
}
