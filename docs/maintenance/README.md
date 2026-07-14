# Docs maintenance — the docs-sync routine and its run reports

**Single home for:** operating the scheduled documentation-maintenance system — the routine's trigger configuration, how to run/pause/re-create it, and the registry of run reports under [`reports/`](reports/). Design and rationale: [`docs/specs/2026-07-14-docs-sync-routine-design.md`](../specs/2026-07-14-docs-sync-routine-design.md) (realizing ADR-0058). Executable procedure: [`.claude/skills/docs-sync/SKILL.md`](../../.claude/skills/docs-sync/SKILL.md).

## What it is

Two workers with a hard boundary between them:

**Per-merge (deterministic, CI):** [`.github/workflows/assemble-docs.yml`](../../.github/workflows/assemble-docs.yml) runs on every push to `main`, folds the fragments into the rendered trackers (`changelog.d/` → `CHANGELOG.md`, `docs/decisions/pending/` → the Decision-Log register + numbered ADRs, `status.d/` → `STATUS.md`/`STATUS.json`), and delivers them as an **auto-merging pull request** from the `docs-assembly` branch — the gate fast-paths the docs-only diff and the PR merges itself, honoring the `main` ruleset. The changelog is therefore current minutes after every merged PR, mechanically. (Depends on the repository's "Allow auto-merge" setting; if off, the assembly PR waits for a manual merge.)

**Weekly (judgment, propose-only):** the docs-sync routine —

- audits the week's merges for coverage gaps (missing changelog fragments — drafted; missing user guides/ADRs — flagged);
- rolls `ROADMAP.md` up (shipped items out of **Now**, condensed into **Recently shipped**);
- deletes `docs/active-work/` notes whose branch is gone;
- re-runs the assemblers as a backstop (a non-empty result means the workflow missed a merge — reported);
- writes a run report and opens **one pull request** for human review. It never merges, never authors narrative, never touches code.

## The trigger (canonical configuration)

The scheduler is a Claude Code cloud **Routine** — a dumb clock outside the repo; everything it needs lives in-repo, so it can be created, deleted, and re-created losslessly from this block. (Status: not yet created — pending owner sign-off on the system design; any Claude session can create it from this configuration.)

- **Name:** `Docs sync — weekly docs-maintenance pass`
- **Schedule (cron, UTC):** `0 13 * * 1` (Mondays 13:00 UTC)
- **Session mode:** fresh session per firing (no carried context — the report registry is the only memory)
- **Notifications:** push + email on completion
- **Prompt:**

  > You are the Magna Carta docs-maintenance routine (propose-only). In the magna-carta repository, read `.claude/skills/docs-sync/SKILL.md` and follow it exactly: sync `main`, determine the audit window from the newest report in `docs/maintenance/reports/`, run the fragment assemblers, audit the window for documentation drift, roll up `ROADMAP.md`, write the run report, and open a single pull request from a `docs-sync/<YYYY-MM-DD>` branch. Never merge it yourself, never author design narrative or user-guide prose, never edit application code. If the skill file does not exist on `main`, stop and report that the docs-sync setup has not merged. If `main` has no new commits since the last report's `window-end`, stop without opening a pull request.

**Changing cadence:** edit the Routine's cron in the Claude Routines UI (or ask a session to `update_trigger`). Tighten if weekly PRs get large; loosen if runs come up empty. **Pausing:** disable the Routine — never delete the reports. **Running off-schedule** (e.g. to clear a backlog): fire the Routine manually from the UI, or invoke `/docs-sync` in any session on this repo.

## Run reports (`reports/`)

One file per run, `YYYY-MM-DD.md` (`-2` suffix on a same-day rerun), never edited after the fact — the same append-don't-collide discipline as the fragment directories. The frontmatter (`window-start`/`window-end` SHAs, counts, PR number) is the routine's machine-readable state: each run audits from the newest report's `window-end` to `main` HEAD, so nothing is skipped or double-reported. The first report is the [2026-07-14 baseline](reports/2026-07-14-baseline.md), which records the pre-routine state of every tracker.

## Reviewing a docs-sync PR

The PR body carries the run's **Action needed** list. Review like any other PR: the assembled outputs are deterministic (spot-check), the drafted fragments are the judgment calls (edit freely — they are proposals), and the flagged gaps are your to-do list, not the routine's. Merging the PR is what turns drafts into record; until then nothing is official.
