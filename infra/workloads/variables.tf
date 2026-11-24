variable "state_bucket" {
  type        = string
  description = "GCS bucket holding infra/main state (output of infra/bootstrap)"
}

variable "worker_image" {
  type        = string
  description = "Full worker image reference, e.g. us-docker.pkg.dev/<project>/ha-demo/worker:<tag>"
}

variable "primary_region" {
  type    = string
  default = "gcp-us-east4"
}

variable "replica_region" {
  type    = string
  default = "gcp-us-central1"
}

variable "worker_replicas" {
  type    = number
  default = 2
}
