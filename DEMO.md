# Demo Run of Show (~10 min)

**Screens:** the dashboard (`http://localhost:3000`) on the left, and the Temporal Cloud UI on the right showing the namespace's workflows. Keep a terminal handy for the CLI failover backup.

## Before you go on (T–15 min)

- [ ] `temporal cloud namespace ha get ...` shows one active region, the replica **Activated**, and passive poller forwarding **disabled**
- [ ] `kubectl get pods -n ha-demo` is Ready in **both** clusters
- [ ] Dashboard is up. The badge shows the region you want to start from, and the failover button is enabled.
- [ ] If the active region isn't the one you want to start from, fail over now and wait for it to complete
- [ ] Start 10 transfers as a smoke test and watch them complete

## 1. Set the scene (2 min)

> "Here's a money transfer workflow: withdraw, a 20-second hold, then deposit. It runs on Temporal Cloud in **two GCP regions**, us-east4 and us-central1. The namespace is replicated asynchronously from the active region to the replica."

Point at the region cards:

> "We run identical .NET workers in a GKE cluster in **each** region. This is the *Active/Hot-Passive* pattern. The central workers are connected and warm, but Temporal only hands tasks to the region that's active. That's the *passive poller forwarding = disabled* setting."

## 2. Automatic vs manual failover (2 min, talk only)

- **Automatic:** Temporal Cloud watches its own health signals: reachability, RPC and persistence latency, error rates. If a region degrades, it fails the namespace over for you. The RTO target is 20 minutes and the RPO is under 1 minute. Once the region is healthy again, Temporal fails back automatically.
- **Manual:** you decide when. It's used for failover drills, region migrations, and outages that only *you* can see, like your own app tier going down. Temporal won't fail over for an outage it can't detect.
- *"Same mechanism either way. Today we press the button."*

## 3. Load (1 min)

Click **Start transfers** with 50.

> "Fifty transfers in flight. They all do their withdraw in us-east4 and then sit in their 20-second hold."

Point at the east line on the chart, and at the in-flight count of about 50.

## 4. Fail over (2 min)

Click **Fail over to gcp-us-central1** and read the confirmation aloud.

> "The badge goes amber while the failover runs. Temporal tries a graceful handoff first, draining replication and then switching."

Watch for:
- The badge flips to **gcp-us-central1**
- On the chart, the **east line drops to zero and the central line rises**. Those are the warm workers taking over with no restart and no config change.
- In-flight count drains to 0

## 5. Prove it (2 min)

In the Temporal Cloud UI, open any transfer and show the result:

```json
{ "withdraw": { "region": "gcp-us-east4" }, "deposit": { "region": "gcp-us-central1" } }
```

> "Started in one region, finished in the other. One withdraw, one deposit. Nothing lost, nothing doubled, and nobody touched the workers."

## 6. And back (1 min, optional)

Start another batch and click **Fail over to gcp-us-east4**. It's the same button in the other direction, and it's also how you reset the demo.

## If something goes wrong

| Symptom | Do |
|---|---|
| Failover button disabled ("replica not ready") | The replica is still syncing. Talk through slides and check again in a minute. |
| Button errors out | Fail over from the terminal: `temporal cloud namespace ha failover --namespace $NS --region <target>`. It asks you to confirm; add `--auto-confirm` to skip the prompt in scripts. |
| Charts empty or lagging | GMP lags 15–30s. Narrate from the badge and the in-flight count. |
| A pod is crash-looping | `kubectl -n ha-demo logs deploy/money-transfer-worker`. Standby pods log nothing after startup. Their polls are refused quietly. |
