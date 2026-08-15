# claude/content-controls

**Scope:** A `.docx` whose blanks are **Word content controls** (`w:sdt` regions whose `w:sdtPr`
carries `w:showingPlcHdr`, or `w:dataBinding`) registered clean, declared no merge keys, and warned
only `no-placeholders` — "every assembly of it produces the same document" — then assembled with zero
absences into a document printing `Click here to enter text.` Nothing in `packages/document-assembly`
read `w:sdt` at all. The normalization pass now detects and reports them on the manifest as
`unboundContentControls`, reaching the same five surfaces the legacy form fields reach (registration
warning, `no-placeholders` suppression, field list, refusal, every assembly →
`succeeded_with_absences`). Nothing binds or converts one; a control an author filled in is
deliberately silent. Also fixes a gap left by the form-field work: a refused registration now names
both constructs in the response a person reads, which its decision record already claimed.

**Files expected to touch:**

- `packages/document-assembly/src/{normalize,types,register,assembly-statements}.ts`,
  `packages/document-assembly/test/{normalize,assemble}.test.ts`,
  `packages/document-assembly/test/support/docx-fixture.ts`,
  `packages/document-assembly/CLAUDE.md`
- The eight `packages/document-assembly/test/*-resolution.test.ts` and friends that build a
  `FieldManifest` literal (one added line each)
- `apps/worker/src/routes/templates.ts`, `apps/worker/src/assemblies/assembly-consumer.ts`,
  `apps/worker/test/document-automation.test.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/src/{index,types.gen}.ts` (both regenerated)
- `packages/fixtures/src/load-profile/document-automation-generate.ts` (manifest shape)
- `docs/user/features/document-templates-and-assembly.md` (one section)
- `roadmap.d/document-automation.md` (evidence + notes on one node, no status flip),
  `docs/now.md` + `docs/register-history.json` (regenerated)
- `changelog.d/`, `docs/decisions/pending/` fragments

**Not touching:** the metadata scrub (`w:documentProtection` surviving it stays a named gap in
`packages/document-assembly/CLAUDE.md`), the expression language, the catalogue, `STATUS.md` /
`status.d/`, `CHANGELOG.md`, the Decision-Log register, any other ledger node.

**Overlap to watch:** `changelog.d/` and `docs/decisions/pending/` are declared by several streams —
this one adds a new file to each and edits neither of theirs. `docs/now.md` and
`docs/register-history.json` are regenerated, and the rebuild also caught the register up on trunk
commits it had not read yet, so the diff there is larger than this node's own note change; a
concurrent ledger edit needs `vp run register-build` re-run after the merge.
