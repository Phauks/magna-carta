# claude/automation-conditionals-slice

**Scope:** Build slice 2·6·2 — the template expression language, conditional blocks, repeating blocks,
and computed fields, per
[`docs/specs/2026-08-04-template-expression-language-design.md`](../specs/2026-08-04-template-expression-language-design.md)
and tasks 11 through 15 of
[`docs/specs/2026-08-04-document-automation-implementation-plan.md`](../specs/2026-08-04-document-automation-implementation-plan.md).

**Files expected to be touched**

- `packages/document-assembly/src/expression/` — new: `limits.ts`, `errors.ts`, `lex.ts`, `parse.ts`,
  `catalog.ts`, `check.ts`, `evaluate.ts`.
- `packages/document-assembly/src/blocks.ts` — new: block-marker recognition and the block structure
  the normalizer validates and the assembly walk expands.
- `packages/document-assembly/src/` — `normalize.ts` (block and computed-field recognition, the new
  failure codes), `assemble.ts` (scoped expansion + substitution walk), `types.ts` (manifest gains
  blocks, computed fields, and list values), `dictionary.ts` (list-valued entries), `resolve.ts`
  (batched collection read), `merge-statements.ts` (the parties collection read), `format.ts`,
  `package.json`, `CLAUDE.md`.
- `packages/document-assembly/test/` — new expression, block, repeat, computed-field, fuzz,
  denied-construct, and arithmetic-oracle suites.
- `packages/telemetry/src/metrics.ts` — `documentTemplate.expressionCheck`,
  `documentAssembly.expression`.
- `apps/worker/src/contracts/problem-types.ts` + `apps/worker/test/contracts/problem.test.ts` —
  `template-expression-invalid`, `assembly-expression-refused`.
- `apps/worker/src/routes/templates.ts`, `apps/worker/src/assemblies/assembly-consumer.ts` — the new
  problem types and the two counters.
- `docs/user/`, `roadmap.d/document-automation.md`, `ROADMAP.md` (the slice 2·6 bullet only),
  `status.d/2-6-document-automation.md`, `changelog.d/`, `docs/decisions/pending/`.

**Deferred, and why:** the two measured load-profile operations have nothing to accrete onto — the
`documentAutomation` volume profile named by the plan does not exist in
`packages/fixtures/src/load-profile/`, so building it is the earlier slice's outstanding work rather
than this one's. `status.d/2-6-document-automation.md` keeps `load-profile: todo`.

**Overlap watch:** anything else touching `packages/document-assembly` (slice 2·6·1 and the consent
refinements are merged, so the package is otherwise idle), `packages/telemetry/src/metrics.ts`, and
`apps/worker/src/contracts/problem-types.ts`.
