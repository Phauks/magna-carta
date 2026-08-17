---
worktree: /home/user/magna-carta/.claude/worktrees/register-artifact
area: Generate the owner-facing build-register page from the feature ledger instead of hand-authoring it
status: building
touches: tooling/doc-fragments/, tooling/lint-roadmap.mjs, vite.config.ts, docs/conventions/documentation.md, docs/now.html, changelog.d/
---

The build register has two readers and only one generated rendering: `docs/now.md` is built from
`roadmap.d/`, while the page the owner actually reads was hand-authored HTML carrying the same facts
and going stale on every merge. This stream adds a pure HTML emitter beside the Markdown one
(`tooling/doc-fragments/register-artifact.mjs`), writes `docs/now.html` from the same
`vp run register-build`, and extends the `lint:roadmap` drift gate to hold it byte-exact.

Touches shared tooling: `tooling/doc-fragments/roadmap.mjs` gains three exports (`countByStatus`,
`share`, `STATUSES_WITH_NOTHING_BUILT`) so both renderings count with one arithmetic — no behaviour
change to the Markdown. Also edits the formatter ignore list in `vite.config.ts` and one paragraph of
`docs/conventions/documentation.md`. Nothing under `apps/`, `packages/database`,
`packages/directory` or `packages/pdf`.
