# The scan Container image: a long-lived clamd daemon plus the Rust scan service, sharing one
# linux/amd64 container. The Rust service listens on :8080 and fans each /scan body to clamd (loopback
# TCP), yara-x, and the structural heuristics. Build context is this directory (containers/scan).

# --- build stage: compile the Rust scan service + bundle the YARA rules ----------------------------
# trixie (glibc 2.41), not bookworm (glibc 2.36): ort's prebuilt onnxruntime (download-binaries, for
# the Magika /identify engine) is compiled against glibc >= 2.38 and references __isoc23_strtol*
# symbols, so it only links against a glibc that provides them. The runtime stage must match (the
# statically-linked onnxruntime resolves those symbols against the runtime libc too).
FROM rust:1-trixie AS build
WORKDIR /src

# The heuristic-_SUSP_ score floor below which the FP-prone pocket is dropped (histogram/log only —
# the runtime policy layer maps raw facts to verdicts), and an optional pinned release tag. Empty
# YARA_FORGE_TAG (the default) resolves the LATEST release, so the nightly Deploy-Hook rebuild
# self-updates the rules — the same way `freshclam` keeps the clamd database current. Pin a tag for
# a reproducible build or a rules rollback. All three tiers (core, extended, full) are baked so
# callers can query rule metadata across any tier without an image rebuild.
ARG YARA_MIN_SUSP_SCORE=75
ARG YARA_FORGE_TAG=

# curl/unzip/jq fetch + unpack the release; ca-certificates for the GitHub TLS handshake.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src
# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds so an
# unchanged dependency graph is not recompiled. A cache mount is not part of the image layer, so the
# two binaries are copied out to /artifacts (a normal path) in the same RUN before the mount drops —
# later stages read them from there, not from target/. See docs/conventions/build-performance.md.
# rust:1-trixie (via buildpack-deps:trixie) already provides libssl-dev + pkg-config —
# no extra apt step needed for ort's openssl-sys build dependency.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release --bin magna-carta-scan --bin build-yara-rules \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-scan target/release/build-yara-rules /artifacts/

# Resolve the release tag, download all three tier packages (core/extended/full), then filter +
# compile + serialize them with build-yara-rules into a single binary rule blob and a side-map JSON.
# build-yara-rules fails the build loud on an empty/inconsistent package or a systemic compile
# failure, so a broken rules fetch stops the image rather than shipping a degraded scanner. Each
# package is unpacked into its own directory and guarded for exactly one .yar — the layout invariant
# from the original single-tier fetch applied per package, so a changed upstream layout fails loud
# rather than silently bundling partial rules. The resolved tag is written next to the blob and
# becomes the engine-version `yara-rules` component at runtime.
#
# Tag resolution deliberately avoids the api.github.com REST endpoint: it is rate-limited to 60
# requests/hour per IP for unauthenticated callers, and the shared CI build runners exhaust that
# quota, so the nightly self-updating rebuild would intermittently 403 → empty tag → 404 on the
# asset URLs. Instead "latest" is read from the github.com/.../releases/latest 302 redirect, whose
# Location carries /releases/tag/<TAG>; that web/CDN surface is the same one the asset downloads use
# and is not API-rate-limited. The REST endpoint stays as a last-resort fallback, and every network
# step retries with backoff so a transient blip does not fail the image. See
# docs/conventions/build-performance.md.
RUN set -eux; \
    retry() { \
      _n=0; \
      while :; do \
        if "$@"; then return 0; fi; \
        _n=$((_n+1)); \
        if [ "$_n" -ge 5 ]; then return 1; fi; \
        echo "yara-forge: command failed, retry $_n/5" >&2; \
        sleep $((_n*3)); \
      done; \
    }; \
    TAG="${YARA_FORGE_TAG}"; \
    if [ -z "$TAG" ]; then \
      _n=0; \
      while [ -z "$TAG" ] && [ "$_n" -lt 5 ]; do \
        TAG="$(curl -fsS -o /dev/null -w '%{redirect_url}' https://github.com/YARAHQ/yara-forge/releases/latest | sed -n 's#.*/releases/tag/##p')"; \
        if [ -z "$TAG" ]; then \
          _n=$((_n+1)); echo "yara-forge: latest-tag redirect resolve failed, retry $_n/5" >&2; sleep $((_n*3)); \
        fi; \
      done; \
      if [ -z "$TAG" ]; then \
        echo "yara-forge: redirect resolve exhausted; falling back to api.github.com" >&2; \
        _n=0; \
        while [ -z "$TAG" ] && [ "$_n" -lt 5 ]; do \
          TAG="$(curl -fsSL https://api.github.com/repos/YARAHQ/yara-forge/releases/latest | jq -r '.tag_name // empty')"; \
          if [ -z "$TAG" ]; then \
            _n=$((_n+1)); echo "yara-forge: api.github.com tag resolve failed, retry $_n/5" >&2; sleep $((_n*5)); \
          fi; \
        done; \
      fi; \
    fi; \
    test -n "$TAG" && test "$TAG" != "null"; \
    mkdir -p /out /forge/core /forge/extended /forge/full; \
    retry curl -fsSL -o /forge/core.zip \
      "https://github.com/YARAHQ/yara-forge/releases/download/${TAG}/yara-forge-rules-core.zip"; \
    retry curl -fsSL -o /forge/extended.zip \
      "https://github.com/YARAHQ/yara-forge/releases/download/${TAG}/yara-forge-rules-extended.zip"; \
    retry curl -fsSL -o /forge/full.zip \
      "https://github.com/YARAHQ/yara-forge/releases/download/${TAG}/yara-forge-rules-full.zip"; \
    unzip -o /forge/core.zip     -d /forge/core     >/dev/null; \
    unzip -o /forge/extended.zip -d /forge/extended >/dev/null; \
    unzip -o /forge/full.zip     -d /forge/full     >/dev/null; \
    CORE_COUNT="$(find /forge/core     -name '*.yar' | wc -l)"; \
    EXT_COUNT="$(find  /forge/extended -name '*.yar' | wc -l)"; \
    FULL_COUNT="$(find /forge/full     -name '*.yar' | wc -l)"; \
    test "$CORE_COUNT" -eq 1 || { echo "expected exactly one .yar in yara-forge-rules-core, found $CORE_COUNT — the package layout changed; bundling 'head -1' would silently drop rules" >&2; exit 1; }; \
    test "$EXT_COUNT"  -eq 1 || { echo "expected exactly one .yar in yara-forge-rules-extended, found $EXT_COUNT — the package layout changed; bundling 'head -1' would silently drop rules" >&2; exit 1; }; \
    test "$FULL_COUNT" -eq 1 || { echo "expected exactly one .yar in yara-forge-rules-full, found $FULL_COUNT — the package layout changed; bundling 'head -1' would silently drop rules" >&2; exit 1; }; \
    CORE_YAR="$(find     /forge/core     -name '*.yar')"; \
    EXTENDED_YAR="$(find /forge/extended -name '*.yar')"; \
    FULL_YAR="$(find     /forge/full     -name '*.yar')"; \
    /artifacts/build-yara-rules \
      "$FULL_YAR" "$CORE_YAR" "$EXTENDED_YAR" \
      /out/yara-rules.bin /out/yara-rules.sidemap.json "${YARA_MIN_SUSP_SCORE}"; \
    printf '%s' "$TAG" > /out/yara-rules.tag

# --- runtime stage: clamd + the service -----------------------------------------------------------
# trixie (glibc 2.41) must match the build stage: the statically-linked onnxruntime references
# glibc >= 2.38 symbols (__isoc23_strtol*) that the dynamic libc resolves at run time.
FROM debian:trixie-slim

# libstdc++6 + libgomp1: onnxruntime runtime libs for the Magika identify engine. ort statically
# links onnxruntime (no libonnxruntime.so copy needed), but the compiled-in C++ code still calls
# into libstdc++ and libgomp at run time, so they must be present in the container image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clamav clamav-daemon clamav-freshclam ca-certificates \
      libstdc++6 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Bake the initial signature database at BUILD time. The container runs with no network egress
# (enableInternet = false), so the DB cannot be fetched at runtime — a refresh is an image rebuild
# (or a separate signed-update job, a documented seam). `|| true` so a transient mirror hiccup does
# not fail the image; clamd reports an empty DB clearly if it ever happens.
RUN freshclam || true

COPY --from=build /artifacts/magna-carta-scan /usr/local/bin/scan

# The compiled, filtered, serialized YARA rule blob and the release tag it was built from. The service
# deserializes the blob at boot (no startup recompile) and reports the tag in its engine version. The
# container has no network egress, so these are fixed for the image's lifetime — a rules refresh is an
# image rebuild (the same model as the baked clamd database above).
COPY --from=build /out/yara-rules.bin          /etc/scan/yara-rules.bin
COPY --from=build /out/yara-rules.tag          /etc/scan/yara-rules.tag
COPY --from=build /out/yara-rules.sidemap.json /etc/scan/yara-rules.sidemap.json
ENV YARA_RULES_PATH=/etc/scan/yara-rules.bin
ENV YARA_SIDEMAP_PATH=/etc/scan/yara-rules.sidemap.json

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
