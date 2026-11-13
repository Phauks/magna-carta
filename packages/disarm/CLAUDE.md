# @magna-carta/disarm — CLAUDE.md

**Purpose.** The TypeScript seam over the content disarm engine in
[`crates/disarm-core`](../../crates/disarm-core/CLAUDE.md), compiled to WebAssembly. It loads the
engine and types its answers; every decision is the engine's.

**Spec:** [`docs/specs/2026-11-13-content-disarm-design.md`](../../docs/specs/2026-11-13-content-disarm-design.md).

## Key files / entry points

- `src/index.ts` — `ensureReady`, `identifyDisarmable`, `disarmDocument`, `DisarmError`, and the types.
- `src/pkg/` — the wasm-pack output. Git-ignored, rebuilt by `pnpm exec vp run bootstrap`.
- `test/disarm.test.ts` — the edge's shape and its error codes.

## Local conventions

- **Types mirror the engine's codes exactly** (`RemovalKind`, `DisarmErrorCode`). A new code in the
  crate is a new member here in the same change.

## Gotchas

- **Load it on demand.** The module is about 10 MB (3.4 MB compressed). A screen imports it when a
  person asks for a disarmed copy, never at start.
- **No deployed bundle imports it yet,** so `rust-wasm-build` does not build it. The first bundle
  that imports it adds `vp run rust-wasm-build-disarm` to its build, or the deploy fails on a
  missing `.wasm`.
