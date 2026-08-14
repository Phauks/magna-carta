# claude/semantic-convergence

**Scope:** Analysis only — no feature code. Answers owner flag D4: whether the discovery semantic
half earns its place beside the shipped Tantivy keyword engine, what the real cost figures are
(rather than the estimates the design was written against), and whether convergence between the two
indexes can be measured today.

**Deliverables**

- `docs/research/2026-08-14-semantic-half-convergence-and-cost.md` — the analysis.
- `docs/decisions/pending/<slug>.md` — a decision fragment, `status: Proposed` (owner's call).
- `changelog.d/<slug>.md` — a changelog fragment.
- `docs/operating-costs.md` — only figures that can be stood behind.
- This note.

**Files expected to be touched**

- `docs/research/2026-08-14-semantic-half-convergence-and-cost.md` (new)
- `docs/decisions/pending/the-semantic-half-stays-deferred-on-a-named-trigger.md` (new)
- `changelog.d/semantic-half-convergence-analysis.md` (new)
- `docs/operating-costs.md` (append one row group)
- `docs/active-work/claude/semantic-convergence.md` (this file)

**Read, not written:** `crates/search-eval/`, `crates/search-core/`, `packages/search/`,
`apps/search-worker/`, `containers/search/`, `apps/worker/src/search/`, `packages/inference/`,
`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`,
`docs/specs/2026-08-06-ai-search-integration-design.md`.

**Overlap risk:** low. No source file is modified. `docs/operating-costs.md` is the one shared file;
the edit is additive and appends a single group.
