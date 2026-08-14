# claude/register-history

**Scope:** Give the build register a "Where we have been" section. `roadmap.d/` is version
controlled, so the counts at every past first-parent commit that touched it can be read back by
re-parsing the ledger with the same parser the live build uses. Reconstruct them once into a
committed data file, append the missing rows on an ordinary `register-build`, and render the trend
— snapshots, movement per area, and the rate — with the commits that do not parse under today's
schema recorded as gaps rather than estimated.

**Files expected to touch:**

- `tooling/doc-fragments/register-history.mjs` (new — the pure history model: snapshots, merge
  order, summary arithmetic), `tooling/doc-fragments/register-history.test.mjs`
- `tooling/doc-fragments/build-register-history.mjs` (new — the impure reconstruction: reads the
  ledger out of git, appends missing rows, `--rebuild` recomputes from scratch),
  `tooling/doc-fragments/build-register-history.test.mjs`
- `tooling/doc-fragments/roadmap.mjs` (the register renderer gains the section),
  `tooling/doc-fragments/roadmap.test.mjs`
- `tooling/doc-fragments/build-register.mjs` (updates the history file, then renders)
- `tooling/lint-roadmap.mjs` (the drift gate now re-derives from ledger + history file)
- `docs/register-history.json` (new — the persisted reconstruction), `docs/now.md` (regenerated)
- `vite.config.ts` (the history file joins the generated-artifact formatter exclusions)
- Pointer lines only: `roadmap.d/README.md`, `docs/conventions/documentation.md`
- `changelog.d/`, `docs/decisions/pending/` fragments

**Not touching:** `roadmap.d/*.md` node content, `CHANGELOG.md`, `STATUS.md`/`status.d/`, the
Decision-Log register, any application code.
