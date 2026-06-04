# Code style

**Status:** Stub — to be written when the repo scaffold lands (Phase 0).

**Scope (single home for):** the **language-agnostic** style principles that hold everywhere, plus the index to per-language conventions. Language-specific formatting, tooling, and idioms live in their own files (below) so neither shared rules nor language rules get duplicated.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Development guidelines_ (tooling) and _Delivery model_ (Rust vs. TypeScript boundaries). Don't restate stack or architecture here — link to it.

## Per-language conventions

| Language             | File                             | Tooling                    |
| -------------------- | -------------------------------- | -------------------------- |
| TypeScript (primary) | [`typescript.md`](typescript.md) | Oxlint + Oxfmt (via Vite+) |
| Rust (surgical)      | [`rust.md`](rust.md)             | rustfmt, clippy            |

_Add a new file here per language as it enters the codebase (e.g. SQL migrations, shell)._

## Shared principles (all languages)

**To document:**

- Naming intent: descriptive over terse; consistency with surrounding code over personal preference.
- Comment philosophy: match surrounding density; explain _why_, not _what_; no dead/commented-out code.
- File/module layout: one clear responsibility per file; split when a file grows to do too much.
- Error handling stance: fail loudly at boundaries; never swallow errors silently.
- Cross-language naming alignment (DB columns ↔ types ↔ API fields) so the same concept reads the same everywhere.

> Hard invariants (no emojis, no shell for file ops, docs-in-commit) live in the root [`CLAUDE.md`](../../CLAUDE.md) — not duplicated here.
