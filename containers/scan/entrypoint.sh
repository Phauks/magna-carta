#!/usr/bin/env bash
set -euo pipefail

# clamav-client talks to clamd over loopback TCP (the cross-platform transport); the Debian package
# defaults to a Unix socket, so add a TCP listener on 127.0.0.1:3310. Loopback only — no network egress.
CONF=/etc/clamav/clamd.conf
grep -q '^TCPSocket' "$CONF" || printf 'TCPSocket 3310\nTCPAddr 127.0.0.1\n' >>"$CONF"

# Align clamd's scan limits with the ingest pipeline's inspectable-size cap — the
# fileManager.inspectableSizeCapBytes default (2 GiB) in packages/file-manager/src/upload-policy.ts.
# clamd's stock limits are far below that (MaxScanSize/MaxFileSize 100M, StreamMaxLength 25M). clamd
# enforces MaxScanSize/MaxFileSize on a path SCAN too, not only on INSTREAM, so a file between ~100 MiB
# and the cap would be skipped without these raised.
#
# CRITICAL — fail-closed on a limit breach. By default clamd that hits a size/time/recursion/file-count
# limit stops and returns OK (a SILENT CLEAN below the Rust layer's never-silent-clean enforcement — the
# one place that invariant cannot reach). `AlertExceedsMax yes` makes a breach surface as a
# `Heuristics.Limits.Exceeded.* FOUND`, which interpret_reply (clamav.rs) already maps to Infected — so
# an uninspectable file fails CLOSED (quarantine), never clean. The time/recursion/file-count limits are
# also pinned, raised above clamd's stock defaults so they sit at/above the in-process ArchiveCaps and
# the 2 GiB cap — a legitimate large or deeply-but-boundedly nested file scans clean, and only genuinely
# pathological input (beyond what we intend to inspect) trips the fail-closed alert. Strip any active
# directive first so a duplicate cannot error (commented samples are left).
sed -i -E '/^[[:space:]]*(StreamMaxLength|MaxScanSize|MaxFileSize|MaxScanTime|MaxRecursion|MaxFiles|AlertExceedsMax)[[:space:]]/d' "$CONF"
printf 'StreamMaxLength 2048M\nMaxScanSize 2048M\nMaxFileSize 2048M\nMaxScanTime 300000\nMaxRecursion 17\nMaxFiles 50000\nAlertExceedsMax yes\n' >>"$CONF"

# Scratch directory for the direct file-scan fast path: the scan service writes the request body here and
# sends clamd `SCAN <path>` so clamd reads the file itself — no INSTREAM socket copy or temp spool. Files
# are written mode 0644 so the clamav user clamd drops to can read them; the directory is 0755. Swept on
# every boot so a scratch file leaked by a SIGKILL/crash on a prior run cannot linger and exhaust disk.
mkdir -p /scan
chmod 0755 /scan
rm -f /scan/* 2>/dev/null || true

# clamd needs its runtime socket directory to exist and be owned by the clamav user it drops to.
mkdir -p /run/clamav
chown clamav:clamav /run/clamav 2>/dev/null || true

# Start clamd. It loads the baked signature database (no freshclam at runtime — no egress) and opens
# its sockets only once loading completes, so a successful TCP connect means it is ready to scan.
clamd &

echo "waiting for clamd on 127.0.0.1:3310 ..."
clamd_ready=0
for _ in $(seq 1 180); do
  if (exec 3<>/dev/tcp/127.0.0.1/3310) 2>/dev/null; then
    exec 3>&- 3<&-
    clamd_ready=1
    echo "clamd is ready"
    break
  fi
  sleep 1
done

# Fail fast if clamd never came up: exit non-zero so the orchestrator restarts the container, rather
# than serving in a permanently engine-degraded state where every scan silently degrades to unscanned.
if [ "$clamd_ready" -ne 1 ]; then
  echo "FATAL: clamd did not become ready within the timeout; exiting so the container restarts" >&2
  exit 1
fi

# Expose the baked YARA Forge release tag to the service: it becomes the engine-version `yara-rules`
# component (the staleness gate's rules key). The blob path is set via ENV in the Dockerfile; the tag
# lives beside it. `unknown` if the file is somehow absent — the service still loads the blob and serves;
# only the version label degrades, never the scan.
export YARA_RULES_TAG="$(cat /etc/scan/yara-rules.tag 2>/dev/null || echo unknown)"

# Hand off to the scan service (PID 1) on :8080.
exec /usr/local/bin/scan
