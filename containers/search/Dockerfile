# The discovery keyword-search container: a pure-Rust axum service that builds, range-reads, and merges
# Tantivy splits. Listens on :8080 — POST /index, /query, /remove, /compact and GET /ready.
#
# It has no general network egress at runtime and holds no storage credentials. The one host it talks
# to is a non-routable internal name the Workers runtime intercepts and forwards into the app worker
# (apps/search-worker/src/search-index-container.ts), which is why nothing here configures an endpoint,
# a region, or a key.
#
# Build context: the repository root (so the search-core path dep is reachable).
# Example: docker build -f containers/search/Dockerfile -t mc-search .

# --- build stage: compile the search service -----------------------------------------------------
FROM rust:1-bookworm AS build

WORKDIR /workspace

# Copy the WHOLE crates/ workspace, not just search-core. The search crate path-deps
# `../../crates/search-core`, and that crate inherits its `edition` and dependency versions from the
# crates/ workspace root (`crates/Cargo.toml`, via `workspace = true`). Cargo must load that workspace
# root and its member manifests to resolve the inheritance, so copying search-core alone fails with
# "failed to find a workspace root". Only search-core actually compiles — it is the sole crate in
# magna-carta-search's dependency graph; the other members are read as manifests (for workspace
# resolution) but never built, so this stays cheap. The root .dockerignore keeps every crate's
# `target/` out of the context.
COPY crates crates
COPY containers/search/Cargo.toml containers/search/Cargo.toml
COPY containers/search/Cargo.lock containers/search/Cargo.lock
COPY containers/search/src containers/search/src

WORKDIR /workspace/containers/search

# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# binary is copied out to /artifacts in the same RUN before the mount drops — the runtime stage reads
# it from there, not from target/. See docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/workspace/containers/search/target \
    cargo build --release --bin magna-carta-search \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-search /artifacts/

# --- runtime stage: minimal debian image ---------------------------------------------------------
FROM debian:bookworm-slim

# No TLS trust store is installed on purpose: the service speaks plain HTTP to an intercepted internal
# host and has no other reachable peer, so a certificate bundle here would only imply an egress path
# that does not exist.
COPY --from=build /artifacts/magna-carta-search /usr/local/bin/search

# Scratch for index building and merging. Tantivy writes a segment to a temporary directory before it
# is bundled into a split; nothing durable lives here, and the directory is emptied by the process.
ENV TMPDIR=/scratch
RUN mkdir -p /scratch

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/search"]
