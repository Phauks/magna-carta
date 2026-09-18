# One-document Collabora Online (coolwsd) editor container for the magna-carta-edit worker. coolwsd
# serves the editor + the document WebSocket on 9980. It is a WOPI CLIENT: it calls back to
# wopi.magna-carta.internal, which the edit worker's outbound interception forwards to the app worker
# over the service binding — coolwsd itself has no egress (enableInternet=false on the Container class).
# Built + deployed by Cloudflare Workers Builds (the ~2 GB image builds on Cloudflare's network).
#
# Pin to a tested digest at deploy and rebuild periodically for Collabora security patches (the same
# posture the scan worker takes for ClamAV signatures); `:latest` here is the scaffold default.
FROM collabora/code:latest

# No TLS inside the container: TLS terminates at the Cloudflare edge and coolwsd trusts that termination,
# so no self-signed certificate is generated.
ENV DONT_GEN_SSL_CERT="true"

# coolwsd configuration. Every entry is a `--o:<xmlpath>=<value>` override: the image's entrypoint expands
# `${extra_params}` onto coolwsd's own command line, and coolwsd folds each one into its highest-priority
# configuration layer (wsd/COOLWSD.cpp, the "override" option). This is the ONE channel this file
# configures coolwsd through, and it is proven in this deployment — ssl.enable=false below is why the
# editor serves over plain HTTP behind the edge at all.
#
#   ssl.enable=false / ssl.termination=true — coolwsd speaks http behind the edge TLS terminator.
#   num_prespawn_children=1 — one container serves one document, so one kit (shrinks the memory floor;
#                             the shipped coolwsd.xml default is 4).
#   security.capabilities=false — run without the chroot-jail Linux capabilities that Cloudflare
#                                 Containers do not grant (the kit uses a plain process boundary).
#                                 This is the line the editor's server audit reports as "Documents
#                                 are not effectively contained: missing capabilities or
#                                 namespaces": coolwsd chroots a document's kit only with those
#                                 capabilities, and with them off it also refuses to try Linux user
#                                 namespaces instead (wsd/COOLWSD.cpp: "MountNamespaces is not
#                                 compatible with NoCapsForKit"), so the audit line is the stated
#                                 consequence of this setting, not a fault beside it. Every document
#                                 still runs in its own container with no egress, which is the
#                                 boundary this platform relies on. Turning the setting on is an
#                                 experiment with one outcome that stops every open: coolforkit
#                                 exits at startup when it holds neither the file capabilities nor
#                                 a working namespace, so it wants a deploy somebody is watching.
#   mount_jail_tree=false — the kit's files are linked or copied into its jail rather than
#                           bind-mounted. Bind-mounting needs CAP_SYS_ADMIN, which the container
#                           does not have; left on, coolwsd tries the mount, fails, falls back to
#                           copying anyway and reports the failed mount in its server audit. Off,
#                           the same copying happens and the audit reads it as a recommendation.
#   home_mode.enable=true + welcome.enable=false — the editor's own "what's new" dialog is not shown on
#                          open, and neither is its feedback prompt. The dialog decides whether to show
#                          itself from a version it remembers in the BROWSER'S storage for the editor's
#                          origin, and every document here is its own origin, so it would open on every
#                          document a member ever opened for the first time. This image is the community
#                          build, which forces the dialog on unless home mode is enabled (wsd/COOLWSD.cpp
#                          and wsd/FileServer.cpp read `home_mode.enable` before honouring
#                          `welcome.enable`); home mode also caps one coolwsd at 10 documents and 20
#                          connections, which one container serving one document never reaches. Help >
#                          What's New still opens the dialog on request; whether the editor was updated
#                          is the platform's to say (the version report), not a dialog over the document.
#   admin_console.username/password empty — the admin console is disabled (no operator surface exposed).
#                                            They stay LAST: the container gate reads an empty `password=`
#                                            followed by another token as a password with that value.
#
#   storage.wopi.alias_groups — the WOPI host allow-list. coolwsd accepts a document only from a WOPI
#   host it trusts, and the single trusted host is the internal WOPISrc host the container's outbound
#   interception forwards to the app worker (http on port 80 — the call is captured inside the Workers
#   runtime and never leaves it). A host it does not trust answers the editor with "Unauthorized WOPI
#   host". Three overrides state it, and all three are needed: the group's host, the group's allow flag,
#   and the mode, which must read `groups` for the group to count — wsd/HostUtil.cpp parseAliases
#   refuses a group defined under the template's default mode `first`.
#
#   Deliberately NOT the image's `aliasgroupN` environment variable, which is what an earlier revision
#   used and what the image documents. That route is read by coolwsd itself, only when the entrypoint
#   passes `--use-env-vars`, and its mode switch is written to the key `alias_groups[@mode]` — without the
#   `storage.wopi.` prefix that parseAliases reads (wsd/COOLWSD.cpp initializeEnvOptions). In practice the
#   variable was set, the WebSocket connected, and the editor still refused the host. The overrides below
#   name the correctly prefixed key and reach coolwsd through the channel above whether or not the
#   entrypoint of a given image version reads environment variables at all.
#
#   The `[0]` in two of the keys is a bash glob character class when `${extra_params}` is expanded
#   unquoted, and it stays literal because no file in the entrypoint's working directory can match a
#   word of that shape. Quoting the expansion in this file is not an option — the entrypoint is the
#   image's, not ours.
ENV extra_params="--o:ssl.enable=false --o:ssl.termination=true --o:num_prespawn_children=1 --o:security.capabilities=false --o:mount_jail_tree=false --o:storage.wopi.alias_groups[@mode]=groups --o:storage.wopi.alias_groups.group[0].host=http://wopi.magna-carta.internal:80 --o:storage.wopi.alias_groups.group[0].host[@allow]=true --o:home_mode.enable=true --o:welcome.enable=false --o:admin_console.username= --o:admin_console.password="

# coolwsd's HTTP + WebSocket port — matches DocumentEditorContainer.defaultPort. The image's own
# entrypoint (which generates the TLS material when asked to, maps the container's user id, and execs
# coolwsd with the overrides above) is left in place.
EXPOSE 9980
