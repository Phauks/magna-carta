#!/usr/bin/env bash
# Cloudflare Workers Builds — build step.
#
# The build runner ships Node + pnpm but NOT the Rust/wasm toolchain. `vp run build-all`
# builds the @magna-carta/pdf wasm artifact (crates/pdf-core -> packages/pdf/src/pkg) with
# wasm-pack, which needs rustc + cargo + the wasm32-unknown-unknown target. So install the
# toolchain before building. Idempotent: the install is skipped when wasm-pack is already on
# PATH (a warm dependency cache), so steady-state builds pay only the install they need.
#
# Point the Workers Build "Build command" (dashboard: Workers & Pages -> magna-carta ->
# Settings -> Builds) at this script: `bash tooling/workers-build.sh`. The deploy command is
# unchanged (`pnpm --filter @magna-carta/worker exec wrangler deploy`).
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "workers-build: Rust/wasm-pack not found on the runner — installing the toolchain"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
  rustup target add wasm32-unknown-unknown
  curl --proto '=https' --tlsv1.2 -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
fi

command -v wasm-pack >/dev/null 2>&1 || {
  echo "workers-build: wasm-pack still not on PATH after install — failing" >&2
  exit 1
}

pnpm install --frozen-lockfile
pnpm exec vp run build-all
