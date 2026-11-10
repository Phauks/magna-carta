# @magna-carta/pdf-compose (packages/pdf-compose) — CLAUDE.md

**Purpose.** The typed front door to the PDF composer: `composeDocument(document, images)` takes a
plain-data document (title, headings, paragraphs, pictures, tables, labelled fields, header and
footer) and returns a new PDF. The engine is
[`crates/pdf-compose-core`](../../crates/pdf-compose-core/CLAUDE.md) compiled to WebAssembly into
`src/pkg/` (git-ignored; `vp run bootstrap` builds it). Layout, fonts and picture handling are the
crate's and are documented there. Nothing imports this package yet.

## Key files / entry points

- `src/index.ts` — `ensureReady`, `composeDocument`, and the `ComposeDocument` types.
- `test/compose.test.ts` — composes through the WebAssembly module and opens the result with
  `@magna-carta/pdf`.

## Local conventions

- **The types here mirror `crates/pdf-compose-core/src/wire.rs` by hand.** The engine refuses an
  unknown field, so a field added on one side and not the other fails loudly in the test, not
  silently in a document. Change both in the same commit.
- **Pictures are bytes beside the document, named by position.** Never base64 inside the JSON.

## Gotchas

- **The module is about 5 MB** (the four bundled font faces are 1.6 MB of it). Import it lazily,
  where a document is actually composed, never from a route's or a page's top level.
- **Composing is CPU work.** A long table or several photographs take real time: off the UI main
  thread in a browser (a Web Worker), and off the request path in a Worker
  (`docs/conventions/build-performance.md` and the root golden rule on the hot path).
- **Memory in a Worker.** The engine refuses a picture that needs more than 64 MiB to decode in a
  WebAssembly build, because running out of memory there ends the request with nothing to catch.
- **Not in any deploy build yet.** `rust-wasm-build-pdf-compose` exists in `vite.config.ts` but no
  Worker's build script asks for it. The first Worker to import this package adds it to its own
  `build` script, the way `apps/web-worker/package.json` names the crates it needs.
