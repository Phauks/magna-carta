# disarm-core (crates/disarm-core) — CLAUDE.md

**Purpose.** Content disarm: a copy of a document with everything that can act taken out (scripts,
macros, automatic actions, embedded programs, links fetched on open), and a count of what that was.
Native `rlib`, and the WebAssembly module shipped through [`@magna-carta/disarm`](../../packages/disarm).
It never modifies an original; it never decides where a copy is stored.

**White paper:** _Core domain_, untrusted file handling (the CDR stage).
**Spec:** [`docs/specs/2026-11-13-content-disarm-design.md`](../../docs/specs/2026-11-13-content-disarm-design.md).

## Key files / entry points

- `src/lib.rs` — `identify`, `disarm`, `disarm_with`, `DocumentKind`, `DisarmError`, and the dispatch.
- `src/pdf.rs` — pdf-core's sanitize as the gate, then a walk over every object.
- `src/ooxml.rs` — Office packages: parts removed, relationships rewritten, body parts streamed.
- `src/rtf.rs` — a token scanner that drops or unwraps whole groups and copies everything else.
- `src/raster.rs` — decode and encode afresh.
- `src/report.rs` — `RemovalKind` and the report; `src/limits.rs` — every ceiling.
- `src/wasm.rs` — the WebAssembly edge. It reshapes; it decides nothing.
- `tests/disarm.rs` — every format against a document built in the test, so each case is visible.

## Local conventions

- **Neutralize, do not guess.** A surface this crate does not understand is refused, never passed
  through. A new format arrives with its own module and its own `verify`.
- **Every format verifies its own output.** After writing, the module re-reads the copy and returns
  `VerificationFailed` (and no bytes) if anything it promised to remove is still there. A change
  that adds a removal adds the matching check.
- **Keep what a person reads.** A field keeps its shown result, an RTF object keeps its picture, an
  emptied Office embedded object keeps its relationship so the file opens without a repair prompt.
- **A report never repeats content.** Counts by `RemovalKind`, nothing else.

## Invariants that apply here

- **Memory-safe dependencies only** (golden rule 14). `cargo tree -p disarm-core -i cc` prints nothing.
- **Bounded before read.** Input size, package entry count, per-part and total inflation, package
  nesting depth, picture pixels and RTF nesting all have a ceiling in `Limits`, checked before work.
- **An error never carries document content.**

## Dependencies & contracts

- `pdf-core` — `sanitize` (the guard and lock check, and the attachment and XFA scrub) and
  `sanitize_document`. Owned by another stream: tell its owner before relying on anything new there.
- The codes in `RemovalKind::code` and `DisarmError::code` are a contract with
  `packages/disarm/src/index.ts`. Add; do not rename.

## Gotchas

- **The WebAssembly artefact is git-ignored.** Run `pnpm exec vp run bootstrap` after changing
  `src/` before the `packages/disarm` tests mean anything.
- **Set `CARGO_TARGET_DIR` outside the repository.** pdf-core makes this a large build.
- **The build is about 10 MB of WebAssembly, mostly pdf-core.** Load it on demand, never at start.
