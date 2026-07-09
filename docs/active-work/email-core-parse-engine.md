# email-core-parse-engine

**Branch:** `email-core-parse-engine` · **Off:** main (01b0a19) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-09

## Scope

The email parse core — `crates/email-core`, a pure-Rust engine on the engine-host seam reading `.eml` (RFC 5322/MIME), `.msg` (CFB/MAPI), and mbox — plus its WASM edge, container host, and one visible consumer: an **Email Inspector** surface in the Tools area.

Parse-only. Rendering (`email→pdf`) and DKIM verification are explicitly out of scope and remain unimplemented after this stream.

Design: [`docs/specs/2026-07-09-email-core-parse-engine-design.md`](../specs/2026-07-09-email-core-parse-engine-design.md) · ADR fragment: [`docs/decisions/pending/email-core-parse-engine.md`](../decisions/pending/email-core-parse-engine.md)

## Status

Design accepted; implementation plan written ([`docs/specs/2026-07-09-email-core-parse-engine-implementation-plan.md`](../specs/2026-07-09-email-core-parse-engine-implementation-plan.md)). Implementation not started.

The native container lane is **deferred** — a container is a separate deployable Worker plus a Durable Object class and a service binding, and nothing in this stream consumes it. The crate stays pure, so the lane is a compile target away. Flip condition: Discovery's bulk mbox parsing.

## Files expected to be touched

- `crates/email-core/**` (new), `crates/Cargo.toml` (workspace member). **No direct `cfb` dependency** — `msg_parser` owns the CFB layer.
- `packages/email/**` (new) — the wasm-pack TypeScript wrapper, mirroring `packages/decryption`
- `vite.config.ts` — the `rust-wasm-build` task hard-codes each crate it builds; a third entry is required or the worker bundle fails on a missing `.wasm`
- `apps/worker/src/routes/email-inspector.ts` (new), `apps/worker/src/app.ts`, `apps/worker/wasm-modules.d.ts`, `apps/worker/package.json`
- `packages/access-control/src/registry.ts`, `packages/tools/src/catalog.ts` — permission + catalog row
- `packages/database/drizzle/per-firm/` + `apps/worker/src/per-firm-migrations.ts` — the role seed (the only DB change; no tables)
- Generated, committed: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*`, `**/tsconfig.build.json`
- `docs/specs/2026-06-16-email-filing-design.md` — **amendment**: supersede its PostalMime assumption; correct its stale ADR-0104/0105/0106 reservations
- `ROADMAP.md`, `status.d/`, `changelog.d/`, `docs/decisions/pending/`

## Overlap notes

- **`ocr-engine`** — also an engine-host-seam engine. No file overlap; both add a `crates/<engine>` + `containers/<engine>` pair. Watch `crates/Cargo.toml` for a workspace-member merge conflict.
- **`file-repair-salvage`** — owns the CFB/OLE2 repair pillar and the `cfb` pin in `recovery-core` (0.14; `decryption-core` separately pins 0.10, and `cfb` is *not* a workspace dependency). This stream reads CFB only through `msg_parser` and does not touch `recovery-core`. Do not unify the pins as a drive-by.
- **`packages/access-control/src/registry.ts` and `packages/tools/src/catalog.ts`** already show as modified in the working tree from another stream — rebase onto what is there rather than overwriting.
- Does **not** touch `ingest-core.ts` (attachment extraction onto matters belongs to the capture subsystem, not this stream).
