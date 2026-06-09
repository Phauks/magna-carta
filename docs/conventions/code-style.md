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

- Naming intent: descriptive over terse; consistency with surrounding code over personal preference. Hard rule below — names are spelled out in full (_Naming — fully spelled out_).
- Comment philosophy: match surrounding density; explain _why_, not _what_; no dead/commented-out code.
- Comments are **self-contained and spec-agnostic** — never cite the spec, section, or `§` number a line was derived from (that pointer rots the moment the doc is reorganized, and means nothing to a future reader). Explain the thing itself; cite a stable `ADR-NNNN` only when the _why_ genuinely needs the decision's context. (This is the [`CLAUDE.md`](../../CLAUDE.md) cross-reference rule applied to code.)
- File/module layout: one clear responsibility per file; split when a file grows to do too much.
- Error handling stance: fail loudly at boundaries; never swallow errors silently.
- Cross-language naming alignment (DB columns ↔ types ↔ API fields) so the same concept reads the same everywhere.

## Line length & wrapping (decided)

**Never hand-wrap.** Code is wrapped automatically by the formatter (Oxfmt, `printWidth: 100`, set in the root `vite.config.ts` `fmt` block) — do not insert manual line breaks to hit a column. Prose and comments are authored **unwrapped** — one line per paragraph (or one sentence per line where sentence-level diffs help), per [`documentation-style.md`](documentation-style.md). This keeps git diffs minimal (an edit changes one line, not a reflowed block) and stops anyone fighting the formatter.

## Naming — fully spelled out (decided)

**Spell every name out in full — no abbreviations, no shorthand.** This holds across packages, modules, types, functions, variables, comments, and docs. The golden rule lives in the root [`CLAUDE.md`](../../CLAUDE.md); this is its detailed home.

- **Packages and identifiers in full:** `@magna-carta/identifiers` (not `ids`), `@magna-carta/database` (not `db`), `@magna-carta/data-access` (not `dal`); `newIdentifier()` (not `newId()`), `randomSource` (not `rng`), `cryptoRandomSource` (not `cryptoRng`).
- **No initialisms in prose or code for our own concepts:** write "the data-access layer", not "the DAL".
- **Why:** clarity imposed now is cheap; decoding shorthand later is excruciating, and it compounds across a multi-year codebase. A reader should never have to stop and decode a name.
- **Sole exception — documented storage encodings from an accepted spec.** Deliberate column-suffix conventions such as `amount_minor` (minor units / cents) and `rate_e4` (scaled ten-thousandths), defined in the foundational-data-conventions spec and carrying explanatory comments, stay as specced. These are spec-level encoding decisions, not casual shorthand. Changing them is a spec change, not a style call.
- **Widely-standard external terms keep their conventional form** where spelling them out would be _less_ clear (e.g. `id` as a field name is universal; `URL`, `HTTP`, `JSON`, `SQL`). The rule targets _our_ invented shorthand, not the industry's established vocabulary.

> Hard invariants (no emojis, no shell for file ops, docs-in-commit) live in the root [`CLAUDE.md`](../../CLAUDE.md) — not duplicated here.
