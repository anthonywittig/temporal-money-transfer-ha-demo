module "primary" {
  source    = "./modules/region-workers"
  providers = { kubernetes = kubernetes.primary }

  region            = var.primary_region
  regional_endpoint = local.primary.regional_endpoint
  namespace_id      = local.main.namespace_id
  api_key           = local.main.worker_api_key
  image             = var.worker_image
  replicas          = var.worker_replicas
}

module "replica" {
  source    = "./modules/region-workers"
  providers = { kubernetes = kubernetes.replica }

  region            = var.replica_region
  regional_endpoint = local.replica.regional_endpoint
  namespace_id      = local.main.namespace_id
  api_key           = local.main.worker_api_key
  image             = var.worker_image
  replicas          = var.worker_replicas
}
