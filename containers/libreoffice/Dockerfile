# The LibreOffice conversion engine container: a Rust supervisor plus a pool of worker child
# processes, each of which loads the office suite through a dlopen'd C ABI and converts one document
# at a time. Listens on :8080 — POST /convert, GET /ready. No network egress at run time.
#
# Build context: the repository root (image_build_context in apps/convert-worker/wrangler.jsonc), so
# the crates/ workspace is reachable alongside this directory.
# Example: docker build -f containers/libreoffice/Dockerfile -t magna-carta-libreoffice .

# --- build stage: compile the supervisor and the worker -----------------------------------------
# trixie for both stages, matching the runtime below. The Rust binaries link nothing from the suite
# (the binding reaches it through dlopen at run time), but the two stages must still agree on glibc.
FROM rust:1-trixie AS build
WORKDIR /src

# Copy the WHOLE crates/ workspace, not just engine-host: the crates inherit `edition` from
# crates/Cargo.toml via `workspace = true`, so cargo must see that root to resolve the inheritance.
# Only engine-host actually compiles into these binaries. The root .dockerignore keeps every crate's
# target/ out of the build context.
COPY crates crates
COPY containers/libreoffice containers/libreoffice
WORKDIR /src/containers/libreoffice

# BuildKit cache mounts keep the Cargo registry, git cache, and target/ warm across builds. A cache
# mount is not part of the image layer, so the binaries are copied out to /artifacts in the same RUN
# before the mount drops. The fake worker is deliberately NOT built: it is a test double, and the
# image has no business carrying a binary that can be told to hang. See
# docs/conventions/build-performance.md.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/containers/libreoffice/target \
    cargo build --release \
      --bin magna-carta-libreoffice \
      --bin magna-carta-libreoffice-worker \
 && mkdir -p /artifacts \
 && cp target/release/magna-carta-libreoffice \
       target/release/magna-carta-libreoffice-worker /artifacts/

# --- runtime stage -------------------------------------------------------------------------------
FROM debian:trixie-slim

# The Document Foundation's own bundle for the Still branch, not Debian's libreoffice-core: Debian's
# archive serves only the CURRENT version of a package, so a version pin in a Dockerfile 404s the
# moment a security update rotates it — the pin breaks the reproducibility it was written to
# provide. A version-addressed upstream archive verified by hash is the pattern the scan container's
# rule bundle and the OCR container's model artifacts already use, and /opt is exactly the layout the
# binding's installation search expects.
#
# Moving this pin is a deliberate pull request that regenerates the acceptance suite's golden files
# and reviews the diff: a minor version bump can change layout, which means it can change every
# golden file. The counterweight to leaving Debian is real — a Debian package carries Debian's
# security team and an upstream bundle carries only the Foundation's release cadence — and the
# mitigation is that the version is one build argument and the nightly-rebuild pattern applies
# unchanged.
ARG LIBREOFFICE_VERSION=25.8.7
ARG LIBREOFFICE_SERIES=25.8
ARG LIBREOFFICE_SHA256=7f4d7b2e36921eec5122c655249a24cc88935ee357e8261fd3bccd15aa1f7b9f

# The suite. One RUN so the ~200 MB archive, the unpacked packages, and the pruned components never
# reach an image layer, and keyed on the arguments above alone so it caches across every other change
# in this repository.
#
# Writer only. The bundle ships every application as its own package, so the component set is an
# explicit ALLOWLIST rather than a fragile exclusion glob: anything a future bundle adds is excluded
# by default rather than silently installed. Calc, Impress, Draw, Base, Math, the database
# connectors, the desktop integrations, the script providers, the extensions, and the online updater
# are all left out. No Java runtime enters the image — the bundle carries none, and the Java bean is
# pruned below.
#
# --force-depends is deliberate and not a workaround: the packages declare dependencies on the
# sibling components we are choosing not to install, and every file still lands correctly. Nothing
# here is managed by apt afterwards; the suite is a self-contained tree under /opt.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    archive="LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_deb.tar.gz"; \
    curl -fsSL --retry 5 --retry-delay 3 -o /tmp/libreoffice.tar.gz \
      "https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/deb/x86_64/${archive}"; \
    echo "${LIBREOFFICE_SHA256}  /tmp/libreoffice.tar.gz" | sha256sum -c -; \
    mkdir -p /tmp/libreoffice; \
    tar -xzf /tmp/libreoffice.tar.gz -C /tmp/libreoffice --strip-components=1; \
    cd /tmp/libreoffice/DEBS; \
    components=" \
      libreoffice${LIBREOFFICE_SERIES}-ure \
      libreoffice${LIBREOFFICE_SERIES} \
      libreoffice${LIBREOFFICE_SERIES}-writer \
      libreoffice${LIBREOFFICE_SERIES}-en-us \
      libreoffice${LIBREOFFICE_SERIES}-dict-en \
      libobasis${LIBREOFFICE_SERIES}-core \
      libobasis${LIBREOFFICE_SERIES}-writer \
      libobasis${LIBREOFFICE_SERIES}-en-us \
      libobasis${LIBREOFFICE_SERIES}-images \
      libobasis${LIBREOFFICE_SERIES}-ooofonts \
      libobasis${LIBREOFFICE_SERIES}-ooolinguistic \
      libobasis${LIBREOFFICE_SERIES}-graphicfilter \
      libobasis${LIBREOFFICE_SERIES}-xsltfilter \
      libobasis${LIBREOFFICE_SERIES}-libreofficekit-data \
    "; \
    selected=""; \
    for component in $components; do \
      match="$(ls -1 "${component}"_*.deb 2>/dev/null | head -1)"; \
      test -n "$match" || { echo "the bundle no longer carries a package named ${component} — the component set changed; installing a partial suite silently would be worse than failing here" >&2; exit 1; }; \
      selected="$selected $match"; \
    done; \
    # shellcheck disable=SC2086
    dpkg --force-depends -i $selected; \
    install_root="/opt/libreoffice${LIBREOFFICE_SERIES}"; \
    test -f "${install_root}/program/libmergedlo.so" || { echo "the suite's merged library is missing from ${install_root}/program — the install layout changed" >&2; exit 1; }; \
    # Headless-only pruning. Each of these is the sole reason a whole system library stack would
    # otherwise have to be installed, and none of them is reachable from a conversion: the tiled
    # editing widget (GTK), media playback (GStreamer), the Java bean, and the MySQL connector.
    rm -f "${install_root}/program/liblibreofficekitgtk.so" \
          "${install_root}/program/libavmediagst.so" \
          "${install_root}/program/libofficebean.so" \
          "${install_root}/program/libmysqlclo.so"; \
    # Help, the gallery, and the readmes are bulk this container never serves.
    rm -rf "${install_root}/help" "${install_root}/readmes" "${install_root}/share/gallery"; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /tmp/libreoffice /tmp/libreoffice.tar.gz /var/lib/apt/lists/*

# The system libraries the suite resolves at load time, and the fonts.
#
# Carlito and Caladea are the load-bearing pair: they are metric-compatible with Calibri and Cambria,
# and without them the suite substitutes Liberation and the layout shifts. Liberation 2 covers the
# Arial/Times/Courier metrics; DejaVu and Noto Core cover the rest. Noto CJK is a judgment call — it
# adds roughly a hundred megabytes for documents we will meet only occasionally, but a CJK exhibit
# rendering as replacement boxes is a silent correctness failure in a discovery context.
#
# A font package upgrade shifts layout as surely as a suite upgrade and is far easier to let through
# unnoticed; the acceptance suite's embedded-font-name assertion is what turns an accidental
# substitution into a red build rather than a subtly wrong PDF.
#
# fc-cache runs here so no worker pays font-cache construction at boot — that cost would land on the
# first conversion after every cold start.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      libx11-6 libx11-xcb1 libxext6 libxrender1 libxinerama1 libxrandr2 libsm6 libice6 \
      libcairo2 libcairo-gobject2 libcups2t64 libdbus-1-3 libfontconfig1 libfreetype6 \
      libglib2.0-0t64 libnspr4 libnss3 libgssapi-krb5-2 libavahi-client3 libavahi-common3 \
      libstdc++6 zlib1g \
      fontconfig fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 \
      fonts-dejavu-core fonts-noto-core fonts-noto-cjk; \
    fc-cache -f; \
    rm -rf /var/lib/apt/lists/*

# Fail the build on an unresolved shared library rather than the first conversion.
#
# The suite is a prebuilt upstream tree, so nothing in the package manager knows what it needs: the
# system library list above was derived by reading the tree's own ELF dependencies, and a wrong or
# renamed Debian package would otherwise surface as a container that boots, reports itself not ready
# for its whole warm deadline, and never says why.
RUN set -eux; \
    missing="$(ldd "/opt/libreoffice${LIBREOFFICE_SERIES}/program/libmergedlo.so" | grep 'not found' || true)"; \
    test -z "$missing" || { echo "the suite has unresolved shared libraries:"; echo "$missing"; exit 1; }

COPY --from=build /artifacts/magna-carta-libreoffice        /usr/local/bin/libreoffice-supervisor
COPY --from=build /artifacts/magna-carta-libreoffice-worker /usr/local/bin/libreoffice-worker

# The baked user profile every worker starts from — macro execution disabled, link updating off. The
# supervisor copies this tree into each worker's own home directory, which is how each worker gets
# its own UserInstallation: the binding's bootstrap takes no profile argument, so the profile is
# selected the way the suite itself resolves it, from the process's home.
COPY containers/libreoffice/profile /opt/magna-carta/libreoffice-profile

# An unprivileged user, and the only two writable surfaces the service needs: the job spool and the
# per-worker profiles. Everything else in the image is read-only to the running service.
RUN set -eux; \
    useradd --system --create-home --home-dir /var/lib/magna-carta --shell /usr/sbin/nologin convert; \
    mkdir -p /var/spool/magna-carta-libreoffice /var/lib/magna-carta/profiles; \
    chown -R convert:convert /var/spool/magna-carta-libreoffice /var/lib/magna-carta

USER convert

ENV MAGNA_CARTA_LIBREOFFICE_WORKER=/usr/local/bin/libreoffice-worker \
    MAGNA_CARTA_LIBREOFFICE_SPOOL=/var/spool/magna-carta-libreoffice \
    MAGNA_CARTA_LIBREOFFICE_PROFILE_ROOT=/var/lib/magna-carta/profiles \
    MAGNA_CARTA_LIBREOFFICE_PROFILE_TEMPLATE=/opt/magna-carta/libreoffice-profile \
    SAL_USE_VCLPLUGIN=svp

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/libreoffice-supervisor"]
