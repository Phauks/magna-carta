---
number: 412
slug: the-interface-ships-on-its-own-worker
status: Accepted
date: 2026-08-31
area: Platform / Delivery
summary: "The application's hostname was converted from a custom domain on the API Worker to route patterns on the zone: magna-carta-web (assets-only) serves the interface on every path, and magna-carta is routed only its own four path families (/api/*, /wopi/*, /search-objects/*, /__dev/*). Same origin, same cookie, no CORS. This answers the split design's two owner flags: W1 yes, W2 the existing apex. Interface deploys decouple from API deploys through the magna-carta project's Build Watch Paths (dropping apps/web/*), not through code: the API Worker keeps its assets block deliberately, as the local-dev vehicle (wrangler dev and the e2e suite serve the whole app from it) and the one-gesture rollback (repoint the /* route). With two independent deployables, the version overlay's page-versus-API 'Different Builds' warning described a normal state and was retired; the reload signal is the SvelteKit version poll, which compares a tab against the deployment that actually serves it."
---

**A change to a button's label should not rebuild the API, and after this it does not: the
interface ships on `magna-carta-web`, in minutes, while `magna-carta` deploys only when the API
itself changes.**

**Context:** The split was designed in
[`docs/specs/2026-08-21-spa-worker-split-design.md`](../../specs/2026-08-21-spa-worker-split-design.md)
and gated on two owner flags: W1 (do it at all, after reading the real build cost) and W2 (what
hostname the application answers on). The premise held up — `apps/web` imports no WebAssembly and
`adapter-static` produces a folder, not a program — and the blocker was never code: route patterns
do not exist on `workers.dev`, and a custom domain consumes its whole hostname. On 2026-08-31 the
owner converted the apex: removed the custom domain from `magna-carta`, restored the apex DNS as a
proxied placeholder record, and created five route patterns — the four API-side families to
`magna-carta`, everything else to `magna-carta-web`.

**Decision:**

- **W2: the application keeps its existing apex address.** The split happens by path on the one
  hostname, so the session cookie, the CORS-free API calls, and Better Auth are all untouched — the
  browser cannot tell there are two Workers.
- **W1: yes, and the decoupling lever is the Build Watch Paths, not code removal.** The
  `magna-carta` project stops watching `apps/web/*` (dashboard state; the runbook says how to read
  it), so an interface merge builds only `magna-carta-web`. The API Worker's `assets` block
  survives on purpose: `wrangler dev` and the Playwright e2e suite serve the whole application
  from it on one origin, and repointing the zone's `/*` route back to `magna-carta` is the
  one-gesture rollback. Removing the block requires replacements for both, and buys nothing the
  watch paths have not already bought.
- **The zone's route families and `assets.run_worker_first` must stay the same list.** The
  worker-first array remains the in-repository mirror of the account's route table; a new
  top-level path family is a line in both, and `test/worker-first-routing-scan.test.ts` still
  pins the array to the live Hono dispatch table.
- **The version overlay's "Different Builds" warning is retired.** With two deployables, the
  page's commit and the API's commit differ whenever one shipped more recently — a normal state,
  and a standing warning about a normal state teaches people to ignore warnings. The reload signal
  is the SvelteKit version poll (each build named by its commit), which compares the tab against
  the deployment that serves it; the overlay's topology line states why the rows may differ.
- **Accepted cost: a deploy-skew window.** The two Workers finish deploying at different moments,
  so a page can briefly call an API one commit apart from it. The API's additive-change
  convention, the byte-gated contract snapshot, and the update notice bound it.

**Rejected:** removing the API Worker's assets block outright (breaks local dev and the e2e suite,
deletes the rollback, gains nothing beyond the watch-path change); a second hostname for the SPA
(breaks the single cookie origin); Cloudflare Pages (the retired product for this job, and no
route-pattern mechanism).
