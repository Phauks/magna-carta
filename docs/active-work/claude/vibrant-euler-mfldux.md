---
worktree: C:/dev/magna-carta-worktrees/claude/vibrant-euler-mfldux
area: The quality gate leaves GitHub Actions — `pnpm gate` runs every dimension locally; gate.yml, seed-caches.yml and lint:cache-keys are removed
status: review
touches: tooling/gate, tooling/git-hooks/pre-push, tooling/check-scoped, tooling/lint-test-collection, tooling/lint-lints, tooling/affected-lint, .github/workflows, .github/actions/setup, .github/pull_request_template.md, package.json, vite.config.ts, CLAUDE.md, README.md, docs/conventions/build-performance.md, docs/conventions/operations.md, docs/conventions/documentation.md, docs/conventions/api.md, docs/conventions/security.md, docs/maintenance/README.md, docs/deploy-queue.md, roadmap.d/maintenance-agents.md, changelog.d, docs/decisions/pending
---

Removes the GitHub Actions gate that an exhausted Actions budget kept wedging every pull request
behind, and keeps its functionality as one local command: `tooling/gate/index.mjs` runs the same
dimensions (format, governance, the pinned osv-scanner audit, wasm, typecheck, contracts, the
affected-closure lint, rust, containers, the test-collection floor, the full `pnpm test`) with the
workflow's path classification. Every lint and document that read or cited the workflow is repointed.
A concurrent stream editing `docs/conventions/build-performance.md` or `docs/conventions/operations.md`
under _Quality gates_ should merge this first.
