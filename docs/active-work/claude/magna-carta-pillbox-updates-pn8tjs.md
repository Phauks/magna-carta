---
worktree: /home/user/magna-carta (remote session)
area: version chip overhaul — full-fleet roster, build/deployment split, upstream-update notice
status: building
touches: apps/web/src/lib/versions/, apps/web/test/version-overlay.test.ts, apps/web/svelte.config.js, apps/web/vite.config.ts, apps/web/package.json, apps/web/scripts/, apps/api-worker/src/routes/meta-versions.ts, apps/api-worker/src/app.ts, apps/api-worker/wrangler.jsonc, apps/api-worker/vitest.config.ts, apps/api-worker/test/meta-versions.test.ts, apps/api-worker/openapi/openapi.json, packages/api-client/, packages/build-identity/, apps/edit-worker/, apps/email-worker/, apps/status-worker/, docs/deploy-queue.md, docs/conventions/operations.md, docs/user/features/seeing-what-version-you-are-on.md, changelog.d/
---

The version chip's overlay becomes a whole-fleet report: the aggregate roster now carries every
worker under apps/ (edit, email, status and web were missing), each row is headed by its deployed
Worker name from the wire itself (the invented per-service labels are gone, and `label` became
`service` in the contract), and the page's own bundle gets its own build line ("This page") instead
of borrowing the `magna-carta` name. SvelteKit's version poll names each build by its commit and the
chip now notices an upstream deploy and offers Reload; the panel's Refresh forces a fresh probe
(`?fresh=true`) instead of re-serving the cached observation. Three version-read-only service
bindings were added to the app worker (EDIT/STATUS/WEB); EMAIL stays unbound until
`magna-carta-email` is on the account. That half landed as #425.

**Added 2026-08-31 — the SPA cutover's repository half.** The owner converted the app's hostname
from a custom domain on `magna-carta` to route patterns (`magna-carta-web` serves the interface;
`magna-carta` its four path families). This stream records it: the
`the-interface-ships-on-its-own-worker` pending ADR, the retired "Different Builds" warning and the
new topology line in the version overlay, the rewritten `assets`-block and web-worker wrangler
comments, the runbook and deploy-queue entries, and the split spec's status. The `assets` block
stays (local dev + e2e + rollback). Concurrent streams should stay out of
`apps/web/src/lib/versions/`, `apps/api-worker/src/routes/meta-versions.ts` and
`packages/build-identity/` until this lands.
