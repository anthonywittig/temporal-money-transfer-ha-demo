# Dashboard

A local web app for running the demo. It does four things:

- Shows the **active region** and replica state (Cloud Ops API, failover key)
- Charts **transfer steps per second by region** (withdraws and deposits combined) (Google Managed Prometheus, through your `gcloud` ADC)
- Shows the **in-flight** transfer count (Temporal visibility, load key)
- Has **Start N transfers** (load key) and **Fail over to X** (failover key; clicking it fails over immediately, with no confirmation) buttons. Failover works in either direction.

All API keys stay in the local Node server. The browser only talks to `/api/*`.

## Run

```bash
# from the repo root, after infra/main has been applied
scripts/write-dashboard-env.sh            # writes dashboard/.env (git-ignored)
gcloud auth application-default login     # once, for metrics queries

cd dashboard
npm install
npm start                                 # builds the UI, then serves http://localhost:3000
```

If a required setting is missing, the server exits and names it. All settings are listed in `.env.example`.

## API

| Route | Does |
|---|---|
| `GET /api/state` | Active region, replicas, failover target, in-progress operation, and why failover is blocked (if it is) |
| `POST /api/failover` | Fails over to the other region. Returns 409 if the replica isn't ready or an operation is running. |
| `GET /api/failovers?window=600` | Failovers of the namespace from any source (Cloud UI, CLI, automatic), found through the audit log, with their start and finish times. Only when `TEMPORAL_AUDIT_API_KEY` is set; otherwise `{ enabled: false }` |
| `GET /api/metrics?window=600` | Per-region `rate(transfer_steps_total[10s])`, withdraws and deposits combined |
| `GET /api/inflight` | Count of running `MoneyTransfer` workflows |
| `POST /api/transfers {count}` | Starts 1–500 transfers (`transfer-<n>-<uuid>`), through the Namespace Endpoint, one per second (the request returns when the last has started). Each withdraws, waits 10 s, deposits |

Errors come back as `{ "error": "..." }` with a non-2xx status, and the UI shows them on the affected panel.

## Develop

```bash
npm test           # API tests against a fake Cloud Ops API
npm run typecheck
```

To try it without Temporal Cloud, run against a local dev server and a worker (see `worker/README.md`):

```bash
TEMPORAL_NAMESPACE=default TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_INSECURE=true \
TEMPORAL_FAILOVER_API_KEY=unused GCP_PROJECT_ID=unused npm start
```

Starting transfers and the in-flight count work in this mode. The region and metrics panels show errors, because there's no Cloud Ops API or GMP locally.
