FROM rust:1-bookworm AS build
WORKDIR /src
# Build context is the repo root (set via image_build_context in the recovery-worker wrangler.jsonc).
COPY crates/engine-host crates/engine-host
COPY crates/recovery-core crates/recovery-core
COPY containers/recovery containers/recovery
WORKDIR /src/containers/recovery
RUN cargo build --release --bin magna-carta-recovery

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/containers/recovery/target/release/magna-carta-recovery /usr/local/bin/recovery
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/recovery"]
