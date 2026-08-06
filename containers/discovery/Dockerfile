FROM rust:1-bookworm AS build
WORKDIR /src
# Build context is the repo root (set via image_build_context in the discovery-worker wrangler.jsonc).
# Copy the whole crates/ workspace, not just the crates this binary uses: engine-host, discovery-core,
# pdf-core, and email-core inherit `edition` (and shared dependencies) from the workspace root
# manifest (crates/Cargo.toml), so cargo must see that root to resolve the inheritance. The workspace
# is ~1 MB of source; cargo still compiles only this binary's dependency closure.
COPY crates crates
COPY containers/discovery containers/discovery
WORKDIR /src/containers/discovery
RUN cargo build --release --bin magna-carta-discovery

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/containers/discovery/target/release/magna-carta-discovery /usr/local/bin/discovery
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/discovery"]
