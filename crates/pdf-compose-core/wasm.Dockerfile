# syntax=docker/dockerfile:1
# Build helper (NOT a runtime container): compiles the @magna-carta/pdf-compose WebAssembly artifact
# (crates/pdf-compose-core -> packages/pdf-compose/src/pkg) in a pinned Rust toolchain, mirroring
# crates/pdf-core/wasm.Dockerfile. The wasm composes a new PDF from content, in a browser or a
# Worker. Like the other wasm helpers this image is never deployed: it produces the artifact and
# exports it to the host via `docker build --output`. Build context is the crates/ workspace.
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
    wasm-pack build pdf-compose-core --target web --out-dir /out --release --no-opt

# Export-only final stage: `docker build --output type=local,dest=packages/pdf-compose/src/pkg`
# writes exactly the wasm-pack output (and nothing else) to the host package directory.
FROM scratch AS export
COPY --from=build /out /
