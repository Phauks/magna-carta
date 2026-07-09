# The recovery container: a pure-Rust axum service that brute-forces document password shards.
# Listens on :8080 — POST /recover-shard, GET /ready. No network egress at runtime.
#
# Build context: the repository root (so the decryption-core path dep is reachable).
# Example: docker build -f containers/recovery/Dockerfile -t mc-recovery .

# --- build stage: compile the recovery service ---------------------------------------------------
FROM rust:1-bookworm AS build

WORKDIR /workspace

# Copy the WHOLE crates/ workspace, not just decryption-core. The recovery crate path-deps
# `../../crates/decryption-core`, and that crate inherits its `edition` and dependency versions from
# the crates/ workspace root (`crates/Cargo.toml`, via `workspace = true`). Cargo must load that
# workspace root and its member manifests to resolve the inheritance, so copying decryption-core
# alone fails with "failed to find a workspace root". Only decryption-core actually compiles — it is
# the sole crate in magna-carta-recovery's dependency graph; the other members are read as manifests
# (for workspace resolution) but never built, so this stays cheap. The root .dockerignore keeps
# every crate's `target/` out of the context.
COPY crates crates
COPY containers/recovery/Cargo.toml containers/recovery/Cargo.toml
COPY containers/recovery/Cargo.lock containers/recovery/Cargo.lock
COPY containers/recovery/src containers/recovery/src

WORKDIR /workspace/containers/recovery

# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# binary is copied out to /artifacts in the same RUN before the mount drops — the runtime stage
# reads it from there, not from target/. See docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/workspace/containers/recovery/target \
    cargo build --release --bin magna-carta-recovery \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-recovery /artifacts/

# --- runtime stage: minimal debian image ---------------------------------------------------------
FROM debian:bookworm-slim

# No network tools needed — the binary reads baked wordlists only; no egress.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /artifacts/magna-carta-recovery /usr/local/bin/recovery
COPY containers/recovery/wordlists /app/wordlists

EXPOSE 8080

ENV RECOVERY_WORDLIST_PATH=/app/wordlists/ncsc-100k.txt
ENV RECOVERY_RULES_PATH=/app/wordlists/best64.rule

ENTRYPOINT ["/usr/local/bin/recovery"]
