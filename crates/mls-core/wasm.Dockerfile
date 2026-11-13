# syntax=docker/dockerfile:1
# Build helper (NOT a runtime container): compiles the @magna-carta/mls WebAssembly
# artifact (crates/mls-core -> packages/mls/src/pkg) in a pinned Rust toolchain,
# mirroring crates/segmentation-core/wasm.Dockerfile. The wasm is the key agreement of an end-to-end
# encrypted meeting (MLS); it runs in the member's browser. getrandom's browser backend comes from
# crates/mls-core/.cargo/config.toml, which wasm-pack picks up because it runs cargo from the crate
# directory. Like the other wasm helpers this image is never
# deployed: it produces the artifact and exports it to the host via `docker build --output`. Build
# context is the crates/ workspace.
FROM rust:1-bookworm AS build
RUN rustup target add wasm32-unknown-unknown
# wasm-pack from source (lands on PATH at /usr/local/cargo/bin) — deterministic, cached as a layer.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-pack --locked
WORKDIR /src
COPY . .
# --no-opt: wasm-opt is not required; the artifact is semantically correct (matches the host build).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    wasm-pack build mls-core --target web --out-dir /out --release --no-opt

# Export-only final stage: `docker build --output type=local,dest=packages/mls/src/pkg`
# writes exactly the wasm-pack output (and nothing else) to the host package directory.
FROM scratch AS export
COPY --from=build /out /
