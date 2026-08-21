---
category: Changed
audience: internal
---

**`apps/worker` is now `apps/api-worker`, `apps/web` folds into `apps/web-worker`, and two comments
that claimed the custom domain had not attached are corrected.**

The directory naming convention across the fleet is strip `magna-carta-`, append `-worker`, which
turned the root script `magna-carta` into a directory called `worker`. It reads as an oversight
rather than as the convention applied, and the question had been asked twice. The package moves with
it: `@magna-carta/worker` becomes `@magna-carta/api-worker`.

**The Cloudflare script names do not change.** `magna-carta` and `magna-carta-web` are what they were.
A script rename would create a new Worker and its Durable Object namespaces would not follow — which
matters most for `FirmDatabase`, the per-firm database. Nothing in production moves here. The one
dashboard field that does change is the app Worker's deploy command, which names the package.

**The interface source folds into the Worker that serves it.** `apps/web` was the only entry under
`apps/` that was not a deployable — SvelteKit source whose build output another Worker served. It is
now one package holding both the source and its `wrangler.jsonc`, the shape `status-worker` already
has. Four cross-references in `packages/design-system` move with it: the stylesheet and boot-script
mirror tests read the application's own CSS and HTML by path, and the off-token and boundary fitness
sweeps are rooted at its source tree.

**And the comment that made a two-month blockage look like an account problem.** Both Workers said
`workers.dev` was the only reachable URL "until magnacarta.esq attaches". The zone has been live since
2026-06-15 and `status-worker` already serves `status.magnacarta.esq` on a custom-domain route. The
comments now say what is true: no `routes` are declared, which is a step nobody has taken rather than
one that is blocked, and taking it wants the session cookie's domain widened and a cross-origin
allowance first.
