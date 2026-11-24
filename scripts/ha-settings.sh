#!/usr/bin/env bash
# Applies the namespace HA settings the Terraform provider does not manage:
#   passive poller forwarding = disabled  (Active/Hot-Passive: only active-region workers get tasks)
# Idempotent: safe to run repeatedly. Requires the `temporal cloud` CLI extension and
# TEMPORAL_CLOUD_API_KEY (the same account-level key Terraform uses).
# Usage: scripts/ha-settings.sh <namespace>.<account>
set -euo pipefail

ns="${1:?usage: ha-settings.sh <namespace>.<account>}"
: "${TEMPORAL_CLOUD_API_KEY:?TEMPORAL_CLOUD_API_KEY must be set}"

temporal cloud namespace ha update \
  --api-key "$TEMPORAL_CLOUD_API_KEY" \
  --namespace "$ns" \
  --passive-poller-forwarding disabled \
  --idempotent

temporal cloud namespace ha get --api-key "$TEMPORAL_CLOUD_API_KEY" --namespace "$ns"
