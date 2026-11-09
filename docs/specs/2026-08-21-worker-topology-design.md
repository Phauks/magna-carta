# Worker topology — segmentation, hosts, and what the core Worker stops carrying

**Status:** proposed. **Decided already, by the owner, and not reopened here:** the Cloudflare script
stays `magna-carta`. The API and the orchestration are one program, so the root name is the accurate
one and no script is renamed. That removes the only genuinely dangerous move on the table — see
_The rename that is not happening_ below for why it mattered.

## The shape today

Fifteen entries under `apps/`, of three kinds that the directory names do not distinguish.

| Kind          | Members                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entrances** | `web-worker` (SPA assets), `email-worker` (inbound mail), `status-worker` (public status page)                                                                |
| **The core**  | `worker` — script `magna-carta`                                                                                                                               |
| **Engines**   | `scan`, `convert`, `ocr`, `search`, `recovery`, `file-repair`, `bundle`, `discovery`, `edit` (each owns one Container) and `sign` (WebAssembly, no Container) |

Plus `apps/web`, which is not a deployable at all: it is the SvelteKit source whose build output an
entrance serves.

**The naming is already correct and reads as if it is not.** The convention across the fleet is strip
`magna-carta-`, append `-worker`: `magna-carta-scan` becomes `scan-worker`. Applied to the root script
`magna-carta`, that yields exactly `worker`. It looks generic because the script it names is the root
one, not because anyone forgot to name it. Recording that here is the whole of the fix — the question
has now been asked twice.

## What the core Worker holds, and why it does not split

- The Hono application and the single enforcement chokepoint every `/api/v1` route crosses.
- Twenty-six queue consumers.
- Three Cron sweeps.
- Eleven Durable Object classes.
- Seven outbound service bindings to engines, and two inbound ones (`edit-worker` and `search-worker`
  each bind `APP_WORKER` back to it).

**Splitting the API away from the orchestration is refused, and one fact decides it.** `FirmDatabase`
is a Durable Object on this script, addressed by `idFromName(firmId)`. It **is** each firm's database.
The other ten classes are job coordinators that the request path and the queue consumers both reach.
Separating the API would either duplicate the composition root and the chokepoint's ports, or put a
service-binding hop between the API and the firm's own data. The consumers, the sweeps and the routes
all call the same domain packages through the same firm-scoped data-access layer: they are one
program. Workers isolate per request, so the usual argument — keep a queue backlog off API latency —
buys nothing on this platform.

## What it should stop carrying: three WebAssembly imports

This is the real segmentation gain, and it is orthogonal to every naming question.

| Import                    | Used by                                                                                            | Proposed home     | Why that home                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `@magna-carta/pdf`        | `assemblies/pdf-form-engine.ts` (AcroForm fill), `search/text-extraction.ts`                       | `sign-worker`     | Already carries the same WebAssembly for `/seal`; the service-binding shape already exists |
| `@magna-carta/decryption` | `routes/files/decryption.ts`, `routes/files/recovery.ts`                                           | `recovery-worker` | Already runs `decryption-core` inside its Container                                        |
| `@magna-carta/email`      | `emails/capture-consumer.ts`, `emails/attachment-extraction.ts`, `routes/email/email-inspector.ts` | `email-worker`    | Already the inbound mail entrance; parsing belongs at the entrance                         |

Each move is the shape `/seal` already uses: a port in the core, a service binding, a thin adapter.
None of the three needs a new Worker.

**What it buys.** The core Worker's build currently needs Docker, because `rust-wasm-build` builds two
crates into pinned Rust images before the bundle can be assembled. With all three imports gone it
imports no crate at all and its build collapses to a plain TypeScript bundle. That is the largest
single reduction available to the slowest build in the repository, and it removes a class of failure
that has recurred three times (a Worker importing WebAssembly whose build command does not reach the
task that produces it).

**What it costs.** Three more service-binding hops on paths that are currently in-process, and three
more Workers that must exist before the core can deploy — wrangler refuses a deploy whose service
binding names a missing Worker, and that rule has already blocked this platform once. `sign-worker`
and `recovery-worker` are connected; `email-worker` is not yet.

**Ordering.** One at a time, each behind its own port, each deployable alone. `@magna-carta/email`
last: it is the only one of the three whose consumer runs on a queue rather than a request, so it is
the only one where a binding that is absent shows up as a retry storm rather than a `503`.

## Hosts: the cutover the platform has been waiting for

`magnacarta.esq` is a live zone. `status-worker` already holds
`{ "pattern": "status.magnacarta.esq", "custom_domain": true }`, which is the proof.

The core Worker, meanwhile, declares no `routes` at all and serves on `workers.dev` — while the
generated API client has shipped pointing at `https://api.magnacarta.esq/v1` since it was generated,
a host nothing answers. The client's own type union names both intended hosts:
`https://api.magnacarta.esq/v1` and `https://app.magnacarta.esq/api`.

Target:

| Host                    | Worker                                  |
| ----------------------- | --------------------------------------- |
| `app.magnacarta.esq/*`  | `magna-carta-web` — the SPA, every path |
| `api.magnacarta.esq/*`  | `magna-carta` — the API                 |
| `status.magnacarta.esq` | `magna-carta-status` — already live     |

**A route pattern needs a zone; `workers.dev` cannot carry one.** That was the real gate, and it is
open. The comment in `apps/worker/wrangler.jsonc` saying workers.dev is "the only reachable URL until
magnacarta.esq attaches" predates the June attachment and is false; it is what made this look blocked.

**Ordering, and the one irreversible-looking step.** Attach the routes FIRST and confirm both hosts
serve, while the core Worker still carries its `assets` block and still answers on `workers.dev`.
Only then remove the block. Removing it first, or in the same push, means a window where the SPA is
served by nothing. The `assets` block is the rollback: while it exists, the old path still works.

**Two same-origin assumptions to check before the split, not after.** The application currently
serves the SPA and the API from one origin, so the session cookie is first-party and no request is
cross-origin. Splitting `app.` from `api.` makes every API call cross-origin between two subdomains
of one registrable domain. The cookie needs its `Domain` set to the shared parent, and the API needs
a CORS allowance for the app host. Neither is hard; both are silent until a browser refuses a request.

## `apps/web` folds into `apps/web-worker`, but only after

`apps/web-worker` is not its only consumer today: `apps/worker/wrangler.jsonc` also points its
`assets.directory` at `../web/build`. Fold the source in before the cutover and the core Worker is
reaching into the other Worker's directory, which is backwards.

After the cutover it is the clean end state — one directory holding the SvelteKit source and its
`wrangler.jsonc`, exactly how `status-worker` is laid out. Four live cross-references move with it,
all in `packages/design-system`: the stylesheet and boot-script mirror tests read `apps/web/src/app.css`
and `apps/web/src/app.html` by path, and the off-token and boundary fitness sweeps are rooted at
`apps/web/src`. They move in the same commit or the sweeps silently cover nothing.

## The rename that is not happening, and why it is worth recording

Renaming the Cloudflare script was considered and declined. It is recorded because the reasoning does
not expire: **a script rename creates a new Worker, and Durable Object storage does not follow it.**
New script name, new namespaces — `FirmDatabase` included, which is every firm's data. Cloudflare
offers a class-transfer mechanism in migrations; its current status would have to be verified against
their documentation before anyone bet a data migration on it.

Three further things would have had to move in the same wave: the two inbound `APP_WORKER` bindings
from `edit-worker` and `search-worker`, all twenty-six queue consumer registrations, and the Workers
Builds connection.

The window in which this is cheap is the window in which no firm has real data in a Durable Object.
That window is open now and closes with the first tenant. Anyone reopening this question after that
is proposing a migration, not a rename.

## Sequence

1. Correct the stale host comment in `apps/worker/wrangler.jsonc`. Free, and it is what made the
   cutover look blocked.
2. Attach `app.magnacarta.esq` and `api.magnacarta.esq` as routes. Confirm both serve while the
   `assets` block still exists.
3. Set the cookie domain and the API's cross-origin allowance for the app host.
4. Remove the `assets` block from `apps/worker/wrangler.jsonc`.
5. Fold `apps/web` into `apps/web-worker`, moving the four design-system references with it.
6. Extract `@magna-carta/pdf` to `sign-worker` behind a port.
7. Extract `@magna-carta/decryption` to `recovery-worker`.
8. Connect and deploy `email-worker`, then extract `@magna-carta/email` to it.
9. Drop `rust-wasm-build` from the core Worker's build command; its build no longer needs Docker.

Steps 1–5 are the cutover and are ordered by safety. Steps 6–9 are independent of it and of each
other, and each is deployable alone.

## Open questions for the owner

- **W3.** Does the API keep answering on `workers.dev` after the cutover, or is `api.magnacarta.esq`
  the only host? Keeping both is a second public surface with the same authority; removing it means
  no fallback if a route is misconfigured.
- **W4.** Step 9 removes Docker from the core build. Do the load-profile and integration harnesses
  depend on the in-process WebAssembly paths that step 6-8 remove? If they do, they need fakes at the
  port, and that is work those steps should carry rather than discover.
