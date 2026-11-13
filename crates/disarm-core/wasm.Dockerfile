# syntax=docker/dockerfile:1
# Build helper (NOT a runtime container): compiles the @magna-carta/disarm WebAssembly artifact
# (crates/disarm-core -> packages/disarm/src/pkg) in a pinned Rust toolchain, the same way
# crates/seven-zip-core/wasm.Dockerfile does. Never deployed: it exports the wasm-pack output to the
# host with `docker build --output`. Build context is the crates/ workspace.
FROM rust:1-bookworm AS build
RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-pack --locked
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    wasm-pack build disarm-core --target web --out-dir /out --release --no-opt

FROM scratch AS export
COPY --from=build /out /
