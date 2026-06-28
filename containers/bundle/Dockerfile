# The bundle Container image: the heavy-lane archive encoder. A Rust axum service on :8080 that turns a
# build manifest into ZIP/7z volumes, reading inputs and writing outputs through the owner Worker's R2
# binding (outbound Workers) over R2_BASE_URL. No signature DB and no general network egress
# (enableInternet=false): R2 is the only outbound and the owner Worker mediates it. Build context is this
# directory (containers/bundle).

# --- build stage: compile the Rust bundle service -------------------------------------------------
FROM rust:1-bookworm AS build
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY src ./src
# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# binary is copied out to /artifacts (a normal path) in the same RUN before the mount drops — the
# runtime stage reads it from there, not from target/. See docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release --bin magna-carta-bundle \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-bundle /artifacts/

# --- runtime stage: just the service --------------------------------------------------------------
FROM debian:bookworm-slim

# reqwest's rustls-tls validates against bundled webpki roots, so TLS does not need system certs; the
# default R2_BASE_URL is plain http (the internal outbound-Workers host). ca-certificates is kept as cheap
# insurance only in case the transport is ever pointed at an https endpoint using system roots.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /artifacts/magna-carta-bundle /usr/local/bin/bundle

# The encoder spools inputs and the output archive to ephemeral disk; /tmp is that scratch space.
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/bundle"]
