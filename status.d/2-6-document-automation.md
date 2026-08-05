---
slice: 2·6 — Document automation
group: phase-2
order: 6
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: in-progress by="Opus 4.8"
ui: todo
load-profile: todo
tested: in-progress by="Opus 4.8"
branch: claude/automation-conditionals-slice
active-work: docs/active-work/claude-automation-conditionals-slice.md
next: The widened dictionary — Directory role sources, `custom.<handle>` bindings, the letterhead logo, and protected-value binding through the decrypt-permission-plus-audit path. Then PDF output and the signature hand-off (2·6·3), and a location time-zone column behind timeZoneForLocation.
link-spec: docs/specs/2026-08-04-template-expression-language-design.md
link-plan: docs/specs/2026-08-04-document-automation-implementation-plan.md
adrs: ADR-0210, ADR-0211, ADR-0217, ADR-0218, ADR-template-expression-realization
blocked-by:
---

Build slice 2·6·1 shipped: the walking slice, template registration through to a filed document.
`@magna-carta/document-assembly` is a pure package over `fflate` + `fast-xml-parser` (the
`@magna-carta/metadata` substrate) holding the guarded OOXML reader/writer, the macro stripper and its
independent re-verification gate, the normalization pass, the declarative merge-field dictionary and
its formatters, the batched resolution pipeline, and the substitution engine. Four per-firm tables
(`document_template`, immutable `document_template_version`, `document_template_field_mapping`,
`document_assembly`), nine catalogue routes plus submit/poll, a `DocumentAssemblyJob` Durable Object
over a dedicated queue, and the assembled document filed through `initiateUpload` /
`completeUploadSession` — the one ingest chokepoint, no bypass. Owner decisions taken: `{{key}}` is
the single stored placeholder form, and the merge is in-house rather than an adopted library.

Both registration transforms of the firm's own document are **opt-in and always reported**, revised
on 2026-08-04 evening. Converting Word merge fields runs only on request, and a template registered
without it keeps them — each recorded on the field manifest with the part it sits in and the frozen
cached text it will print, reported again by every assembly in the response and on the provenance row,
and landing the assembly on `succeeded_with_absences`, so a blank that does not look like a blank
meets the same absence model an ordinary missing value does. Removing macros likewise runs only on
request; a macro-bearing upload without the opt-in is refused with both remedies named, never stored
carrying live macros and never stripped silently. The per-firm **field-mapping library** behind
`MergeFieldNameResolver` is built: confirmed Word-name-to-key mappings written when a conversion
confirms them, read once per registration, listed and deletable under `templates:manage`.

Build slice 2·6·2 shipped the **template expression language** and the three constructs written in it.
`src/expression/` is an OOXML-free folder — `limits.ts`, `errors.ts`, `lex.ts`, `parse.ts`,
`catalog.ts`, `check.ts`, `evaluate.ts` — holding one lexer, one recursive-descent parser over a closed
grammar, one static checker, and one total evaluator, so the language was proven as a language before it
met a package. A merge key is ONE lexical atom resolved by exact match through a `Map`, there is no
production for property traversal, indexing, assignment, a lambda, a regular expression, or a call to
anything but a frozen helper allowlist, and nothing in the folder throws. Lex, parse, name-resolve,
type-check, format-check, and limit-check all run at REGISTRATION, so a type error is a registration
failure with a part, an excerpt, and a character offset inside the expression — never an assembly
surprise. The manifest stores each block's and computed field's SOURCE rather than a tree, and assembly
re-checks from it, which is what catches dictionary drift.

`{{#if}}` / `{{#unless}}` / `{{#each}}` / `{{= }}` operate on whole paragraphs and whole table rows —
a marker in a row's first cell makes the row the unit — so list numbering and table banding survive a
removed or a repeated unit, and every repeat clone carries its own paragraph and row properties. Money
arithmetic is integer-exact through `@magna-carta/money`, with every intermediate checked before the
operation so the package's own guard is unreachable; division is not an operator, and `divideExact`,
`divideRounded`, `applyRate`, `percentOf`, and `allocate` each state their rounding. Owner-flagged
defaults applied as recommended: an unresolved condition FAILS the assembly naming the field (G1),
banker's rounding only (G2), no business-day math (G3), no pronoun helper (G5). G4 was answered the
following day the other way: `sum`, `minimum`, and `maximum` fold a LITERAL FIELD PATH of a list-valued
key, bounded by exactly what a repeat is bounded by — one batched read, the items-per-repeat cap, a
step per element — with an empty collection left unresolved rather than answered zero, because a
smallest of nothing has no answer and a total of no amounts has no currency. `matter.parties` is the
first list-valued source, one batched read for the whole collection.

The security claim carries its fuzz obligation in the slice: a seeded structure-aware generator over
the grammar, a seeded byte-level generator, a committed denied-construct corpus that must fail at parse
or check and never at evaluation, a pretty-print-and-reparse property (which found a real precedence
bug), an independent BigInt arithmetic oracle, and one bound-hitting test per declared limit.

Remaining for the subsystem: the widened dictionary sources and protected-value binding, PDF output and
the signature hand-off (2·6·3), authoring surfaces (2·6·4), the interface seams, and the load-profile
volume profile.
