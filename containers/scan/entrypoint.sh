#!/usr/bin/env bash
set -euo pipefail

# clamav-client talks to clamd over loopback TCP (the cross-platform transport); the Debian package
# defaults to a Unix socket, so add a TCP listener on 127.0.0.1:3310. Loopback only — no network egress.
CONF=/etc/clamav/clamd.conf
grep -q '^TCPSocket' "$CONF" || printf 'TCPSocket 3310\nTCPAddr 127.0.0.1\n' >>"$CONF"

# clamd needs its runtime socket directory to exist and be owned by the clamav user it drops to.
mkdir -p /run/clamav
chown clamav:clamav /run/clamav 2>/dev/null || true

# Start clamd. It loads the baked signature database (no freshclam at runtime — no egress) and opens
# its sockets only once loading completes, so a successful TCP connect means it is ready to scan.
clamd &

echo "waiting for clamd on 127.0.0.1:3310 ..."
for _ in $(seq 1 180); do
  if (exec 3<>/dev/tcp/127.0.0.1/3310) 2>/dev/null; then
    exec 3>&- 3<&-
    echo "clamd is ready"
    break
  fi
  sleep 1
done

# Hand off to the scan service (PID 1) on :8080.
exec /usr/local/bin/scan
