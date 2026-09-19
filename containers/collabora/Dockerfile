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
#   security.capabilities — at the image's default (true) since 2026-09-19. Until then it was set
#                           false, on the assumption that Cloudflare Containers grant none of the
#                           chroot-jail capabilities, and that setting was the line the editor's
#                           server audit reported as "Documents are not effectively contained":
#                           coolwsd chroots a document's kit only with those capabilities, and with
#                           them off it also refuses to try Linux user namespaces instead
#                           (wsd/COOLWSD.cpp: "MountNamespaces is not compatible with NoCapsForKit").
#                           The owner's deploy of 2026-09-19 proved the assumption wrong: with the
#                           setting on, the kit is jailed and the audit reports each document as
#                           securely contained. Whether that jail came from a user + mount namespace
#                           or from the file capabilities the image sets on coolforkit is a line in
#                           the container log ("Using Mount Namespaces: 1", or nothing), and it
#                           decides the next setting. Should a later image or runtime refuse both,
#                           no document opens and the log says "Capabilities are not set for the
#                           coolforkit program"; the revert is `--o:security.capabilities=false`
#                           first in extra_params, and the audit line returns as the consequence.
#   mount_jail_tree — at the image's default (true) since 2026-09-19, the second experiment. It
#                     bind-mounts the kit's files into the jail rather than linking or copying
#                     them, which is the fast path, and the audit's "Fast kit jail bind mounting
#                     not configured" recommendation while it was off. A bind mount needs
#                     CAP_SYS_ADMIN in the mount namespace it runs in: a namespace of the kit's own
#                     (the containment result above makes that likely) grants it, the container's
#                     initial namespace does not. coolwsd tests the mount at startup before relying
#                     on it (common/JailUtil.cpp setupChildRoot), so the failure mode is not an
#                     outage: the kit falls back to linking or copying, documents open exactly as
#                     before, and the audit reports "Slow Kit jail setup with copying, cannot
#                     bind-mount" as a failure line. Should that be what the audit says, restore
#                     `--o:mount_jail_tree=false` to extra_params, which turns the same copying back
#                     into the recommendation-level line.
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
ENV extra_params="--o:ssl.enable=false --o:ssl.termination=true --o:num_prespawn_children=1 --o:storage.wopi.alias_groups[@mode]=groups --o:storage.wopi.alias_groups.group[0].host=http://wopi.magna-carta.internal:80 --o:storage.wopi.alias_groups.group[0].host[@allow]=true --o:home_mode.enable=true --o:welcome.enable=false --o:admin_console.username= --o:admin_console.password="

# coolwsd's HTTP + WebSocket port — matches DocumentEditorContainer.defaultPort. The image's own
# entrypoint (which generates the TLS material when asked to, maps the container's user id, and execs
# coolwsd with the overrides above) is left in place.
EXPOSE 9980
