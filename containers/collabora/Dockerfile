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
