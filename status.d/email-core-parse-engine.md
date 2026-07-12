---
slice: Email parse core
group: cross-cutting
order: 30
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: n/a
load-profile: n/a
tested: done by="Opus 4.8"
branch: email-core-parse-engine
active-work: docs/active-work/email-core-parse-engine.md
next: LZFu decoder for compressed-RTF .msg bodies; the email-to-PDF render engine that closes the conversion registry's eml/msg edges; then the capture subsystem builds on this record model
link-spec: docs/specs/2026-07-09-email-core-parse-engine-design.md
link-plan: docs/specs/2026-07-09-email-core-parse-engine-implementation-plan.md
adrs:
blocked-by:
---

The pure-Rust `email-core` engine (`.eml` / `.msg` / mbox) on the engine-host seam, its WASM edge, the `@magna-carta/email` wrapper, and the Email Inspector worker route + tool. `.msg` is read over `cfb` with MAPI decoding written and bounded in-house (`msg_parser` audited and rejected for a release-profile panic reachable on the unwind-less WASM runtime). Parse-only: rendering and DKIM verification stand outside it; the container/native lane is deferred until Discovery's bulk mbox parsing needs it.
