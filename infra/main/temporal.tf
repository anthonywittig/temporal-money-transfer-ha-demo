# HA namespace: both regions must be declared at creation time. The provider cannot add a
# region to an existing namespace, and it ignores region order changes caused by failovers.
resource "temporalcloud_namespace" "ns" {
  name           = var.namespace_name
  regions        = [var.primary_region, var.replica_region]
  api_key_auth   = true
  retention_days = var.retention_days
}

locals {
  namespace_id = temporalcloud_namespace.ns.id
  # Namespace Endpoint: CNAME to whichever region is active.
  namespace_endpoint = "${temporalcloud_namespace.ns.id}.tmprl.cloud:7233"
}

# --- Service accounts: one per role, least privilege -------------------------------------

resource "temporalcloud_service_account" "worker" {
  name           = "${var.namespace_name}-worker"
  account_access = "read"
  namespace_accesses = [{
    namespace_id = local.namespace_id
    permission   = "write"
  }]
}

resource "temporalcloud_service_account" "load" {
  name           = "${var.namespace_name}-load"
  account_access = "read"
  namespace_accesses = [{
    namespace_id = local.namespace_id
    permission   = "write"
  }]
}

# Failover needs FailoverNamespaceRegion. Among built-in permissions only Namespace Admin
# grants it; with failover_custom_role = true a Custom Role grants just what the dashboard
# needs. (GetAsyncOperation is already covered by the account Read role.)
resource "temporalcloud_custom_role" "failover" {
  count       = var.failover_custom_role ? 1 : 0
  name        = "${var.namespace_name}-failover"
  description = "Read the HA namespace and trigger failovers"
  permissions = [{
    actions = ["cloud.namespace.get", "cloud.namespace.failoverRegion"]
    resources = {
      resource_type = "namespaces"
      resource_ids  = [local.namespace_id]
      allow_all     = false
    }
  }]
}

resource "temporalcloud_service_account" "failover" {
  name                        = "${var.namespace_name}-failover"
  account_access              = "read"
  account_access_custom_roles = var.failover_custom_role ? [temporalcloud_custom_role.failover[0].id] : null
  namespace_accesses = var.failover_custom_role ? null : [{
    namespace_id = local.namespace_id
    permission   = "admin"
  }]
}

resource "time_offset" "key_expiry" {
  offset_hours = var.api_key_ttl_hours
}

resource "temporalcloud_apikey" "worker" {
  display_name = "${var.namespace_name}-worker"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.worker.id
  expiry_time  = time_offset.key_expiry.rfc3339
}

resource "temporalcloud_apikey" "load" {
  display_name = "${var.namespace_name}-load"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.load.id
  expiry_time  = time_offset.key_expiry.rfc3339
}

resource "temporalcloud_apikey" "failover" {
  display_name = "${var.namespace_name}-failover"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.failover.id
  expiry_time  = time_offset.key_expiry.rfc3339
}

# --- HA settings the provider does not manage ---------------------------------------------

# Disables passive poller forwarding (Active/Hot-Passive). Idempotent; reruns if the
# namespace is recreated. Uses TEMPORAL_CLOUD_API_KEY from the environment.
resource "terraform_data" "ha_settings" {
  triggers_replace = [local.namespace_id]

  provisioner "local-exec" {
    command = "${path.module}/../../scripts/ha-settings.sh ${local.namespace_id}"
  }
}

resource "temporalcloud_namespace_tags" "ns" {
  count        = length(var.namespace_tags) > 0 ? 1 : 0
  namespace_id = local.namespace_id
  tags         = var.namespace_tags
}
