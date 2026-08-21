---
category: Added
audience: internal
---

**`apps/web-worker` — the SvelteKit application on its own Cloudflare Worker, so a change to a
button's label no longer rebuilds and redeploys the API.**

The app Worker binds the SPA's build output under its own `assets` block, which means every UI-only
change rebuilds a Worker that also carries the per-firm data layer, the WebAssembly artefacts and the
Docker steps that produce them. The new Worker carries the same build output and nothing else: no
`main`, no bindings, no secrets. A page request is answered by Cloudflare's asset server and invokes
no script at all.

It is separable because `apps/web` genuinely depends on nothing that reaches a crate — its four
workspace dependencies are `@magna-carta/design-system`, `@magna-carta/design-tokens`,
`@magna-carta/tools` and `@magna-carta/merge-field-catalog-contract`. The WebAssembly imports that
make the app Worker's build slow and Docker-dependent are the API's own: PDF form fill and text
extraction, decryption, and email parsing.

**This stage is additive and changes nothing that is serving.** The app Worker keeps its `assets`
block, so the application answers from one origin exactly as it does today, and the new Worker is a
second door to the same files. Cutting over needs route patterns on one hostname — the SPA
everywhere, the API Worker on its own paths — which needs a zone hostname the account does not have
yet. Removing the app Worker's `assets` block before those routes exist would make the application
unreachable, so the runbook entry says so at the point where somebody would be tempted.

Build settings for the new Worker are the same three uniform fields every sibling uses; the runbook
records them along with its Watch Paths.
