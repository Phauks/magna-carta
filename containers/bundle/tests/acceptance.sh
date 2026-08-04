#!/usr/bin/env bash
set -euo pipefail

# The bundle engine's acceptance gate: build the image, run it against a tiny local R2 stub (standing in
# for the owner Worker's outbound-Workers R2 mediation), POST a build manifest, and assert the written
# archive re-opens with the expected entries. The crate's unit/integration tests (cargo test) cover the
# encoders, split, and the /build flow against an in-process stub; this gate proves the full container is
# wired and serves /build over the network.
#
# Requires a running Docker daemon, python3, and unzip. Run: containers/bundle/tests/acceptance.sh

IMAGE=magna-carta-bundle:acceptance
CONTAINER=magna-carta-bundle-acceptance
# Published port (the service binds 0.0.0.0:8080 inside the container).
BUNDLE_PORT=18090
R2_PORT=18091
BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../../docker-build.sh
. "$BUNDLE_DIR/../docker-build.sh"
STORE_DIR="$(mktemp -d)"
R2_PID=""

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [ -n "$R2_PID" ] && kill "$R2_PID" >/dev/null 2>&1 || true
  rm -rf "$STORE_DIR"
}
trap cleanup EXIT

# A minimal disk-backed R2 stub: GET returns $STORE_DIR/<path>, PUT writes it. The container reaches it
# over the host network (--network host), exactly as it will reach the owner Worker's R2 host in prod.
start_r2_stub() {
  python3 - "$R2_PORT" "$STORE_DIR" <<'PY' &
import os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1])
root = sys.argv[2]

def path_for(p):
    return os.path.join(root, p.lstrip("/"))

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        fp = path_for(self.path)
        if not os.path.isfile(fp):
            self.send_response(404); self.end_headers(); return
        data = open(fp, "rb").read()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_PUT(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        fp = path_for(self.path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        open(fp, "wb").write(body)
        self.send_response(200); self.end_headers()
    def log_message(self, *args):
        pass

# Bind all interfaces: the container reaches this stub via host.docker.internal (the host gateway IP),
# not loopback, so a 127.0.0.1-only bind would be unreachable from inside the container.
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
PY
  R2_PID=$!
}

echo "building $IMAGE (linux/amd64) ..."
container_build --platform linux/amd64 -t "$IMAGE" "$BUNDLE_DIR"

echo "seeding the R2 stub input ..."
mkdir -p "$STORE_DIR/inputs"
printf 'acceptance-content' > "$STORE_DIR/inputs/a"

echo "starting R2 stub on :$R2_PORT ..."
start_r2_stub
sleep 1

# Publish the service port and reach the host-side R2 stub via host.docker.internal. This works on Docker
# Desktop (Windows/macOS, where the pre-push hook usually runs) and on Linux via the host-gateway add-host
# — unlike `--network host`, which only shares loopback on native Linux.
echo "starting bundle container (published :$BUNDLE_PORT, R2_BASE_URL -> the host stub) ..."
docker run -d --name "$CONTAINER" \
  -p "$BUNDLE_PORT:8080" \
  --add-host "host.docker.internal:host-gateway" \
  -e "R2_BASE_URL=http://host.docker.internal:$R2_PORT" "$IMAGE" >/dev/null

echo "waiting for /ready ..."
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$BUNDLE_PORT/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$BUNDLE_PORT/ready" >/dev/null || { echo "FAIL: /ready never came up"; exit 1; }

CONTENTS_B64="$(printf 'CONTENTS' | base64 | tr -d '\n')"
read -r -d '' MANIFEST <<JSON || true
{
  "jobId": "acceptance",
  "format": "zip",
  "compression": "store",
  "entries": [
    { "archivePath": "a.txt", "mtimeEpochSecs": 1700000000, "source": "r2", "r2Key": "inputs/a" },
    { "archivePath": "CONTENTS.txt", "mtimeEpochSecs": null, "source": "inline", "bytesBase64": "$CONTENTS_B64" }
  ],
  "outputKeyPrefix": "bundles/acceptance.zip"
}
JSON

echo "POST /build ..."
resp="$(printf '%s' "$MANIFEST" | curl -fsS -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$BUNDLE_PORT/build")"
echo "  -> $resp"
echo "$resp" | grep -q '"ok":true' || { echo "FAIL: /build did not return ok:true"; exit 1; }

echo "verifying the written ZIP re-opens ..."
OUT="$STORE_DIR/bundles/acceptance.zip"
test -f "$OUT" || { echo "FAIL: the output volume was not written to R2"; exit 1; }
listing="$(unzip -l "$OUT")"
echo "$listing"
echo "$listing" | grep -q 'a.txt' || { echo "FAIL: a.txt missing from the bundle"; exit 1; }
echo "$listing" | grep -q 'CONTENTS.txt' || { echo "FAIL: CONTENTS.txt missing from the bundle"; exit 1; }

echo "PASS: the bundle container built a ZIP from an R2 + inline manifest and wrote it back to R2"
