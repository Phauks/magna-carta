# The OCR engine container: a pure-Rust axum service wrapping PP-OCRv6 (small tier) through the
# `ort` ONNX Runtime binding. Listens on :8080 -- POST /ocr, GET /ready. No network egress at
# runtime; the models are baked in at build time and verified by content hash.
#
# Build context: the repository root (image_build_context in apps/ocr-worker/wrangler.jsonc), so
# the crates/ workspace is reachable alongside this directory.
# Example: docker build -f containers/ocr/Dockerfile -t magna-carta-ocr .

# --- build stage: compile the OCR service -----------------------------------------------------
# ONNX Runtime's prebuilt binaries (pulled in by the `ort` crate, via oar-ocr) reference glibc 2.38
# symbols. bookworm ships glibc 2.36 and fails to link -- a failure that only appears in the cloud
# build, never locally. Both this stage and the runtime stage below must be trixie, and they must
# match, exactly as containers/scan does for the same reason (Magika's onnxruntime there).
FROM rust:1-trixie AS build
WORKDIR /src

# Copy the WHOLE crates/ workspace, not just ocr-core: ocr-core and pdf-core inherit `edition` and
# dependency versions from crates/Cargo.toml via `workspace = true`, so cargo must see that root to
# resolve the inheritance. Only ocr-core, pdf-core, and engine-host actually compile into this
# binary; the rest are read as manifests for workspace resolution. The root .dockerignore keeps
# every crate's target/ out of the build context.
COPY crates crates
COPY containers/ocr containers/ocr
WORKDIR /src/containers/ocr

# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# binary is copied out to /artifacts in the same RUN before the mount drops -- the runtime stage
# reads it from there, not from target/. See docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/containers/ocr/target \
    cargo build --release --bin magna-carta-ocr \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-ocr /artifacts/

# --- models stage: the pinned PP-OCRv6 small artifacts, fetched and hash-verified --------------
# Fetched here, where the stage has network; the runtime stage below has none. Each `inference.onnx`
# is verified by content hash: a silently changed model would silently change every recognition
# result, and the model version stamped onto results would then be a lie. This mirrors how the scan
# container fetches YARA Forge rules and runs freshclam at build time.
FROM debian:trixie-slim AS models
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /models

# The small tier: ties the medium tier on character error rate within noise, leads it on word-box
# localization, and is a quarter the download/cold-load size (31 MB vs 139 MB) -- see
# docs/specs/2026-07-09-ocr-engine-design.md for the measurement.
ARG DET_REVISION=28fe5895c24fd108c19eb3e8479f4ab385fbfc62
ARG REC_REVISION=b8f84f0b80c529de40b4fbb3544b84fa7233a513
ARG DET_SHA256=d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e
ARG REC_SHA256=5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634

RUN set -eux; \
    mkdir -p detection recognition; \
    base="https://huggingface.co/PaddlePaddle"; \
    curl -fsSL -o detection/inference.onnx   "$base/PP-OCRv6_small_det_onnx/resolve/$DET_REVISION/inference.onnx"; \
    curl -fsSL -o detection/inference.yml    "$base/PP-OCRv6_small_det_onnx/resolve/$DET_REVISION/inference.yml"; \
    curl -fsSL -o recognition/inference.onnx "$base/PP-OCRv6_small_rec_onnx/resolve/$REC_REVISION/inference.onnx"; \
    curl -fsSL -o recognition/inference.yml  "$base/PP-OCRv6_small_rec_onnx/resolve/$REC_REVISION/inference.yml"; \
    echo "$DET_SHA256  detection/inference.onnx"   | sha256sum -c -; \
    echo "$REC_SHA256  recognition/inference.onnx" | sha256sum -c -

# --- runtime stage: minimal debian image, no compiler, no network --------------------------------
# trixie (glibc 2.41) must match the build stage: onnxruntime is statically linked into the binary,
# but its compiled-in C++ code still calls into libstdc++ and libgomp at run time, and references
# glibc >= 2.38 symbols the dynamic libc resolves at load time.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build  /artifacts/magna-carta-ocr /usr/local/bin/ocr
COPY --from=models /models                    /models

# The model version travels with every result. It names the exact artifact pair (first seven
# characters of each pinned revision), so a result produced before a model upgrade is never mistaken
# for one produced after.
ENV MAGNA_CARTA_OCR_MODELS=/models \
    MAGNA_CARTA_OCR_MODEL_VERSION=PP-OCRv6_small@28fe589-b8f84f0

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ocr"]
