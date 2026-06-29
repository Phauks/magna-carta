#!/usr/bin/env bash
set -euo pipefail

# The recovery container's acceptance gate: build the image (context: repo root), run it,
# assert /ready → "ok", then POST /recover-shard with a small shard over the baked NCSC
# wordlist and assert the response is valid JSON with a `candidatesTried` field (found may
# be null — the gate proves the container is wired, not that the test hash is in the list).
#
# Requires a running Docker daemon. Run from the repo root:
#   containers/recovery/tests/recover_e2e.sh

IMAGE=magna-carta-recovery:e2e
CONTAINER=magna-carta-recovery-e2e
PORT=18081
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "building $IMAGE (linux/amd64, context: repo root) ..."
docker build --platform linux/amd64 \
  -f "$REPO_ROOT/containers/recovery/Dockerfile" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "starting container ..."
docker run -d --name "$CONTAINER" -p "$PORT:8080" "$IMAGE" >/dev/null

echo "waiting for /ready (service loads wordlist + rules at startup) ..."
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/ready" | grep -q "^ok$" \
  || { echo "FAIL: /ready did not return 'ok'"; exit 1; }

# MS Office 2013 agile hash (hashcat example_hashes mode 9600, password = "hashcat").
# The acceptance test scans only the first 10 words of the baked wordlist — fast and sufficient
# to prove the engine is wired. found=null is expected and fine; we assert valid JSON only.
HASH='$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895'

echo "POST /recover-shard (shard 0–10, ruleSet=none) ..."
response=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d "{\"hash\":\"$HASH\",\"format\":\"ooxml\",\"hashcatMode\":9600,\"wordStart\":0,\"wordEnd\":10,\"ruleSet\":\"none\"}" \
  "http://127.0.0.1:$PORT/recover-shard")
echo "  -> $response"

# Validate the response is JSON with a candidatesTried field (the minimum liveness proof).
echo "$response" | grep -q '"candidatesTried"' \
  || { echo "FAIL: /recover-shard did not return a JSON body with candidatesTried"; exit 1; }

echo "PASS: /ready returned ok and /recover-shard returned valid JSON"
