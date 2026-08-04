---
branch: claude/ci-cost-reduction
worktree: .claude/worktrees/agent-a0ee9ffbd87ca5bec
area: Tier the gate workflow by trigger and cache the work it repeats
status: review
touches: .github/workflows/gate.yml, .github/actions/setup/action.yml, tooling/affected-lint/, containers/docker-build.sh, containers/*/tests/*.sh, docs/conventions/build-performance.md, changelog.d/
---

CI-only change: no product code, no schema, no API surface. The gate now runs a different pass per
trigger (pull request = full tests + one-hop lint; push to `main` = whole-repo type-check + full lint
closure, no test battery; a new nightly schedule = everything cold and unscoped; `merge_group` = full
battery, inert until a merge queue is enabled), the `changes` job stops classifying documentation and
the rendered trackers as code, and the repeated work is cached (`node_modules`, `Swatinem/rust-cache`,
buildx layer cache for the container images, `.tsbuild` state for `tsc -b`).

Overlaps to watch: `claude-docs-sync-routine-setup-c3hy7m` also lists `.github/workflows/` — that stream
owns `assemble-docs.yml`, which this stream does not touch. The classification fix here is what stops
that workflow's assembly commit from booting the whole code battery on every merge, so the two are
complementary rather than conflicting. `docs/conventions/build-performance.md` gains two new sections
at the end; nothing above them is rewritten.
