# claude/expression-aggregates

**Scope:** Owner flag G4 answered (2026-08-05) — add `sum`, `minimum`, and `maximum` to the template
expression language's fixed helper catalog, taking a literal field path of a list-valued merge key,
bounded exactly as a `{{#each}}` repeat is. Pure expression layer: no schema, no migration, no route,
no UI. Design home:
[`docs/specs/2026-08-04-template-expression-language-design.md`](../../specs/2026-08-04-template-expression-language-design.md).

**Files expected to be touched**

- `packages/document-assembly/src/expression/` — `catalog.ts` (the three rows, the `listField`
  parameter and `fieldOfFirst` result specifications, the per-helper element types), `check.ts`
  (field-path resolution at registration), `evaluate.ts` (the one bounded pass), `lex.ts` (the lexical
  split of a field path).
- `packages/document-assembly/test/` — new `expression-aggregates.test.ts`; additions to
  `expression-denied-constructs.test.ts` and `expression-fuzz.test.ts`.
- `packages/document-assembly/CLAUDE.md` — the named-seam bullet retires.
- `docs/specs/2026-08-04-template-expression-language-design.md` — the G4 section and the flag table.
- `docs/decisions/pending/template-expression-aggregates.md` (new);
  `docs/decisions/pending/template-expression-realization.md` (its G4 item marked superseded).
- `docs/user/features/document-templates-and-assembly.md`, `changelog.d/`,
  `roadmap.d/document-automation.md`, `status.d/2-6-document-automation.md`.

**Deferred, and why:** no money-typed or date-typed item field exists in the shipped dictionary
(`matter.parties` carries text only), so the helpers are exercised against synthetic collections until
the widened dictionary lands one. The empty-collection ruling is recommended-and-flagged for owner
review and is the part most worth revisiting once real templates use it.

**Overlap watch:** anything else touching `packages/document-assembly/src/expression/` or the
document-automation spec, changelog, and roadmap entries.
