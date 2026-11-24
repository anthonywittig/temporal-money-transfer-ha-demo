# Temporal Money Transfer: HA / DR Demo

Money transfers that keep running while a **Temporal Cloud** Namespace fails over between two **GCP** regions.

- **Workflow:** `withdraw` → pause (default 60s) → `deposit`, written in .NET.
- **Workers:** the same .NET image in a GKE cluster in each region. They use the **Active/Hot-Passive** pattern: each fleet connects to its own region's Regional Endpoint, and passive poller forwarding is disabled, so only the active region's workers process tasks.
- **Failover:** one button on a local TypeScript dashboard calls the Cloud Ops API. It works in either direction.
- **Metrics:** workers expose Prometheus metrics, Google Managed Prometheus collects them, and the dashboard charts them.
- **Infra:** Terraform for the Temporal Cloud HA Namespace, service accounts and API keys, GKE, Artifact Registry and GMP.

## Architecture

```
                 Temporal Cloud Namespace (API key auth, public connectivity)
   +----------------------------------------------------------------------+
   |  gcp-us-east4 (ACTIVE)  ===== async replication =====>  gcp-us-central1 (PASSIVE)  |
   +----------------------------------------------------------------------+
            ^ regional endpoint                          ^ regional endpoint
            |                                            |
   +--------+----------+                       +---------+---------+
   | GKE us-east4      |                       | GKE us-central1   |
   |  .NET workers     |  <-- busy             |  .NET workers     |  <-- hot standby
   |  /metrics         |                       |  /metrics         |      (NamespaceNotActive)
   +--------+----------+                       +---------+---------+
            |          Google Managed Prometheus         |
            +-------------------+  +---------------------+
                                v  v
                  +------------------------------+
                  | Dashboard (runs locally)     |
                  |  active region | throughput  |
                  |  [Start N] [Fail over to X]  |
                  +------------------------------+
```

After a failover, the roles swap: central becomes busy, east goes on standby, and in-flight transfers finish in central.

## Repository layout

| Path | What |
|---|---|
| `infra/bootstrap/` | Terraform: GCS bucket for remote state |
| `infra/main/` | Terraform: Temporal Cloud HA namespace, service accounts and API keys, Artifact Registry, one GKE Autopilot cluster per region |
| `infra/workloads/` | Terraform: worker Deployment, API key Secret and GMP PodMonitoring in each cluster |
| `worker/` | .NET solution: workflow, activities, worker host, tests |
| `dashboard/` | TypeScript: local API server and web UI |
| `scripts/` | Helper scripts (HA settings, image build/push, dashboard env) |
| `DEMO.md` | Talk track and run of show |

## Prerequisites

- A Temporal Cloud account and an API key for a user or service account that can create namespaces (Account Owner, Global Admin or Developer role)
- A GCP project with billing enabled
- [`gcloud`](https://cloud.google.com/sdk/docs/install) logged in (`gcloud auth login` and `gcloud auth application-default login`)
- [`terraform`](https://developer.hashicorp.com/terraform/install) 1.6 or newer
- [`temporal`](https://docs.temporal.io/cli) CLI with the cloud extension (`temporal cloud`)
- Docker, `kubectl` and `gke-gcloud-auth-plugin`
- .NET SDK 9 and Node.js 22 (see `.tool-versions`)

## Secrets

This repo is public. Terraform state contains API key tokens, so it lives in a GCS bucket and is never stored locally in the repo. `.env*` and `*.tfvars` files are git-ignored, and gitleaks runs in CI. An optional local pre-commit hook is available: `pre-commit install`.

## Setup

> Status: the worker and dashboard have been verified locally. The cloud steps below haven't yet been run end to end. See the OpenSpec tasks for what's left.

```bash
export PROJECT_ID=my-gcp-project
export TEMPORAL_CLOUD_API_KEY=...        # account-level key that can create namespaces

# 1. Remote state bucket (local state, no secrets)
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply -var project_id=$PROJECT_ID
export STATE_BUCKET=$(terraform -chdir=infra/bootstrap output -raw state_bucket)

# 2. Temporal Cloud namespace, service accounts and keys, Artifact Registry, GKE clusters
#    (also runs scripts/ha-settings.sh to disable passive poller forwarding)
terraform -chdir=infra/main init -backend-config="bucket=$STATE_BUCKET"
terraform -chdir=infra/main apply -var project_id=$PROJECT_ID
temporal cloud namespace ha get --api-key "$TEMPORAL_CLOUD_API_KEY" \
  --namespace "$(terraform -chdir=infra/main output -raw namespace_id)"
#    -> one active region, replica Activated, passive poller forwarding disabled

# 3. Worker image
IMAGE=$(scripts/build-push.sh "$(terraform -chdir=infra/main output -raw image_repository)" | tail -1)

# 4. Workers in both regions (Deployment, Secret, PodMonitoring)
terraform -chdir=infra/workloads init -backend-config="bucket=$STATE_BUCKET"
terraform -chdir=infra/workloads apply -var state_bucket=$STATE_BUCKET -var worker_image=$IMAGE

# 5. Dashboard
scripts/write-dashboard-env.sh
gcloud auth application-default login
(cd dashboard && npm install && npm start)   # http://localhost:3000
```

Replication for a new namespace can take a few minutes. The dashboard disables the failover button until the replica is ready.

## Failover from the CLI (backup for the dashboard button)

```bash
NS=$(terraform -chdir=infra/main output -raw namespace_id)
temporal cloud namespace ha get --api-key "$TEMPORAL_CLOUD_API_KEY" --namespace "$NS"
temporal cloud namespace ha failover --api-key "$TEMPORAL_CLOUD_API_KEY" --namespace "$NS" --region gcp-us-central1
# It prompts for confirmation. In scripts, add --auto-confirm or the command waits forever.
```

## Teardown

```bash
terraform -chdir=infra/workloads destroy -var state_bucket=$STATE_BUCKET -var worker_image=unused
terraform -chdir=infra/main destroy -var project_id=$PROJECT_ID
terraform -chdir=infra/bootstrap destroy -var project_id=$PROJECT_ID
```

This removes the clusters, namespace, service accounts, keys, registry and state bucket.
