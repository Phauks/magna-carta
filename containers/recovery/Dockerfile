FROM rust:1-bookworm AS build
WORKDIR /src
# Build context is the repo root (set via image_build_context in the recovery-worker wrangler.jsonc).
# Copy the whole crates/ workspace, not just the two crates this binary uses: engine-host and
# recovery-core inherit `edition` from the workspace root manifest (crates/Cargo.toml), so cargo must
# see that root to resolve the inheritance. The workspace is ~1 MB of source; cargo still compiles only
# this binary's dependency closure (engine-host + recovery-core), never pdf-core/pdf-eval.
COPY crates crates
COPY containers/recovery containers/recovery
WORKDIR /src/containers/recovery
RUN cargo build --release --bin magna-carta-recovery

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/containers/recovery/target/release/magna-carta-recovery /usr/local/bin/recovery
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/recovery"]
