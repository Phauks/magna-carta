# syntax=docker/dockerfile:1
# Build helper (NOT a runtime container): compiles the @magna-carta/decryption WebAssembly artifact
# (crates/decryption-core -> packages/decryption/src/pkg) in a pinned Rust toolchain, mirroring
# crates/pdf-core/wasm.Dockerfile. The wasm runs in the Worker isolate — the decryption/recovery
# routes' unlock-with-key (strip_with_key), crack-hash extraction (extract_hash), and guess
# verification (verify_guess) — so unlike the container workers this image is never deployed: it
# produces the artifact and exports it to the host via `docker build --output`. Wired into the
# `rust-wasm-build` task (vite.config.ts) alongside the pdf-core build, invoked identically in local
# builds and Cloudflare Workers Builds, so no deploy environment ever needs Rust on the bare runner.
# Build context is the crates/ workspace.
FROM rust:1-bookworm AS build
RUN rustup target add wasm32-unknown-unknown
# wasm-pack from source (lands on PATH at /usr/local/cargo/bin) — deterministic, cached as a layer.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-pack --locked
WORKDIR /src
COPY . .
# --no-opt: wasm-opt is not required; the artifact is semantically correct (matches packages/decryption).
# BuildKit cache mounts for the cargo registry/git + the workspace target, mirroring pdf-core's Dockerfile.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    wasm-pack build decryption-core --target web --out-dir /out --release --no-opt

# Export-only final stage: `docker build --output type=local,dest=packages/decryption/src/pkg` writes
# exactly the wasm-pack output (and nothing else) to the host package directory.
FROM scratch AS export
COPY --from=build /out /
