# Splitting the SPA onto its own Worker — design

**Date:** 2026-08-21
**Status:** Design proposed. No product code in this cycle. Two owner flags in section 9 decide
whether the split happens at all and what the app Worker is reachable at afterwards.

**Owner-flag series: `W`.** Its own letter series so an answer here can never be mistaken for an
answer to a billing (`B`), trust (`T`), payments (`K`), notifications (`N`), intake (`J`), discovery
(`P`) or automations (`M`) flag.

**Scope.** Moving the SvelteKit single-page application out of the `magna-carta` Worker and onto a
Worker of its own, so a change to the interface no longer rebuilds and redeploys the API. Out of
scope: the client portal shell (Phase 6), the marketing site (a separate host on its own gate), and
any change to what the SPA or the API actually do.

---

## 1. The problem, stated as a measurement rather than a feeling

Every interface change today rebuilds the whole application Worker. `build-all` is one task with two
dependencies:

```
"build-all": { command: 'vp run --filter "@magna-carta/worker" build',
               dependsOn: ["@magna-carta/web#build", "rust-wasm-build"] }
```

`rust-wasm-build` is three `docker build` invocations — `pdf-core`, `decryption-core`, `email-core` —
each compiling a Rust crate to WebAssembly in a pinned image. A change to one line of Svelte pays all
of it, then pays the Worker bundle, then redeploys an API that did not change.

**This design does not assert which part dominates that time.** Nobody has read a build's per-step
timings, and the owner's ten-minute figure is wall clock rather than a breakdown. Section 8 makes
measuring it a precondition rather than a follow-up, because two of the cheaper remedies there may
close most of the gap without any architectural change at all.

## 2. The fact that makes the split possible, and the stale claim that hid it

**The SPA does not import any WebAssembly package.** `apps/web/package.json` depends on none of
`@magna-carta/pdf`, `@magna-carta/decryption` or `@magna-carta/email`. Every importer of
`@magna-carta/pdf` is server-side: `packages/signing`, `packages/document-assembly`, and the Worker's
own assembly and text-extraction routes.

[`operations.md`](../conventions/operations.md) has said the opposite since 2026-06-28 — it describes
`@magna-carta/pdf` as "imported by the SPA" — and that sentence is why the question "can the
interface build without Rust?" has had an answer of "no" for two months without anyone checking. It
is corrected in the same commit as this document.

So the interface build is genuinely separable from the Rust toolchain. That is the whole premise, and
it is worth stating that it rests on a dependency graph read today rather than on the runbook.

## 3. What the SPA actually is

`apps/web/svelte.config.js` uses **`adapter-static`**, not `adapter-cloudflare`:

```js
adapter: adapter({ fallback: "index.html", pages: "build", assets: "build" });
```

There is no server-side rendering and no server code. `apps/web/build` is a directory of static
files with an `index.html` fallback for deep links. The app Worker serves it through the Workers
Static Assets binding:

```jsonc
"assets": {
  "directory": "../web/build",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"],
}
```

**This matters more than it looks.** The thing being split out is not a program — it is a folder.
That removes most of what usually makes a frontend split expensive: there is no runtime to duplicate,
no server state to divide, no rendering path to keep in step. The new Worker is an assets host and
nothing else.

## 4. Preserving the single origin — the part that must not be got wrong

The application depends on the browser sending its session cookie with every API call. Better Auth
sets that cookie on the application's own origin; the file preview and download hosts are deliberately
separate and cookieless.

**Two hostnames would break this**, and this document's earlier private reasoning had it wrong on
exactly this point: it treated "separate Worker" and "separate origin" as the same decision. They are
not. Cloudflare routes several Workers on **one** hostname by path:

| Route pattern                 | Worker            | Serves                                     |
| ----------------------------- | ----------------- | ------------------------------------------ |
| `<app-host>/api/*`            | `magna-carta`     | The API, Better Auth, the OpenAPI document |
| `<app-host>/wopi/*`           | `magna-carta`     | The editing host                           |
| `<app-host>/search-objects/*` | `magna-carta`     | The split-object host                      |
| `<app-host>/*`                | `magna-carta-web` | Static assets, `index.html` fallback       |

Same origin, same cookie, no CORS, no preflight, no `Access-Control-Allow-Credentials`. The browser
cannot tell there are two Workers, which is the point.

**The precondition is a custom domain.** Route patterns do not exist on `workers.dev`, and
`apps/worker/wrangler.jsonc` has `workers_dev: true` with no `routes` block — the application is
reachable today only at `magna-carta.<subdomain>.workers.dev`. The split therefore **cannot ship
before the app is on a zone hostname**, which is flag `W2`. The zone exists and is already in use:
the status Worker holds `status.magnacarta.esq` as a custom domain.

## 5. A latent defect the split removes

The assets binding declares `run_worker_first: ["/api/*"]`, but the Worker serves two path families
outside `/api`: `/wopi/*` (`apps/worker/src/editing/wopi-host.ts`) and `/search-objects/*`
(`apps/worker/src/search/split-object-host.ts`). Both are deliberately outside the chokepoint,
because their callers hold no session — the Collabora container and the keyword-search container
respectively.

By the configuration as written, a public request to either path is handled by the asset layer first,
misses, and is answered by `not_found_handling: "single-page-application"` — that is, with
`index.html` and a `200`. A caller expecting a WOPI `CheckFileInfo` payload or a ranged object read
would receive an HTML document.

**This is recorded as a finding, not as a fix, and it may be latent rather than live.** Both callers
reach the Worker through service bindings from an internal host rather than over the public edge, and
whether a service-binding invocation traverses the asset layer at all is a Cloudflare runtime
behaviour this document has not tested. It is called out because the split makes the question moot in
the right direction: once `magna-carta` has no assets binding, every path reaches the script and there
is no fallback to be wrong about. If the split does not proceed, the correct standalone repair is to
add both prefixes to `run_worker_first`.

## 6. The shape after the split

**A new `apps/web-worker`**, package `@magna-carta/web-worker`, holding a `wrangler.jsonc` and nothing
else of substance:

- `name: "magna-carta-web"`
- `assets: { directory: "../web/build", binding: "ASSETS", not_found_handling: "single-page-application" }`
- No `run_worker_first` — everything routed here is an asset by construction
- No bindings: no D1, no R2, no queues, no Durable Objects, no secrets. **This Worker holds no
  credential and reaches no data.** That is a security property worth having on its own: the surface
  serving untrusted-shaped input to a browser stops carrying the keys to the firm's data.
- Root directory `apps/web-worker`, build `pnpm install --frozen-lockfile && pnpm run build`, deploy
  `npx wrangler deploy` — the uniform three fields every sibling uses. Its own `build` script builds
  the SPA (`vp run -w --filter "@magna-carta/web" build`, or the equivalent that reaches the web
  package from a package directory).
- **Watch Paths:** `apps/web/*`, `apps/web-worker/*`, `packages/design-system/*`, `packages/api-client/*`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. Derived from what the SPA
  actually imports, and to be re-derived at build time rather than trusted from this list.

**`apps/worker` loses its `assets` block** and with it the `ASSETS` binding, the SPA build dependency,
and `not_found_handling`. `build-all`'s `dependsOn` drops `@magna-carta/web#build`, keeping
`rust-wasm-build`. An unmatched path becomes an honest `404` from Hono rather than an `index.html`.

**Neither Worker's name changes** for the one that exists. `magna-carta` keeps its name and its
deployment; only what it serves narrows.

## 7. What this costs, stated plainly

**A deploy skew window that does not exist today.** One `main:release` push currently produces one
artifact in which the interface and the API are the same commit. Afterwards it produces two builds
that finish at different times, so for a minute or two the deployed SPA can call an API shape that
has not landed, or the reverse. With no users this is invisible; it is a real operational fact at
launch. Three things reduce it and none removes it: the API is additive by convention, the OpenAPI
snapshot is byte-gated so a contract change is visible in review, and the generated client is
committed alongside it.

**A second Worker to configure, watch and keep on `release`.** The account already carries the cost
of seven; this makes eight. The edit Worker is the standing example of what goes wrong — it sat on a
retired branch for eight weeks of failed builds that nobody was watching.

**One more place the deploy runbook can drift from the dashboard.** That file has three recorded
drifts already.

**A rollback that is no longer atomic.** Reverting one Worker leaves the other ahead.

## 8. Preconditions — measure before building this

**This design must not be built until the ten minutes has been read rather than assumed.** Two
cheaper remedies may close most of it, and both are reversible in a click:

1. **Build Caching on `magna-carta`.** If it is off, every build re-downloads the pnpm store and
   re-runs all three Rust images from cold. The runbook already names this as the primary fast-build
   lever and instructs it ON for every connected Worker; whether it is actually on has not been
   confirmed.
2. **Watch Paths on `magna-carta`.** Include `*`, exclude `docs/*`, `containers/*`, `spikes/*`,
   `*.md`, so a documentation change stops rebuilding and redeploying the API.

If those two bring an interface change to an acceptable time, this split buys much less than it
costs, and the honest outcome is to close it. **The measurement is the gate, not a formality** — the
whole case for this design is a number nobody has read.

## 9. Owner flags

**`W1` — Do the split at all?** Gated on section 8's measurement. Recommendation: measure first,
decide after; do not build on the strength of the ten-minute estimate.

**`W2` — What hostname does the application answer on?** The split requires a zone hostname, because
route patterns do not exist on `workers.dev`. The zone is `magnacarta.esq` and `status.` is already
attached. This is a product decision (it is the address firms will type) and a prerequisite, so it is
worth answering whether or not `W1` is yes — the application needs a real address before anyone is
invited to it.

## 10. What is deliberately not here

**The client portal** keeps its own future shell and is unaffected; components stay shell-agnostic
either way.

**Cloudflare Pages** is not proposed. It is the older product for this job, Workers Static Assets is
where Cloudflare is investing, and a Pages project would not share the route-pattern mechanism this
design depends on.

**Splitting the API further** — a separate Worker per subsystem — is not proposed and is not implied.
The API is one deployable because it shares one chokepoint, one session, and one per-firm database
handle.
