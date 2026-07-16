# Docs-sync routine — scheduled docs maintenance and the public-tracker pipeline

**Date:** 2026-07-14 · **Status:** Accepted (decision fragment: `docs/decisions/pending/docs-maintenance-routine.md`) · **Realizes:** ADR-0058 (propose-only docs-maintenance agent) · **Builds toward:** ADR-0048 (public product-updates surface)

**Scope (single home for):** the design of the scheduled documentation-maintenance system — the routine that keeps the rendered trackers (`CHANGELOG.md`, `ROADMAP.md`, `STATUS.md`, the Decision-Log register) current against merged work, the run-report registry that gives it memory, and the layered pipeline that will later feed a public-facing roadmap and changelog. Operating instructions live in [`docs/maintenance/README.md`](../maintenance/README.md); the executable procedure lives in [`.claude/skills/docs-sync/SKILL.md`](../../.claude/skills/docs-sync/SKILL.md).

## Problem

The documentation model is docs-in-commit: every change ships its fragments (`changelog.d/`, `docs/decisions/pending/`, `status.d/`) in the same commit, so **authoring** never drifts. But two steps live outside any commit and depend on a human remembering them on `main`:

1. **Assembly.** `vp run decisions-build` / `changelog-build` / `status-build` fold fragments into the rendered outputs "on `main`, right after a merge." In practice this runs in batches when someone remembers. Measured at the time of this design: rendered `CHANGELOG.md` and `STATUS.md` last assembled 2026-07-03, the Decision-Log register 2026-07-09, while `main` carried 236 further commits and a backlog of 52 changelog fragments and 25 pending decision fragments.
2. **Rollup.** `ROADMAP.md`'s Now / Next / Recently shipped narrative is updated per PR in theory, but shipped slices accumulate in **Now** instead of rolling into **Recently shipped**, and the file grows without bound (it exceeded 60k tokens of prose before this design).

The move to cloud sessions (Claude Code on the web) removes the last reliable trigger — "the owner's machine, right after pressing merge" — so the gap needs a scheduled owner, not more discipline. ADR-0058 already decided the shape of the answer: deterministic hygiene belongs to machinery, judgment-bearing drafting belongs to a **propose-only** agent that never authors narrative and never auto-merges. This design realizes that agent as a scheduled routine.

## Goals

- The rendered trackers (`CHANGELOG.md`, Decision-Log, `STATUS.md`) update **with every merge to `main`**; the judgment-bearing surfaces (roadmap narrative, coverage) are never more than one routine cadence behind.
- Every merged change is either represented in the changelog or explicitly flagged as a coverage gap — nothing ships silently.
- The system has **memory**: each run knows exactly which window of `main` it audited, so nothing is double-reported or skipped.
- Every moving part is **versioned in the repository**; the scheduler outside the repo is a dumb clock that could be recreated from the docs in five minutes.
- The pipeline is layered so a public-facing roadmap/changelog later becomes _one more consumer of an existing output_, not a rework.

## Non-goals

- No public UI yet (ADR-0048 owns that surface; this design feeds it).
- No release version-cutting (cutting `[Unreleased]` into dated versions remains a future Phase-0 pick; the routine leaves `[Unreleased]` intact).
- No authoring: the routine never writes design narrative, user-guide prose, specs, or ADR content beyond mechanical drafts explicitly marked for approval (the ADR-0058 boundary).
- No code edits of any kind from the routine.

## Architecture — four layers

The system is a pipeline of four independent layers. Each has one owner, one direction of data flow, and a replaceable seam to the next.

```
1 AUTHORING      branches commit fragments in the same commit as the work
                 (changelog.d/, docs/decisions/pending/, status.d/, docs/active-work/)
       │
2 ASSEMBLY       deterministic, per-merge: on every push to main, CI folds fragments
   (render, CI)  into the rendered outputs — CHANGELOG.md, Decision-Log register +
                 numbered ADR files, STATUS.md + STATUS.json
                 (.github/workflows/assemble-docs.yml)
       │
3 MAINTENANCE    judgment-bearing, scheduled, propose-only: the docs-sync routine
   (the routine) audits the merge window for coverage gaps, rolls ROADMAP.md up,
                 drafts missing fragments, writes a run report — all delivered as
                 ONE pull request a human reviews
       │
4 PUBLICATION    future: machine-readable projections (changelog/roadmap JSON with
   (public seam) an audience filter) consumed by the ADR-0048 public surface
```

Layer 1 already exists and is unchanged. This design **moves layer 2 from "a human runs the assemblers on `main` after merge" to per-merge CI** — the rendered changelog updates with every merged PR, which is the correct cadence for a deterministic transform (the ADR-0058 principle: deterministic hygiene is machinery, not an agent). Delivery is an **auto-merging pull request** from the `docs-assembly` branch: the `main` ruleset requires the `gate` status on every commit, and the gate fast-paths a docs-only diff (format + governance, about a minute), so the PR merges itself hands-free while the ruleset stays honored. The flow is loop-safe (the merged assembly commit contains no fragments, so the run it triggers exits without a PR) and race-safe (a merge landing while an assembly PR waits simply updates that PR to the superset), serialized by a concurrency group. Layer 3 is new; layer 4 is a specified seam.

## Layer 3 — the docs-sync routine

### Trigger (outside the repo — a dumb clock)

A Claude Code cloud **Routine** (scheduled trigger), firing a **fresh session** on a weekly cron. The trigger carries only a short standing prompt pointing at the in-repo skill; all procedure, state, and policy live in the repository. Canonical trigger configuration (name, cron, prompt text) is recorded in [`docs/maintenance/README.md`](../maintenance/README.md) so the trigger can be deleted and recreated losslessly.

Cadence: **weekly** (Monday 13:00 UTC) to start. Rationale: with assembly already per-merge in CI, the routine's PR carries only judgment content (drafts, rollup, flags); at roughly 60–80 commits a week on `main`, weekly keeps that reviewable in one touchpoint. The cadence is a single field on the trigger — tighten to twice-weekly if PRs get large, loosen if they run empty. Runs where `main` has not moved exit without opening a PR.

### Session flow (the skill, summarized)

Each firing clones the repo fresh and follows [`.claude/skills/docs-sync/SKILL.md`](../../.claude/skills/docs-sync/SKILL.md):

1. **Window.** Read the newest report in `docs/maintenance/reports/`; the audit window is its `window-end` commit → current `main` HEAD. Empty window → stop, no PR.
2. **Branch.** Create `docs-sync/<YYYY-MM-DD>` off `main`. Exactly one docs-sync stream may exist at a time; an unmerged prior docs-sync PR halts the run with a reminder instead of stacking a second one.
3. **Assemble (backstop only).** Run the three assemblers (`node tooling/doc-fragments/build-decisions.mjs`, `build-changelog.mjs`, `build-status.mjs`). With per-merge CI assembly in place this is normally a no-op; it folds anything the workflow missed (e.g. a workflow outage). A non-empty result is itself a finding for the report. This is the one sanctioned case of a branch carrying rendered-output edits — safe because the stream is unique and short-lived, and reviewed because it lands by PR.
4. **Audit the window.** Walk merges/commits in the window and flag, per ADR-0058: merged work with no changelog fragment (draft one, marked for approval); user-visible changes with no `docs/user/` guide; design changes with no ADR; referenced ADRs that do not exist; `docs/active-work/` notes whose branch is gone.
5. **Roll up ROADMAP.md.** Move shipped items from **Now** into **Recently shipped**, condensing to summary-plus-links (detail already lives in CHANGELOG/STATUS/specs — one home per fact); refresh **Now** from `STATUS.md` stage reality. Move and condense only — never invent narrative.
6. **Report.** Write `docs/maintenance/reports/<YYYY-MM-DD>.md` (format below) recording the window, what was assembled, what was drafted, and what needs a human.
7. **Propose.** Commit, push, open **one pull request**, and stop. The routine never merges, never edits code, never touches anything outside the documentation surfaces named here.

### Guardrails (the ADR-0058 boundary, made operational)

- **Propose-only:** delivery is always a PR; the human review is the gate that turns drafts into record.
- **No narrative authoring:** drafted changelog entries are one-line mechanical summaries of merged work; anything needing real prose (user guide, spec, ADR body) is _flagged_ in the report, not written.
- **Bounded write surface:** rendered trackers, fragment directories, `ROADMAP.md`, `docs/maintenance/`, `docs/active-work/` deletions — nothing else.
- **Single stream:** one open docs-sync PR maximum, so the fragment-workflow collision guarantee holds.

## The report registry — the routine's memory

`docs/maintenance/reports/` holds one file per run, named `<YYYY-MM-DD>.md` (suffix `-2` on a same-day rerun), never edited after the fact — the same append-don't-collide discipline as every other fragment directory. Frontmatter is the machine-readable state:

```markdown
---
window-start: <full SHA — the previous report's window-end>
window-end: <full SHA — main HEAD at run time>
commits: <count in window>
assembled: { changelog: N, decisions: N, status: rendered }
drafted: N
flagged: N
pr: <PR number or "none">
---
```

Body: a short human summary — what shipped in the window, what was drafted, and an **Action needed** list for the reviewer. The first file is the [2026-07-14 baseline](../maintenance/reports/2026-07-14-baseline.md), which captures the pre-routine state and pins the first `window-end`. State lives in the repo, in the merge history, so a fresh session — or a different scheduler entirely — can always reconstruct it.

## Redesign decided with this spec: the roadmap becomes a feature ledger

Three of the four trackers are already rendered outputs of fragments; `ROADMAP.md` is the outlier — unbounded hand-written narrative, which is both why it drifts (nothing assembles it) and why it cannot yet feed a public surface (no structure to project from). Owner decision (2026-07-14): the roadmap is rebuilt as a **feature ledger** — an exhaustive, growing inventory of every capability the white paper promises, feature by sub-feature, each carrying a status. It is a third _kind_ of tracker: `status.d/` tracks **execution units** (slices — transient, build-ordered); the ledger tracks **product capabilities** (durable, user-shaped — what the product does and how complete it is). Conflating the two is what rotted the old ROADMAP.

- **Source of truth: `roadmap.d/`** — one file per product area mirroring the white paper's areas; flat node blocks with hierarchy in a dotted stable `id`; format and status vocabulary in [`roadmap.d/README.md`](../../roadmap.d/README.md). Nodes hold only what no other home owns — a status plus links (white paper keeps the narrative; specs/ADRs keep the design; `status.d/` keeps slice stages via the `slices:` key). Fragments persist and grow; ids never renumber; dropped promises flip to `cut` rather than vanish.
- **`roadmap-build` (follow-up slice)** renders the set into `ROADMAP.md` — a human tree view with status glyphs and per-area rollup counts ("Trust: 3/14 shipped"), headed by the only remaining hand-written prose, a small **Now** narrative block — and `roadmap.json`, the machine view. The "interactive white paper" the owner wants is a rendered _join_: the white paper's structure browsed with live status badges — a projection over two existing sources, never a third copy. It and the public roadmap consume `roadmap.json` (with the `audience` filter); neither parses the Markdown. A `lint:roadmap` fitness function (id uniqueness/stability, status vocabulary, link existence) joins the gate alongside `lint:status`.
- **Maintenance follows the house rules:** a PR that ships or advances a feature flips its node in the same commit (docs-in-commit); the weekly routine audits merges that advanced a capability without flipping its node and proposes the flip.
- **Initial population (done with this spec):** the tree was extracted from the white paper by a parallel audit and every node statused against the verified 2026-07-14 baseline — evidence-backed drafts reviewed in the setup PR.
- **Until `roadmap-build` ships,** the hand-written `ROADMAP.md` remains the narrative view and the routine bridges by hand (flow step 5); on the assembler's arrival `ROADMAP.md` becomes a rendered output and its hand-edited history closes.

## Layer 4 — the public-facing seam (designed now, built later)

The roadmap and changelog will become public. The pipeline is shaped so that is additive:

- **Audience is authored at the fragment,** where the knowledge exists. Changelog fragments gain optional frontmatter: `audience: public | internal` (default `internal`) and, when public, a `public-summary:` line written in user language. The assembler carries both through; nothing existing breaks (absent field = internal). Roadmap entries carry the same field once `roadmap-build` exists.
- **Machine-readable projections are assembler outputs.** `STATUS.json` already proves the pattern. When the public surface opens, `changelog-build` additionally emits `changelog.json` (every entry: category, date folded, audience, summary, public-summary), joining `roadmap.json` from the redesign above. The public changelog/roadmap are then **filters over these files** (`audience: public` only) — a curated projection, never a raw dump of internal entries.
- **The consumer is ADR-0048's product-updates surface** (in-app and public web). It reads the JSON artifacts; it never parses the human Markdown. Any future consumer (an RSS feed, a status page entry, a marketing site) plugs into the same files.
- **Release cutting slots in above, unchanged:** when version-cutting begins, cutting `[Unreleased]` into a dated section is one more deterministic transform in `tooling/doc-fragments/`, and `changelog.json` gains a `version` field.

Nothing in layer 4 is built now; the fragment frontmatter fields are reserved names, and this section is their one home until a build slice opens.

## Considered and rejected

- **Weekly-batch assembly instead of per-merge CI** (the first draft of this design had the routine run the assemblers as its step 3). Rejected on review (owner, 2026-07-14): assembly is deterministic, so batching it behind a weekly LLM run made the changelog up to a week stale for no benefit and put machinery work on an agent. Per-merge CI assembly is the ADR-0058 principle applied at the right cadence; the bot commit per merge is docs-only and cheap. The routine keeps the assemblers only as a backstop.
- **Routine pushes its judgment half directly to `main`.** Fewer review cycles, but it gives an agent unreviewed push access to `main` for non-deterministic content — propose-only is the ADR-0058 line, and one PR per run is cheap.
- **Direct workflow pushes to `main` for assembly** (the first-built shape). Rejected by reality: the `main` ruleset requires the `gate` status on every commit and refused the bot's push. Rather than granting a ruleset bypass, assembly delivers as an **auto-merging pull request** from the `docs-assembly` branch (owner-directed): the gate fast-paths the docs-only diff (format + governance, about a minute) and the PR merges itself — same hands-free result, ruleset honored. Because a PR created with the workflow's own token fires no `pull_request` events, the workflow dispatches the gate onto the branch explicitly (`gate.yml` carries `workflow_dispatch`). Requires the repository's "Allow auto-merge" setting.
- **A self-continuing session instead of fresh-per-fire.** Accumulated context is a liability for a recurring auditor (stale assumptions about repo state); the repo-held report registry is deliberately the only memory.
- **Keeping the roadmap/changelog current by hand.** The measured state (eleven days and 236 commits of drift under an explicit same-commit rule) is the refutation; discipline is not a strategy.
- **A docs-authoring agent.** Already rejected by ADR-0058 — it would reintroduce the drift docs-in-commit exists to prevent.

## Rollout

1. This branch lands the spec, decision fragment, skill, the `assemble-docs` workflow, `docs/maintenance/` home, the **verified** baseline report (a walkthrough of the trackers against the actual program — trust is established once by inspection, then maintained by machinery), and pointer updates (`CLAUDE.md` map row; `docs/conventions/documentation.md`).
2. The weekly trigger is created alongside it (configuration mirrored in `docs/maintenance/README.md`).
3. On merge to `main`, the `assemble-docs` workflow's first run clears the measured fragment backlog (52 changelog + 25 decision fragments) automatically via its auto-merging `docs-assembly` pull request; the routine's first run handles the ROADMAP rollup and the baseline's flagged gaps. **Two one-time repository settings gate this:** "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General) so the workflow can open its PR, and "Allow auto-merge" (Settings → General) so it merges itself. The workflow fails loudly if either is missing rather than passing green.
4. **`roadmap-build` follow-up slice:** the assembler + `lint:roadmap` over the populated `roadmap.d/` ledger, rendering `ROADMAP.md` (tree view + hand-written Now header) and `roadmap.json`. Its own plan when it opens; the ledger population landed with this spec.
5. Layer 4 opens as its own slice when the public surface is scheduled, with a fresh design cycle over this seam.
