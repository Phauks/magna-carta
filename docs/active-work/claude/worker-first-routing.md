---
worktree: /home/user/magna-carta
area: the app Worker's static-asset routing — which path families reach Hono
status: review
touches: apps/worker/wrangler.jsonc, apps/worker/CLAUDE.md, apps/worker/test, changelog.d
---

`assets.run_worker_first` named `/api/*` only, so every other family the Hono app registers was
looked for among the SPA's files first and answered `/index.html` with a 200 — the WOPI host, the
search engine's split-object host, and the local tools demo page. The array now names all four
families, and `apps/worker/test/worker-first-routing-scan.test.ts` holds it against the app's live
Hono dispatch table so a fifth family cannot be added silently.

Do not edit `apps/worker/wrangler.jsonc` while this is open. The stream splitting the SPA into its
own Worker touches the same `assets` block from the other side: if that split lands first, this fix
follows the assets binding to wherever the SPA ends up being bound, and the scan follows it — it
reads whichever configuration sits beside the Hono app.
