# The United States address engine: a pure-Rust axum service over crates/address-core. One image, run by
# apps/address-worker as two Container classes — the query class (POST /suggestions, /units) and the
# build class (POST /builds, GET /builds). Listens on :8080; GET /ready answers 204.
#
# It has no general network egress and holds no storage credentials. The two hosts it talks to,
# addresses.magna-carta.internal (the index objects) and openaddresses.magna-carta.internal (the source
# data), are non-routable names the address worker intercepts, which is why nothing here configures an
# endpoint, a region, or a key.
#
# Build context: the repository root (so the address-core and search-core path deps are reachable).
# Example: docker build -f containers/address/Dockerfile -t mc-address .

# --- build stage: compile the address service ----------------------------------------------------
FROM rust:1-bookworm AS build

WORKDIR /workspace

# Copy the WHOLE crates/ workspace, not just the two crates this service uses: they inherit their
# edition and lint floor from the crates/ workspace root (`crates/Cargo.toml`, via `workspace = true`),
# so Cargo must load that root and its member manifests to resolve the inheritance. Only address-core
# and search-core compile; the other members are read as manifests and never built. The root
# .dockerignore keeps every crate's `target/` out of the context.
COPY crates crates
COPY containers/address/Cargo.toml containers/address/Cargo.toml
COPY containers/address/Cargo.lock containers/address/Cargo.lock
COPY containers/address/src containers/address/src

WORKDIR /workspace/containers/address

# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# binary is copied out to /artifacts in the same RUN before the mount drops. See
# docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/workspace/containers/address/target \
    cargo build --release --bin magna-carta-address \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-address /artifacts/

# --- runtime stage: minimal debian image ---------------------------------------------------------
FROM debian:bookworm-slim

# No TLS trust store is installed on purpose: the service speaks plain HTTP to two intercepted internal
# hosts and has no other reachable peer, so a certificate bundle would only imply an egress path that
# does not exist.
COPY --from=build /artifacts/magna-carta-address /usr/local/bin/address

# Build scratch. A partition is indexed and merged here, then streamed up and removed; nothing durable
# lives here. The query class never writes to it.
ENV TMPDIR=/scratch

# An unprivileged user, and the one writable surface the service needs: the scratch directory.
RUN set -eux; \
    useradd --system --no-create-home --shell /usr/sbin/nologin address; \
    mkdir -p /scratch; \
    chown address:address /scratch

USER address

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/address"]
