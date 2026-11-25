# Worker (.NET)

| Project | Contents |
|---|---|
| `src/MoneyTransfer.Core` | `MoneyTransferWorkflow` (`withdraw` → 10s pause → `deposit`), `TransferActivities` (placeholder steps: "Make API call here") |
| `src/MoneyTransfer.Worker` | Hosted worker: env config, Prometheus metrics, `/healthz` |
| `tests/MoneyTransfer.Tests` | Workflow, activity and idempotency tests, plus a simulated cross-region failover replay |

## Configuration (environment)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TEMPORAL_ADDRESS` | yes | | Regional Endpoint in Cloud, e.g. `us-east4.gcp.api.temporal.io:7233` |
| `TEMPORAL_NAMESPACE` | yes | | `<namespace>.<account>` |
| `TEMPORAL_API_KEY` | yes, unless `TEMPORAL_INSECURE=true` | | Worker service account key |
| `TEMPORAL_INSECURE` | no | `false` | `true` for a local dev server (no TLS, no key) |
| `REGION` | yes | | Reported in step results and as the `region` metric label |
| `TASK_QUEUE` | no | `money-transfer` | |
| `HTTP_PORT` | no | `8080` | `/healthz` |
| `METRICS_PORT` | no | `9464` | Prometheus `/metrics` (Temporal runtime exporter) |
| `TEMPORAL_LOG_LEVEL` | no | `Information` | Log level for `Temporalio` categories |

If a required variable is missing, the worker exits with code 2 and names the variable.

## Metrics

All series carry `region`. App counters:

- `transfers_started_total`, `transfers_completed_total`, `transfers_failed_total` (emitted from the workflow; replay-safe)
- `transfer_steps_total{step="withdraw"|"deposit"}` (emitted from activities)

The Temporal SDK's own metrics (`temporal_*`) are on the same endpoint.

## Local development

Requires the .NET 9 SDK and the `temporal` CLI.

```bash
# 1. Dev server
temporal server start-dev

# 2. Worker (in another terminal, from worker/)
TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default TEMPORAL_INSECURE=true REGION=local \
  dotnet run --project src/MoneyTransfer.Worker

# 3. A transfer
temporal workflow execute --type MoneyTransfer --task-queue money-transfer --workflow-id t-1 \
  --input '{"transferId":"t-1","fromAccount":"alice","toAccount":"bob","amount":10}'

# 4. Metrics
curl -s localhost:9464/metrics | grep ^transfer
```

Tests: `dotnet test` (downloads the Temporal test server on first run).

## Container

```bash
docker build -t money-transfer-worker:local .
docker run --rm -e TEMPORAL_ADDRESS=host.docker.internal:7233 -e TEMPORAL_NAMESPACE=default \
  -e TEMPORAL_INSECURE=true -e REGION=docker -p 9464:9464 -p 8080:8080 money-transfer-worker:local
```

To push to Artifact Registry, run `../scripts/build-push.sh <repo-url>` (see the main README).

## Design notes

- Workflow, activity and payload field names are pinned explicitly (`MoneyTransfer`, `Withdraw`, `Deposit`, camelCase JSON), so the TypeScript dashboard can start workflows.
- Each step is idempotent per `{transferId}-{step}` key. The bank lives in memory per process, so this is a demo simplification and isn't durable.
- When connecting through a Regional Endpoint, the worker also sends the `temporal-namespace` header so Temporal Cloud can route API-key requests.
