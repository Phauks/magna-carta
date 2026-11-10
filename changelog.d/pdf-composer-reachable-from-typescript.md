---
category: Added
audience: internal
---

**The PDF composer can be called from TypeScript.** `@magna-carta/pdf-compose` (`packages/pdf-compose`) is a new package: `composeDocument(document, images)` takes a plain-data document and the pictures it names by position, and returns the PDF, its page count and the characters the bundled fonts could not draw. Behind it, `crates/pdf-compose-core` gains a JSON form of its content model (`src/wire.rs`, `compose_json`), which refuses unknown fields and reports a malformed document by line and column without quoting it, and a WebAssembly edge (`src/wasm.rs`). In a WebAssembly build a picture that needs more than 64 MiB to decode is refused, because a Worker that runs out of memory cannot recover. The artefact is built by `vp run bootstrap` and has a Docker task of its own, `rust-wasm-build-pdf-compose`, which is in no Worker's build script and not in the `rust-wasm-build` composite: no deploy compiles it until something imports the package. The module is about 5 MB.
