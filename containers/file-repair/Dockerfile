FROM rust:1-bookworm AS build
WORKDIR /src
# Build context is the repo root (set via image_build_context in the file-repair-worker wrangler.jsonc).
# Copy the whole crates/ workspace, not just the two crates this binary uses: engine-host and
# recovery-core inherit `edition` from the workspace root manifest (crates/Cargo.toml), so cargo must
# see that root to resolve the inheritance. The workspace is ~1 MB of source; cargo still compiles only
# this binary's dependency closure (engine-host + recovery-core), never pdf-core/pdf-eval.
COPY crates crates
COPY containers/file-repair containers/file-repair
WORKDIR /src/containers/file-repair
RUN cargo build --release --bin magna-carta-file-repair

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/containers/file-repair/target/release/magna-carta-file-repair /usr/local/bin/file-repair
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/file-repair"]
