# Demo Run of Show (~10 min)

**Screens:** the dashboard (`http://localhost:3000`) on the left, and the Temporal Cloud UI on the right showing the namespace's workflows. Keep a terminal handy for the CLI failover backup.

## Before you go on (T–15 min)

- [ ] `temporal cloud namespace ha get ...` shows one active region, the replica **Activated**, and passive poller forwarding **disabled**
- [ ] `kubectl get pods -n ha-demo` is Ready in **both** clusters
- [ ] Dashboard is up. The badge shows the region you want to start from, and the failover button is enabled.
- [ ] If the active region isn't the one you want to start from, fail over now and wait for it to complete
- [ ] Start 10 transfers as a smoke test and watch them complete (about 10s, with holds of 1–10s)

## 1. Set the scene (2 min)

> "Here's a money transfer workflow: a hold, withdraw, another hold, then deposit. Each transfer in a batch gets a different total hold, split evenly between the two waits: 1 second for the first, 2 for the second, and so on, so both steps run as a steady stream instead of all at once. The workflow ID carries the hold: `transfer-<seconds>-<uuid>`. It runs on Temporal Cloud in **two GCP regions**, us-east4 and us-central1. The namespace is replicated asynchronously from the active region to the replica."

Point at the region cards:

> "We run identical .NET workers in a GKE cluster in **each** region. This is the *Active/Hot-Passive* pattern. The central workers are connected and warm, but Temporal only hands tasks to the region that's active. That's the *passive poller forwarding = disabled* setting."

## 2. Automatic vs manual failover (2 min, talk only)

- **Automatic:** Temporal Cloud watches its own health signals: reachability, RPC and persistence latency, error rates. If a region degrades, it fails the namespace over for you. The RTO target is 20 minutes and the RPO is under 1 minute. Once the region is healthy again, Temporal fails back automatically.
- **Manual:** you decide when. It's used for failover drills, region migrations, and outages that only *you* can see, like your own app tier going down. Temporal won't fail over for an outage it can't detect.
- *"Same mechanism either way. Today we press the button."*

## 3. Load (1 min)

Click **Start transfers** with 100, then go straight to section 4. Talk over the load while the failover runs.

> "A hundred transfers. Transfer *n* waits *n*/2 seconds, withdraws, waits another *n*/2, then deposits. So withdraws arrive about two per second and deposits about one per second."

Point at the dashed (withdraw) and solid (deposit) east lines, and at the in-flight count counting down from 100.

**Timing:** after you click Fail over, the badge flips to the new region in about 45s, and the failover operation reports done at about 95s (the badge's amber "in progress" text clears then). Transfer *n* withdraws at about *n*/2 seconds and deposits at about *n* seconds. If you click right after Start, with the switch landing at about 45s:

| Transfers | Withdraw | Deposit |
|---|---|---|
| 1–45 | east | east |
| 46–90 | east | **central**: these are the ones that cross mid-transfer |
| 91–100 | central | central |

Waiting before you click shifts the boundaries up: about 1 transfer per second of delay for the deposit boundary, 2 for the withdraw boundary. Steps that come due during the switch itself wait a few seconds and then run in central. The batch drains about 100s after Start.

*The 45s switch time was measured with the earlier fixed hold. Check these boundaries on a dry run.*

## 4. Fail over (2 min)

Right after starting the batch, click **Fail over to gcp-us-central1**. There is no confirmation dialog: the failover starts on the click.

> "The badge goes amber while the failover runs. Temporal tries a graceful handoff first, draining replication and then switching."

Watch for:
- The badge flips to **gcp-us-central1**
- On the steps chart (solid = deposit, dashed = withdraw), **both east lines drop to zero and both central lines pick up** the rest of the stream. Those are the warm workers taking over with no restart and no config change.
- Two dotted vertical lines on the charts: **failover clicked** and, about 45s later, **active: gcp-us-central1** when the badge flips. Point at the gap between them: that's the graceful handoff.
- In-flight count keeps counting down to 0

## 5. Prove it (2 min)

In the Temporal Cloud UI, open a transfer from the crossing group, for example `transfer-70-…`, and show the result:

```json
{ "withdraw": { "region": "gcp-us-east4" }, "deposit": { "region": "gcp-us-central1" } }
```

> "Started in one region, finished in the other. One withdraw, one deposit. Nothing lost, nothing doubled, and nobody touched the workers."

For contrast, `transfer-20-…` did both steps in `gcp-us-east4`, and `transfer-95-…` did both in `gcp-us-central1`.

## 6. And back (1 min, optional)

Start another batch of 100 and right away click **Fail over to gcp-us-east4**. It's the same button in the other direction, and it's also how you reset the demo.

## If something goes wrong

| Symptom | Do |
|---|---|
| Failover button disabled ("replica not ready") | The replica is still syncing. Talk through slides and check again in a minute. |
| Button errors out | Fail over from the terminal: `temporal cloud namespace ha failover --namespace $NS --region <target>`. It asks you to confirm; add `--auto-confirm` to skip the prompt in scripts. |
| Charts empty or lagging | GMP lags 15–30s. Narrate from the badge and the in-flight count. |
| A pod is crash-looping | `kubectl -n ha-demo logs deploy/money-transfer-worker`. Standby pods log nothing after startup. Their polls are refused quietly. |
