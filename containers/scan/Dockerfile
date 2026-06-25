# The scan Container image: a long-lived clamd daemon plus the Rust scan service, sharing one
# linux/amd64 container. The Rust service listens on :8080 and fans each /scan body to clamd (loopback
# TCP), yara-x, and the structural heuristics. Build context is this directory (containers/scan).

# --- build stage: compile the Rust scan service + bundle the YARA rules ----------------------------
FROM rust:1-bookworm AS build
WORKDIR /src

# Which YARA Forge tier to bake, the heuristic-_SUSP_ score floor below which the FP-prone pocket is
# dropped, and an optional pinned release tag. Empty YARA_FORGE_TAG (the default) resolves the LATEST
# release, so the nightly Deploy-Hook rebuild self-updates the rules — the same way `freshclam` keeps the
# clamd database current. Pin a tag for a reproducible build or a rules rollback.
ARG YARA_FORGE_TIER=extended
ARG YARA_MIN_SUSP_SCORE=75
ARG YARA_FORGE_TAG=

# curl/unzip/jq fetch + unpack the release; ca-certificates for the GitHub TLS handshake.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --bin magna-carta-scan --bin build-yara-rules

# Resolve the release tag (latest unless pinned), download the tier package, then filter + compile +
# serialize it with build-yara-rules. build-yara-rules fails the build loud on an empty/inconsistent
# package or a systemic compile failure (see src/bin/build-yara-rules.rs), so a broken rules fetch stops
# the image rather than shipping a degraded scanner. The resolved tag is written next to the blob and
# becomes the engine-version `yara-rules` component at runtime.
RUN set -eux; \
    TAG="${YARA_FORGE_TAG}"; \
    if [ -z "$TAG" ]; then \
      TAG="$(curl -fsSL https://api.github.com/repos/YARAHQ/yara-forge/releases/latest | jq -r .tag_name)"; \
    fi; \
    test -n "$TAG" && test "$TAG" != "null"; \
    mkdir -p /out /forge; \
    curl -fsSL -o /forge/rules.zip \
      "https://github.com/YARAHQ/yara-forge/releases/download/${TAG}/yara-forge-rules-${YARA_FORGE_TIER}.zip"; \
    unzip -o /forge/rules.zip -d /forge >/dev/null; \
    YAR_COUNT="$(find /forge -name '*.yar' | wc -l)"; \
    test "$YAR_COUNT" -eq 1 || { echo "expected exactly one .yar in the YARA Forge package, found $YAR_COUNT — the package layout changed; bundling 'head -1' would silently drop rules" >&2; exit 1; }; \
    YAR="$(find /forge -name '*.yar')"; \
    /src/target/release/build-yara-rules "$YAR" /out/yara-rules.bin "${YARA_MIN_SUSP_SCORE}"; \
    printf '%s' "$TAG" > /out/yara-rules.tag

# --- runtime stage: clamd + the service -----------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clamav clamav-daemon clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Bake the initial signature database at BUILD time. The container runs with no network egress
# (enableInternet = false), so the DB cannot be fetched at runtime — a refresh is an image rebuild
# (or a separate signed-update job, a documented seam). `|| true` so a transient mirror hiccup does
# not fail the image; clamd reports an empty DB clearly if it ever happens.
RUN freshclam || true

COPY --from=build /src/target/release/magna-carta-scan /usr/local/bin/scan

# The compiled, filtered, serialized YARA rule blob and the release tag it was built from. The service
# deserializes the blob at boot (no startup recompile) and reports the tag in its engine version. The
# container has no network egress, so these are fixed for the image's lifetime — a rules refresh is an
# image rebuild (the same model as the baked clamd database above).
COPY --from=build /out/yara-rules.bin /etc/scan/yara-rules.bin
COPY --from=build /out/yara-rules.tag /etc/scan/yara-rules.tag
ENV YARA_RULES_PATH=/etc/scan/yara-rules.bin

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
