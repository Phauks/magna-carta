---
branch: claude/ci-austerity
worktree: .claude/worktrees/agent-a5daa639e89272ec2
area: Temporary CI austerity — suspend the gate's post-merge, scheduled, and whole-repo tiers
status: review
touches: .github/workflows/gate.yml, docs/conventions/build-performance.md, docs/conventions/operations.md, docs/decisions/pending/, changelog.d/
---

The GitHub Actions minutes are at their budget limit (owner decision, 2026-08-05), so this stream
reduces the CI cadence for the duration: the gate's `schedule` (nightly sweep) and `push` to `main`
triggers are commented out, and the `ALL` branch of the lint job's scope switch is a no-op. The
`pull_request` tier is deliberately untouched and still runs the full battery at one-hop lint scope, as
is `assemble-docs.yml` (cheap, keeps the rendered trackers current), `merge_group`, and
`workflow_dispatch`.

Every suspension carries the literal marker `TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions
minutes reset`, so the reversion is one `grep -r "TEMPORARY CI AUSTERITY"`. The posture, the merge bar
during the window (agent full local verification plus orchestrator review), and the revert checklist
live in `docs/conventions/build-performance.md`; the decision itself is
`docs/decisions/pending/temporary-ci-austerity.md`.

**What a concurrent stream should know:** while this is in effect, a merge is backed by the
pull-request gate plus your own whole-repo `pnpm check` and `vp test` — say in the pull request which
you ran. Do not restore the triggers piecemeal; the revert is the checklist in
`build-performance.md`, run in one pass when the minutes reset.

## Files expected to be touched

- `.github/workflows/gate.yml` — triggers and the lint job's scope switch. `assemble-docs.yml` is read
  but not edited.
- `docs/conventions/build-performance.md` (the austerity section, the home for this posture) and a
  one-line pointer in `docs/conventions/operations.md`.
- `docs/decisions/pending/temporary-ci-austerity.md`, `changelog.d/temporary-ci-austerity.md`.

**Never edited:** `tooling/affected-lint/**` — the scoping logic is unchanged; only the gate's use of
its `ALL` answer is suspended.
