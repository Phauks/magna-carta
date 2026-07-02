#!/usr/bin/env bash
set -euo pipefail

# The scan engine's acceptance gate: build the image, run it, and assert the wired container stack
# detects EICAR end to end (clamd -> the raw /scan response) and reports a clean text file with a clean
# clam fact. The container reports RAW FACTS, not a verdict — EICAR comes back as
# `clam:{state:infected,…}` and clean text as `clam:{state:clean}` (the app maps facts to a firm
# verdict). The PDF/Office/archive heuristic facts are covered by the Rust unit tests (cargo test); this
# gate proves the full container is wired and clamd's signature DB is live.
#
# Requires a running Docker daemon. Run: containers/scan/tests/eicar_e2e.sh

IMAGE=magna-carta-scan:e2e
CONTAINER=magna-carta-scan-e2e
PORT=18080
SCAN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "building $IMAGE (linux/amd64) ..."
docker build --platform linux/amd64 -t "$IMAGE" "$SCAN_DIR"

echo "starting container ..."
docker run -d --name "$CONTAINER" -p "$PORT:8080" "$IMAGE" >/dev/null

echo "waiting for /ready (clamd loads its DB first) ..."
for _ in $(seq 1 300); do
  if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null || { echo "FAIL: /ready never came up"; exit 1; }

# The EICAR test string, assembled from two literals so the full signature never sits contiguously in
# this file (which would trip a developer's own antivirus on checkout).
EICAR='X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTI''VIRUS-TEST-FILE!$H+H*'

echo "scanning EICAR ..."
eicar_facts=$(printf '%s' "$EICAR" | curl -fsS -X POST --data-binary @- "http://127.0.0.1:$PORT/scan")
echo "  -> $eicar_facts"
echo "$eicar_facts" | grep -q '"state":"infected"' \
  || { echo "FAIL: EICAR did not surface a clam infected fact"; exit 1; }

echo "scanning a clean text file ..."
clean_facts=$(printf 'hello world' | curl -fsS -X POST --data-binary @- "http://127.0.0.1:$PORT/scan")
echo "  -> $clean_facts"
echo "$clean_facts" | grep -q '"state":"clean"' \
  || { echo "FAIL: clean text did not surface a clam clean fact"; exit 1; }

echo "PASS: EICAR surfaced an infected clam fact, clean text a clean clam fact"
