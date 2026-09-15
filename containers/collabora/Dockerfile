# One-document Collabora Online (coolwsd) editor container for the magna-carta-edit worker. coolwsd
# serves the editor + the document WebSocket on 9980. It is a WOPI CLIENT: it calls back to
# wopi.magna-carta.internal, which the edit worker's outbound interception forwards to the app worker
# over the service binding — coolwsd itself has no egress (enableInternet=false on the Container class).
# Built + deployed by Cloudflare Workers Builds (the ~2 GB image builds on Cloudflare's network).
#
# Pin to a tested digest at deploy and rebuild periodically for Collabora security patches (the same
# posture the scan worker takes for ClamAV signatures); `:latest` here is the scaffold default.
FROM collabora/code:latest

# WOPI host allow-list — coolwsd accepts WOPI storage requests only from trusted hosts. The single
# trusted host is the internal WOPISrc host that the editor container intercepts and forwards to the app
# worker (http on the default port 80 — the call is captured inside the Workers runtime and never leaves
# it). `aliasgroupN` is the collabora/code image's env for the storage.wopi.alias_groups config.
ENV aliasgroup1="http://wopi.magna-carta.internal:80"

# No TLS inside the container: TLS terminates at the Cloudflare edge and coolwsd trusts that termination,
# so no self-signed certificate is generated.
ENV DONT_GEN_SSL_CERT="true"

# coolwsd overrides (the image applies `extra_params` to coolwsd.xml):
#   ssl.enable=false / ssl.termination=true — coolwsd speaks http behind the edge TLS terminator.
#   num_prespawn_children=1 — one container serves one document, so one kit (shrinks the memory floor;
#                             the shipped coolwsd.xml default is 4).
#   security.capabilities=false — run without the chroot-jail Linux capabilities that Cloudflare
#                                 Containers do not grant (the kit uses a plain process boundary).
#   admin_console.username/password empty — the admin console is disabled (no operator surface exposed).
ENV extra_params="--o:ssl.enable=false --o:ssl.termination=true --o:num_prespawn_children=1 --o:security.capabilities=false --o:admin_console.username= --o:admin_console.password="

# coolwsd's HTTP + WebSocket port — matches DocumentEditorContainer.defaultPort. The image's own
# entrypoint (which generates coolwsd.xml from the env above and execs coolwsd) is left in place.
EXPOSE 9980

# WHO MAY FRAME THE EDITOR. coolwsd serves the editor under a Content-Security-Policy whose
# `frame-ancestors` it composes itself, and the only sources it allows without being told are its own
# host and the WOPI host. The application is neither: it is served from a different registrable domain
# on purpose (the cookieless content-domain split above), so the browser refuses to render the editor
# in the app's frame and the member gets a white rectangle. Nothing reaches the console of the page
# that embedded it, because a frame-ancestors refusal is reported in the FRAMED document's context —
# which is why this cost a long time to see. The app origins therefore have to be named here.
#
# THESE VALUES CANNOT RIDE `extra_params`. The image's entrypoint expands that variable unquoted, so a
# value containing spaces is split into separate arguments and the setting silently arrives truncated
# at its first space. A list of origins is spaces by definition, so it is written into coolwsd.xml at
# build time instead, where nothing re-splits it.
#
# Both elements are set because the version that serves a document decides which one it reads:
# `frame_ancestors` is marked obsolete in favour of `content_security_policy`, and releases exist that
# honour one and ignore the other. They merge into the same directive, so naming both costs nothing
# and removes the version from the question.
#
# The origins are the app's own, and they are the same set the direct-upload CORS policy allows from
# (apps/api-worker/src/files/browser-upload-cors.ts) — keep the two in step. The wildcard covers the
# per-firm branded subdomains (<firm>.magnacarta.esq) as well as app.magnacarta.esq.
ENV MC_FRAME_ANCESTORS="https://magnacarta.esq https://*.magnacarta.esq https://magna-carta-web.trevordgoldsmith.workers.dev https://magna-carta.trevordgoldsmith.workers.dev"

# The edit ASSERTS BEFORE AND AFTER. An upstream image that renames or drops either element would
# otherwise leave a sed that matched nothing — a build that goes green and a white frame in
# production, which is the exact failure this whole block exists to end. Failing the image build is
# the cheap place to find that out.
RUN set -eu; \
    config=/etc/coolwsd/coolwsd.xml; \
    for element in content_security_policy frame_ancestors; do \
      grep -q "<${element}" "$config" \
        || { echo "coolwsd.xml has no <${element}> element to set; the upstream image changed." >&2; exit 1; }; \
    done; \
    perl -0pi -e 's{(<content_security_policy\b[^>]*>).*?(</content_security_policy>)}{$1 . "\n      frame-ancestors " . $ENV{MC_FRAME_ANCESTORS} . ";\n      " . $2}se' "$config"; \
    perl -0pi -e 's{(<frame_ancestors\b[^>]*>).*?(</frame_ancestors>)}{$1 . $ENV{MC_FRAME_ANCESTORS} . $2}se' "$config"; \
    for element in content_security_policy frame_ancestors; do \
      perl -0ne "exit 1 unless m{<\Q${element}\E\b[^>]*>(.*?)</\Q${element}\E>}s && index(\$1, \$ENV{MC_FRAME_ANCESTORS}) >= 0" "$config" \
        || { echo "the frame-ancestors edit did not land inside <${element}>." >&2; exit 1; }; \
    done; \
    echo "coolwsd frame-ancestors: $MC_FRAME_ANCESTORS"
