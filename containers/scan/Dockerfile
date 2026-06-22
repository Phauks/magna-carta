# The scan Container image: a long-lived clamd daemon plus the Rust scan service, sharing one
# linux/amd64 container. The Rust service listens on :8080 and fans each /scan body to clamd (loopback
# TCP), yara-x, and the structural heuristics. Build context is this directory (containers/scan).

# --- build stage: compile the Rust scan service ---------------------------------------------------
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin magna-carta-scan

# --- runtime stage: clamd + the service -----------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clamav clamav-daemon clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Bake the initial signature database at BUILD time. The container runs with no network egress
# (enableInternet = false), so the DB cannot be fetched at runtime — a refresh is an image rebuild
# (or a separate signed-update job, a documented seam). `|| true` so a transient mirror hiccup does
# not fail the image; clamd reports an empty DB clearly if it ever happens.
RUN freshclam || true

COPY --from=build /src/target/release/magna-carta-scan /usr/local/bin/scan
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
