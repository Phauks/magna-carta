---
category: Fixed
audience: public
---

**The editor refused its own WOPI host, because the allow-list was being set through a channel the image does not reliably read.**

Once the frame loaded and the WebSocket connected, coolwsd answered "Unauthorized WOPI host": the WOPISrc host `wopi.magna-carta.internal` was not in its allow-list, even though the container's `aliasgroup1` environment variable named exactly that host. That variable is read by coolwsd itself, and only when the image's entrypoint passes `--use-env-vars`; and the mode switch it writes lands on the key `alias_groups[@mode]`, without the `storage.wopi.` prefix that `parseAliases` reads, so a group defined that way sits under the template's default mode `first`, which is the one state parseAliases refuses. The variable was set, the socket was up, and the host was still rejected.

The allow-list is now three `--o:` overrides in `extra_params` — the group's host, its allow flag, and the mode spelled `storage.wopi.alias_groups[@mode]=groups` — which the entrypoint expands onto coolwsd's command line and coolwsd folds into its highest-priority configuration layer. It is the channel every other setting in that file already uses, and the one this deployment proves works: `ssl.enable=false` from the same string is why the editor serves over HTTP behind the edge at all. It reaches coolwsd whether or not a given image version's entrypoint reads environment variables.

Recorded beside it: the editor worker gains its area note (`apps/edit-worker/CLAUDE.md`), the home for the container's operational knowledge — how the allow-list is set, what "Unauthorized WOPI host" means, and the three coolwsd log lines that decide it.

## Public

Word-processing documents open in the browser editor. The editor had been refusing the host that serves it the document; it trusts it now.
