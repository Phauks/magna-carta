---
worktree: C:/dev/magna-carta-worktrees/claude/pdf-engine-extraction
area: Move the API Worker's two in-process PDF WebAssembly uses behind the SIGN_SERVICE binding
status: review
touches: apps/api-worker/src/assemblies, apps/api-worker/src/search/text-extraction.ts, apps/api-worker/src/documents, apps/api-worker/src/routes/templates.ts, apps/api-worker/CLAUDE.md, apps/api-worker/wrangler.jsonc, apps/sign-worker, packages/pdf, packages/document-assembly/src/pdf-form.ts
---

`apps/api-worker` no longer imports `@magna-carta/pdf`. Form-template registration, form fill, and the
PDF text-layer route of composite extraction all reach the engine over the `SIGN_SERVICE` binding to
`apps/sign-worker`, which already hosted it for `/seal`. The engine's HTTP surface is defined once in
`packages/pdf/src/service.ts` and served by the sign worker; `apps/api-worker/src/documents/pdf-engine-binding.ts`
is the client and names the three binding states.

Branches off `claude/worker-decoupling`, so that must land first. Does NOT touch the decryption or
email WebAssembly imports — those are separate streams, and `rust-wasm-build` stays in the build graph
until all of them are gone.
