---
category: Fixed
audience: internal
---

**The production deploy went red the day the interface started importing WebAssembly: `build-all`
named the wasm build and the SPA build in the same `dependsOn` list, and entries in that list are
siblings that run in parallel.** The SPA bundle raced a Rust image pull it could only lose, and
failed on `UNRESOLVED_IMPORT … ./pkg/pdf_core.js` at 39 s while the image was still extracting. The
task list read as an ordering and was not one; nothing had ever tested it, because until the
in-browser PDF reader merged the SPA imported no wasm and the race had no wrong outcome.

`build-all` now carries the order where order actually lives — its command chain: the wasm, then the
SPA that bundles it, then the worker that serves the SPA's output. A nested `vp run` inside a command
is inlined as its own task rather than a child process, so this is a real serial edge in the graph
and each step keeps its own cache entry. Verified by reproduction against a machine with no Docker
daemon: on the old config the SPA build starts beside the failing image build (`~/apps/web$ vp
build`, exactly the shape the production log shows); on the new one it never starts, and with the
artefacts present the whole chain — wasm, SPA, worker bundle — builds green.

**The same merge left a second Worker with the same failure, reached by the opposite route.**
`magna-carta-web` is the deployable that has served the application since 2026-08-31, and its build
script reached the wasm task not at all — it runs `pnpm --filter @magna-carta/web run build`, which
is the exact command that failed inside the app Worker's build, with nothing ahead of it to produce
`packages/pdf/src/pkg`. Its build now asks for the artefact first, following the sign Worker's
precedent of putting a Worker's extra step in its own build script rather than in a dashboard
field.

It asks for **pdf-core alone**. `rust-wasm-build` is now a chain of three per-crate tasks —
`rust-wasm-build-pdf`, `-decryption`, `-email` — because this is the Worker that rebuilds on every
interface merge, and compiling two crates whose output that bundle never imports is a cost paid over
and over for nothing. The composite still builds all three and is still what the app Worker's deploy
and CI's wasm job ask for; nothing about the images, their flags, or their output paths changed. The
sign Worker, which imports pdf-core alone for the same reason, now asks for the same one task.

The runbook's rule was half-stated twice before this. It read "a crate being in `rust-wasm-build` is
not enough; the Worker that imports its output needs a build command that actually REACHES that
task" — true, and one word short: reaching it is not ordering it. Both halves are now in
[`docs/conventions/operations.md`](../docs/conventions/operations.md), with the fourth occurrence of
this class recorded beside the three before it, and the general form
(`dependsOn` is a set, a chain is a chain) in
[`docs/conventions/build-performance.md`](../docs/conventions/build-performance.md).
