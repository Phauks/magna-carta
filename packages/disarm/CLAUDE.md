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

- **Load it on demand.** The module is about 10 MB (3.4 MB compressed). A screen imports it
  dynamically when it is opened, never at start: the File Workbench's Malware Scan tab is the
  first consumer.
- **Every build that bundles the SPA must build it.** `apps/web-worker` and
  `apps/community-worker` run `vp run -w rust-wasm-build-disarm`, and the `rust-wasm-build`
  composite includes it. A new bundle that imports it needs the same line, or the deploy fails on
  a missing `.wasm`.
