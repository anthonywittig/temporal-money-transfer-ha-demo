# Temporal Money Transfer: HA / DR Demo

Money transfers that keep running while a **Temporal Cloud** Namespace fails over between two **GCP** regions.

- **Workflow:** `withdraw` → pause (default 20s) → `deposit`, written in .NET.
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
| `infra/main/` | Terraform: Temporal Cloud namespace, service accounts and keys, Artifact Registry, per-region GKE and workers |
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

_Filled in as each part lands: bootstrap → Temporal Cloud → worker → GKE → dashboard._
