# The raster conversion engine: a pure-Rust (image crate) axum service on :8080. No C codec libraries —
# untrusted image bytes are decoded by memory-safe Rust. Build context is this directory.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin magna-carta-raster

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/magna-carta-raster /usr/local/bin/raster
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/raster"]
