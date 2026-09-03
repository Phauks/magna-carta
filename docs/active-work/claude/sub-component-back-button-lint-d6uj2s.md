---
worktree: /home/user/magna-carta (remote session)
area: Return navigation — every sub-screen of a main screen carries a way back to it, and a gate that says so
status: review
touches: apps/web/src/lib/navigation/back-link.svelte, apps/web/src/lib/matters/matter-header.svelte, apps/web/src/routes/(app)/directory/[id], apps/web/src/routes/(app)/conflicts, apps/web/src/routes/developer-console, tooling/lint-back-navigation/, package.json, vite.config.ts, docs/conventions/ui-design.md, changelog.d/
---

The owner's direction: entering a sub-screen of a main screen — a matter from the docket, a person
from the directory — must always put a way back to that main screen at the top of the screen's own
header. Two forms already existed and neither was general: the tools layout's labelled `BackLink`
above the masthead, and the matter header's arrow-only return leading its ledger line. This stream
makes `BackLink` carry both forms, gives the screens that had no way back one (the directory record,
both conflicts detail screens, the four developer-console galleries), and adds
`pnpm run lint:back-navigation` so a sub-screen shipped without one fails the gate instead of being
noticed in review.

The lint is repo-wide by derivation (every `lint:*` script in the root manifest is), so it runs in
the inner loop and in CI with no workflow edit. A concurrent stream adding a route under an existing
screen will meet it.
