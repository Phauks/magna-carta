# The audio/video transcode engine: a pure-Rust axum service on :8080 (POST /convert, GET /ready) that
# turns MP4, QuickTime and Matroska files carrying H.264 or HEVC into an MP4 every browser plays. No
# FFmpeg and no C codec library: untrusted video bytes are parsed and decoded by memory-safe Rust.
# Build context is this directory.

# --- build stage -----------------------------------------------------------------------------------
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
# The registry and target/ caches keep an unchanged dependency graph from recompiling. A cache mount is
# not part of the image layer, so the binary is copied out to /artifacts before the mount drops. See
# docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release --bin magna-carta-transcode \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-transcode /artifacts/

# --- runtime stage ---------------------------------------------------------------------------------
FROM debian:bookworm-slim

# No TLS trust store: the service makes no outbound request, and the container runs with egress off.
COPY --from=build /artifacts/magna-carta-transcode /usr/local/bin/transcode

# The working surface: each request spools its source, a payload file and the rendition here, and the
# directory is removed when the response has been sent. Nothing durable lives here.
ENV TMPDIR=/scratch

# An unprivileged user, and the one writable directory the service needs.
RUN set -eux; \
    useradd --system --no-create-home --shell /usr/sbin/nologin transcode; \
    mkdir -p /scratch; \
    chown transcode:transcode /scratch

USER transcode

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/transcode"]
