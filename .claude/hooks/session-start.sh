#!/bin/bash
# Make the git-ignored Rust->WASM artefacts available so the quality gate (pnpm check),
# the pre-push hook, and any worker/pdf test can run in a Claude Code on the web session.
# The packages packages/{pdf,decryption,email,seven-zip}/src/pkg are built from
# crates/{pdf-core,decryption-core,email-core,seven-zip-core}; they are never committed, so a fresh remote
# container has to build them once. The container is cached after this hook, so later sessions
# start from a snapshot that already carries the artefacts and this becomes a fast no-op.
set -euo pipefail

# Local dev machines carry their own toolchain and build artefacts; only the remote env needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Progress goes to stderr — a SessionStart hook's stdout is folded into the session context.
log() { echo "session-start: $*" >&2; }

# wasm-pack drives the wasm-bindgen build. Install it from crates.io if absent — the prebuilt
# GitHub release binary is blocked by the environment's outbound proxy (403), but crates.io is
# reachable, so `cargo install` is the reliable path.
if ! command -v wasm-pack >/dev/null 2>&1; then
  log "wasm-pack not found — installing with cargo (this is one-time per fresh container)…"
  cargo install wasm-pack --locked >&2
fi

# Build only what is stale (idempotent; a no-op when the artefacts are already current). Run the
# bootstrap script directly with node so it does not depend on pnpm/vp or node_modules being ready.
log "building WASM artefacts…"
node tooling/bootstrap/index.mjs >&2

log "WASM artefacts ready."

# A cold `tsc -b` peaks near the container's default Node heap (about 2 GB), so give every later
# command in the session a larger one. CLAUDE_ENV_FILE is how a SessionStart hook sets the environment.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export NODE_OPTIONS="--max-old-space-size=8192 ${NODE_OPTIONS:-}"' >> "$CLAUDE_ENV_FILE"
fi
