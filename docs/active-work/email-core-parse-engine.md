# email-core-parse-engine

**Branch:** `email-core-parse-engine` · **Off:** main (01b0a19) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-09

## Scope

The email parse core — `crates/email-core`, a pure-Rust engine on the engine-host seam reading `.eml` (RFC 5322/MIME), `.msg` (CFB/MAPI), and mbox — plus its WASM edge, container host, and one visible consumer: an **Email Inspector** surface in the Tools area.

Parse-only. Rendering (`email→pdf`) and DKIM verification are explicitly out of scope and remain unimplemented after this stream.

Design: [`docs/specs/2026-07-09-email-core-parse-engine-design.md`](../specs/2026-07-09-email-core-parse-engine-design.md) · ADR fragment: [`docs/decisions/pending/email-core-parse-engine.md`](../decisions/pending/email-core-parse-engine.md)

## Status

Design drafted, pending owner acceptance. No implementation plan yet.

## Files expected to be touched

- `crates/email-core/**` (new), `crates/Cargo.toml` (workspace member + `cfb` pin reuse)
- `containers/email/**` (new)
- `apps/worker/src/routes/` — a new Email Inspector route beside its `file-repair` / `file-type` siblings
- `apps/web` — the Tools-area Inspector surface
- `docs/specs/2026-06-16-email-filing-design.md` — **amendment**: supersede its PostalMime assumption; correct its stale ADR-0104/0105/0106 reservations
- `ROADMAP.md`, `status.d/`, `changelog.d/`, `docs/decisions/pending/`

## Overlap notes

- **`ocr-engine`** — also an engine-host-seam engine. No file overlap; both add a `crates/<engine>` + `containers/<engine>` pair. Watch `crates/Cargo.toml` for a workspace-member merge conflict.
- **`file-repair-salvage`** — owns the CFB/OLE2 repair pillar and the `cfb` crate pin in `recovery-core`. This stream *reads* CFB via `msg_parser`; it does not touch `recovery-core`. Coordinate if the `cfb` pin moves.
- Does **not** touch `ingest-core.ts` (attachment extraction onto matters belongs to the capture subsystem, not this stream).
