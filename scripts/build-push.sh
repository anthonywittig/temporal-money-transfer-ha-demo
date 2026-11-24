#!/usr/bin/env bash
# Build the worker image for linux/amd64 and push it to Artifact Registry.
# Usage: scripts/build-push.sh <image-repo-url> [tag]
#   image-repo-url: e.g. us-docker.pkg.dev/my-project/ha-demo  (terraform output -raw image_repository)
set -euo pipefail

repo="${1:?usage: build-push.sh <image-repo-url> [tag]}"
tag="${2:-$(git rev-parse --short HEAD)}"
image="${repo}/worker:${tag}"
root="$(cd "$(dirname "$0")/.." && pwd)"

registry_host="${repo%%/*}"
gcloud auth configure-docker "$registry_host" --quiet >/dev/null

docker build --platform linux/amd64 -t "$image" "$root/worker"
docker push "$image"
echo "$image"
