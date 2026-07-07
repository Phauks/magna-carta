# Status fragments

One file per slice — `status.d/<slice-slug>.md`. [`STATUS.md`](../STATUS.md) and
[`STATUS.json`](../STATUS.json) are **build outputs** assembled from these by `vp run status-build`;
never hand-edit them. Each worktree edits only its own slice's fragment, so parallel branches never
collide on the tracker (the `changelog.d/` → `CHANGELOG.md` pattern, but **persistent** — a slice's
status keeps moving, so fragments live on and are re-rendered every build, never consumed).

`_sections.md` holds the page scaffolding (title, legend, phase headings + preambles) with a
`{{table:<group>}}` token where each group's table is injected. Edit it only to change that prose.

## Fragment format

Flat frontmatter (no nested YAML) + a one-line Notes body:

```markdown
---
slice: 3·2 — Trust accounting + jurisdiction compliance
group: phase-3 # phase-0 | phase-1 | phase-2 | cross-cutting | phase-3
order: 2 # position within the group's table
research: in-progress
spec: in-progress
plan: todo
built: todo
ui: todo
load-profile: todo
tested: todo
branch: trust-accounting # where the work lives (main once landed)
active-work: docs/active-work/trust-accounting.md # when in flight, else empty
next: Finish the spec, then write the implementation plan
link-spec: docs/specs/2026-...-trust.md # empty until it exists
link-plan:
adrs: ADR-0009 # comma-separated, empty if none
blocked-by: # comma-separated slice ids, empty if none
---

**Current focus** — design in progress. Tier-1 rigor vs Tier-2 restriction; NV baseline.
```

### Stage tokens

Each of the seven stages is `<state> [by="Model X.Y"] [awaiting] [gap]`:

- **state** — `done` · `in-progress` · `todo` · `n/a` → renders `[x]` · `[~]` · `[ ]` · `[-]`.
- **`by="…"`** — model attribution (omit for the Fable 5 baseline); renders verbatim after the marker.
- **`awaiting`** — still awaits an independent Fable 5 pass; renders `↻`.
- **`gap`** — done under Opus during the Fable-access gap; renders a trailing `\*`.

So `built: done by="Opus 4.8" gap` renders `[x] Opus 4.8\*`. Stage semantics: see the legend in
[`STATUS.md`](../STATUS.md).

## Workflow

- **On a branch:** create or edit `status.d/<slice>.md`. Never touch `STATUS.md` / `STATUS.json`.
- **On `main` after merge:** `vp run status-build` regenerates both, committed alongside the merge —
  next to `vp run changelog-build` / `vp run decisions-build`. The branch view lags until then, the
  same accepted trade as CHANGELOG's `[Unreleased]`.
- **Validate anytime:** `pnpm run lint:status` (schema + link existence + duplicate-slot check).
