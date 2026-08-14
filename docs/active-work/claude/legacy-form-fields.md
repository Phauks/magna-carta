# claude/legacy-form-fields

**Scope:** Three things. (1) A `.docx` built from **legacy Word form fields** (`FORMTEXT` /
`FORMCHECKBOX` / `FORMDROPDOWN` complex fields carrying `w:ffData`) registered clean, declared no
merge keys, and reported no absence — so it filed carrying the form's own "Click here to enter
caption". The normalization pass now detects and reports them on the manifest; nothing binds or
converts one. (2) A fitness scan rejecting raw control characters in tracked source and Markdown,
plus converting every existing occurrence to its escape form. (3) One feature-ledger node corrected
against the repository.

**Files expected to touch:**

- `packages/document-assembly/src/{normalize,types,register,assembly-statements}.ts`,
  `packages/document-assembly/test/{normalize.test.ts,support/docx-fixture.ts}`,
  `packages/document-assembly/CLAUDE.md`
- `apps/worker/src/routes/templates.ts`, `apps/worker/src/assemblies/assembly-consumer.ts`,
  `apps/worker/test/document-automation.test.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/src/` (both regenerated)
- `packages/fixtures/src/load-profile/document-automation-generate.ts` (manifest shape)
- `tooling/lint-control-characters.mjs` (new), `package.json`, `.github/workflows/gate.yml`,
  `tooling/git-hooks/pre-push`, `docs/conventions/code-style.md`
- The escape conversions, one line or two each: `apps/worker/src/joining-secrets.ts`,
  `packages/data-access/src/scoped-setting-statements.ts`,
  `packages/email-filing/src/matter-suggestion.ts`,
  `packages/file-manager/src/metering-statements.ts`, `packages/search/src/fusion.ts`,
  `packages/metadata/test/image-jpeg.test.ts`,
  `packages/document-assembly/test/expression-{fuzz,denied-constructs}.test.ts`,
  `docs/specs/2026-06-18-usage-analytics-implementation-plan.md`
- `roadmap.d/document-automation.md` (one node), `docs/now.md` (regenerated)
- `changelog.d/`, `docs/decisions/pending/` fragments

**Not touching:** the metadata scrub (`w:documentProtection` surviving it is named as a known gap in
`packages/document-assembly/CLAUDE.md`, not fixed here), `packages/trust/`, `STATUS.md`/`status.d/`,
`CHANGELOG.md`, the Decision-Log register, any other ledger node.

**Overlap to watch:** `changelog.d/` and `docs/decisions/pending/` are declared by several streams —
this one adds a new file to each and edits neither of theirs. `docs/now.md` is regenerated from the
ledger, so a concurrent ledger edit needs `vp run register-build` re-run after the merge.
