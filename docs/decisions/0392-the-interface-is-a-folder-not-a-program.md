---
number: 392
slug: the-interface-is-a-folder-not-a-program
status: Proposed
date: 2026-08-21
area: Delivery
summary: "The single-page application is proposed to move out of the magna-carta Worker onto a Worker of its own, so an interface change stops rebuilding and redeploying the API. The premise is a dependency graph read rather than a runbook claim: apps/web imports none of the three WebAssembly packages, so the interface build is separable from the three Docker Rust builds that dominate the current one, and operations.md had said the opposite since 2026-06-28. The split does not cost the single origin the session cookie depends on, because two Workers route on ONE hostname by path pattern rather than on two hostnames -- which makes a zone hostname the hard precondition, since route patterns do not exist on workers.dev and the application is reachable only there today. What is being moved is a folder rather than a program: apps/web uses adapter-static, so the new Worker is an assets host holding no binding, no secret and no reach into firm data. Accepted costs are a deploy-skew window between interface and API that does not exist while they are one artifact, an eighth Worker to keep on the release branch, and a rollback that is no longer atomic. The design gates itself on a measurement nobody has taken: whether build caching and watch paths on the existing Worker close most of the ten minutes first, in which case the honest outcome is to close the proposal."
---

**An interface change should not pay for three Rust compilations, and the only reason it did was a
sentence in a runbook that nobody checked against the dependency graph.**

**Context.** Every change to a Svelte file rebuilds the whole application Worker, because `build-all`
declares `dependsOn: ["@magna-carta/web#build", "rust-wasm-build"]` and the second of those is three
`docker build` invocations against pinned Rust images. The owner reports roughly ten minutes for a
one-line interface change, then a redeploy of an API that did not change.

The obstacle was believed to be that the interface itself needed the WebAssembly. It does not.
`apps/web/package.json` depends on none of `@magna-carta/pdf`, `@magna-carta/decryption` or
`@magna-carta/email`; every importer of the pdf package is server-side. The claim that the SPA
imported it had been in [`operations.md`](../conventions/operations.md) since the PDF engine merge,
and it is what kept the question closed.

**The decision this proposes.** Move the SPA to `magna-carta-web`, an assets-only Worker with no
bindings and no secrets, and route both Workers on one hostname by path — `/api/*`, `/wopi/*` and
`/search-objects/*` to the application, everything else to the interface. Same origin, so the session
cookie and the absence of CORS are both preserved; the browser cannot tell there are two Workers.

**Two things make this cheaper than a frontend split usually is.** `apps/web` uses `adapter-static`,
so what moves is a directory of files rather than a runtime — there is no server state to divide and
no rendering path to keep in step. And the new Worker holds no credential and reaches no data, which
is a security improvement independent of build time: the surface that serves markup to a browser
stops carrying the keys to a firm's records.

**What it costs.** A deploy-skew window between interface and API that cannot exist while they are one
artifact; an eighth Worker to keep pointed at `release`, where the edit Worker is the standing example
of what happens when one is not watched; a rollback that no longer moves both halves together.

**Why it is Proposed rather than Accepted.** The case rests on a number nobody has read. The build's
per-step timings have not been examined, and two reversible settings on the existing Worker — build
caching, and watch paths that stop a documentation change rebuilding the API — may close most of the
gap for no architectural change at all. Measuring is the gate. If those settings answer it, the
correct outcome is to withdraw this.

**The precondition either way.** Route patterns do not exist on `workers.dev`, and the application is
reachable only at a `workers.dev` subdomain today. It needs an address on the zone before this can
ship — and before anyone is invited to use it.
