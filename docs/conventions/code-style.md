# Code style

**Status:** Active for every section marked _(decided)_ below — the line-length, naming, process-reference and control-character rules are enforced by the gate and cited by the root `CLAUDE.md` golden rules. The general style guide beyond those rules is still to be written.

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
- Comments are **self-contained and process-agnostic** — never cite an ADR, spec, section/`§` number, numbered decision, plan task, spike, or white-paper section a line was derived from (those pointers rot when a doc is reorganized or superseded, and mean nothing to a future reader). Explain the thing itself, or point to a stable file by path. The hard rule and its one exception are below (_No process-artifact references_).
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

## No process-artifact references (decided)

**Code explains itself; it cites files, not process docs.** Source, tests, config, and consumer-facing strings (e.g. OpenAPI `description`s) carry **no references to process artifacts** — no `ADR-NNNN`, no "design spec" / "spec §N", no white-paper section citation, no "slice 0·N" / "Phase N", no "decided #N" / plan "Task N", no "spike". The golden rule lives in the root [`CLAUDE.md`](../../CLAUDE.md); this is its detailed home.

- **Why:** ADRs, specs, and plans are point-in-time process records that move, renumber, and get superseded. A comment that explains the _reasoning_ outlives them; a citation rots and means nothing to a future reader. Decisions are still recorded as ADRs — the [Decision Log](../Decision-Log.md) is their home, never the source.
- **Fix:** state the reasoning inline (the common case — the explanation usually already sits beside the citation, so just drop the parenthetical), or point to a concrete file (another module, or a living standard under [`docs/conventions/`](.) **by path** — a path is a real, navigable reference; a section number is not).
- **The one exception — forward-looking schedule.** A reference that names **when** an interim or seam gets replaced, or a feature gets built, is allowed because it states a real schedule, not a process-doc citation: e.g. `slice 0·6 swaps in the real email adapter`, `Phase 3 adds the product chart-of-accounts`. The test: does it describe a _future_ replacement/build? Keep it. Does it merely label which past slice/ADR produced the line? Remove it.
- **What is NOT covered.** This rule governs **code**. Documentation — the white paper, ADRs, specs, conventions, per-area `CLAUDE.md` files, `CHANGELOG`/`ROADMAP`/`STATUS` — cites ADRs and specs freely; that is its job. Generated files (`*.gen.ts`, the OpenAPI snapshot) are exempt (fix their source, then regenerate).
- **Enforcement.** A CI source-scan fitness function, `pnpm run lint:process-refs` ([`tooling/lint-process-references.mjs`](../../tooling/lint-process-references.mjs)), hard-bans the unambiguous citations (ADR numbers, design-spec/`§`, numbered decisions, white paper, spike) across code and fails the build on any. Forward-looking slice/phase notes are allowed by the rule and left to review rather than scanned (telling them from backward labels mechanically is unreliable).

## No raw control characters in source

**A control character is written as an escape, never as the byte itself.** `"\0"`, not a literal NUL; `"\u001b"`, not a literal escape byte. Tab, newline, and carriage return are the three exceptions — those a source file holds raw.

**And no raw U+FFFD.** The replacement character is written `\uFFFD`. It is not a control character and it is banned for its own two reasons: it is what a decoder emits for bytes it could not read, so a literal one is indistinguishable from a file that was mangled in transit; and one inside a `u`-flagged regular expression that is actually used hangs the linter outright — no error, no timeout, no file named. That is not a hypothetical either: one character in one file made `pnpm gate`'s lint dimension unrunnable for six days in September 2026, diagnosed five separate times as a slow machine, while every scoped check stayed green because the scoped check lints the diff and nothing had touched that file since it landed. The same scan enforces both.

- **Why:** the raw byte is invisible. It does not show in a file read, in `git diff`, in a review pane, or in most editors, so the source reads as one thing and means another. This is not theoretical: a separator written as a literal NUL read as `.join("")` to two separate readers on the same day and produced a wrong diagnosis of a real defect. The escape is the same value at runtime, costs one character, and says what the byte is.
- **Fix:** write the escape. `\0`, `\b`, `\v`, `\f` where a short form exists, `\uNNNN` otherwise — the scan prints the exact replacement for each finding.
- **This includes tests.** A test whose subject IS the control byte is the case where the escape helps most: `Array.from("PK\u0003\u0004", …)` names the zip local-file-header magic, and the raw form names nothing.
- **Escape hatch:** a `control-characters:allow — <reason>` comment on the same line, for the rare case where writing the escape would change what the line proves. A bare marker with no reason fails the scan.
- **Enforcement.** A CI source-scan fitness function, `pnpm run lint:control-characters` ([`tooling/lint-control-characters.mjs`](../../tooling/lint-control-characters.mjs)), over the same code extensions as the process-reference scan, plus Markdown — a code sample in a document gets copied into source, so an invisible byte there travels. It self-tests on every run, because a check that never fires over invisible bytes is indistinguishable from a clean tree. Data files and binary fixtures are not scanned — a control byte in a corpus is the corpus. The two findings are reported apart: the remedy is the same, the reasoning is not, and a reader given the wrong reason argues with the rule instead of fixing the line.

> Hard invariants (no emojis, no shell for file ops, docs-in-commit) live in the root [`CLAUDE.md`](../../CLAUDE.md) — not duplicated here.
