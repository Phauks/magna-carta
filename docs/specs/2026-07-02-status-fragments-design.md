# STATUS.md fragment assembly — design

_2026-07-02. Branch `status-fragments` (off `main`)._

## Problem

`STATUS.md` is a single shared file built from column-aligned GitHub-Flavored-Markdown tables. Three
properties compound into recurring merge pain:

1. **The formatter re-pads the whole table on any cell-width change.** Every cell is whitespace-padded
   to the width of the widest cell in its column (the Phase 0 rows are all _exactly_ the same length).
   The Notes column carries long prose and sets that width, so editing one note — or adding a row or a
   column — shifts the max width and `vp check --fix` (oxfmt) rewrites the trailing spaces on **every
   row of that table**. A one-word edit diffs as "all rows changed." History confirms it: commits that
   back out / re-apply this churn, and the padding is non-deterministic across machine/tool versions,
   so a plain `main` sync re-pads even with no content change.
2. **One physical line per slice, hundreds of chars.** Git merges by line; two branches editing the
   same slice's row is a direct, unreadable line-level conflict.
3. **Everyone edits the same file every slice.** The "edit only your own row" discipline can't hold —
   the formatter touches all rows regardless, and structural edits (adding the `UI` column, adding
   Phase rows, header prose) rewrite shared lines.

CHANGELOG and ADRs already escaped this by moving to per-slice **fragment** files assembled on `main`.
`STATUS.md` is the last hand-edited shared tracking file.

## Solution

Make `STATUS.md` a **build output** assembled from per-slice fragments — the exact pattern already
proven by `changelog.d/` → `CHANGELOG.md` (`vp run changelog-build`) and `docs/decisions/pending/` →
the Decision-Log (`vp run decisions-build`) — **plus** stop the formatter from touching it. Branches
only ever edit their own slice's fragment, so shared-line conflicts are eliminated by construction, and
alignment churn disappears because the generator owns formatting.

**One key difference from changelog.** Changelog fragments are _consume-once_: folded into
`[Unreleased]`, then deleted. A slice's status is _persistent_ — it keeps changing across the build
pipeline. So status fragments **live on**, and `status-build` regenerates the whole file from the
current fragment set on every run (it never deletes fragments).

**Render shape:** Notes stay as the 8th table column, verbatim from the fragment body — `STATUS.md`
looks exactly as it does today. A compact "matrix + notes-below" split was considered and deferred; it
is readability polish and solves nothing the fragment model doesn't already solve.

## Components

### 1. `status.d/` — fragment directory (repo root, mirrors `changelog.d/`)

One file per slice: `status.d/<slice-slug>.md` (e.g. `status.d/1-1-matters-locations-file-manager.md`,
`status.d/0-7a-design-system-foundation.md`). Format — YAML front-matter + a Notes body:

```markdown
---
slice: "1·1 — Matters + Locations + File Manager"
group: phase-1
order: 1
research: "[x]"
spec: "[x]"
plan: "[~]"
built: "[x] Opus 4.8 *"
ui: "[ ]"
loadProfile: "[x] Opus 4.8"
tested: "[ ]"
---

Three domain packages + upload/ingest/zip/metering Worker surface + crons; on main. UI plan → 0·7.
```

- The seven marker fields map to the seven stage columns; each is a marker token optionally followed by
  model-attribution / `↻` / `*` suffixes.
- The body is the Notes cell, passed through verbatim.
- Also in `status.d/`: `README.md` (authoring guide) and `_sections.md` — the stable scaffolding: the
  `## Stages` legend, the `**Markers:**` / model-attribution prose, the group order + titles
  (`phase-0` → "Phase 0 — Foundation", `phase-1`, `phase-2`, `cross-cutting`), and the trailing
  "Phases 3–7" note. This is the only place stable prose is edited; it is rendered verbatim.

### 2. `tooling/doc-fragments/status.mjs` — pure parse + render

`parseFragment(markdown)` → `{ slice, group, order, cells, notes }`; `renderStatus(sections, fragments)`
→ the full `STATUS.md` text. No filesystem — unit-testable in isolation (mirrors `changelog.mjs`).

### 3. `tooling/doc-fragments/build-status.mjs` — assembler

Reads `status.d/*.md` (excluding `README.md`, `_sections.md`), parses `_sections.md`, renders, writes
`STATUS.md`. **Does not delete fragments.** Mirrors `build-changelog.mjs`.

### 4. Tests — `tooling/doc-fragments/status.test.mjs`, `build-status.test.mjs`

The `tooling/doc-fragments` vitest project is already registered in `vite.config.ts` `test.projects`,
so new tests run under `vp test` automatically. Coverage:

- **Golden render:** a fixed fragment set → expected markdown.
- **Schema validation:** malformed fragment (bad marker, missing required field, unknown `group`,
  non-numeric `order`) → throws with a clear message. Marker regex: `^\[[x~ \-]\]( .+)?$`.
- **Width-independence (the formatter-churn guard):** two fragments whose notes differ wildly in length
  produce byte-identical bytes for _each other's_ rows — a regression test that the generator never
  pads to column max-width.
- **Idempotency:** build twice → identical file.
- **Ordering:** fragments sort by `(group order, order)`; a duplicate `(group, order)` is a validation
  error.

### 5. `vite.config.ts` changes

- Add to `run.tasks`:
  ```ts
  // Regenerate STATUS.md from status.d/* fragments (persistent — fragments are NOT consumed).
  "status-build": { command: "node tooling/doc-fragments/build-status.mjs" },
  ```
- Add `"STATUS.md"` to `fmt.ignorePatterns`, alongside `CHANGELOG.md` / `docs/Decision-Log.md`, with a
  matching comment: assembled build output, generator owns bytes.

### 6. One-time migration — `tooling/doc-fragments/migrate-status.mjs`

Mirrors the existing `migrate-decisions.mjs`. Parses the current `STATUS.md` (all rows across
Phase 0 / 1 / 2 / cross-cutting) into `status.d/*` fragments + `_sections.md`, then the build is run and
its output diffed against the current file (ignoring alignment whitespace) to prove equivalence. Kept in
the tree as a record, like `migrate-decisions.mjs`.

## Rendering rules (the formatter-churn fix, folded into the generator)

- Tables are emitted **non-aligned**: `| cell | cell |`, single space around content, **no** padding to
  column max-width. Width-independent ⇒ deterministic and stable; a long note never shifts another row.
- The separator row keeps the existing alignment colons (`:--:` for centered marker columns, `---` for
  Slice/Notes) so GitHub still centre-aligns markers.
- Header/legend/footer prose emitted verbatim from `_sections.md`.
- A generated-file banner at the top: "Generated from `status.d/*` by `vp run status-build` — do not
  hand-edit; edit the slice's `status.d/<slice>.md` fragment."

## Workflow (documented)

- **On a branch:** create or edit `status.d/<slice>.md`. **Never edit `STATUS.md`.**
- **On `main` after merge:** `vp run status-build` regenerates `STATUS.md`; commit it. Added next to
  `decisions-build` / `changelog-build` in the post-merge assembler list.
- `STATUS.md` on a branch lags reality until the main-side build — the same accepted trade as CHANGELOG's
  `[Unreleased]`.

## Docs updated in the same change (cross-cutting — worktrees check done)

- `CLAUDE.md` — the "Append-don't-collide on shared files" bullet: `STATUS.md` is now fragment-assembled
  like CHANGELOG/ADRs; branches edit `status.d/<slice>` only.
- `docs/conventions/documentation.md` — add `status-build` to the assembler list + the fragment format.
- `status.d/README.md` — authoring guide (new).

## Risks / trade-offs

- **Staleness on a branch** — accepted, documented (matches CHANGELOG).
- **Near-simultaneous main builds** could both touch the generated file — the same rare case as
  CHANGELOG, mitigated by the post-merge cadence; the file is regenerated wholesale so a re-run heals it.
- **Adding a new stage column later** is a `_sections.md` + schema + template change (centralized in one
  place, versus today's hand-edit across every row).

## Deferred (YAGNI)

- The compact "matrix + notes-below" render (revisit only if raw-source readability becomes a felt need).
- A CI drift/coverage gate ("a slice-state-changing PR must touch a status fragment") — start with
  schema validation only; add coverage enforcement if fragments get forgotten in practice.

## Addendum (2026-07-03) — agent-first fields, as built

Owner review reframed the goal from "stop the collisions" to also "make the tracker better for the
Claude programmers who read it." Three additions to the design above, all shipped:

- **Structured stage frontmatter, not marker strings.** A stage is `state [by="…"] [awaiting] [gap]`
  (e.g. `built: done by="Opus 4.8" gap`) rather than the opaque `[x] Opus 4.8\*`. The renderer maps it
  back to the exact historical cell, so `STATUS.md` is byte-unchanged, but the source an agent edits or
  reads is unambiguous.
- **`STATUS.json` machine index.** `status-build` emits a second output next to `STATUS.md`: one object
  per slice with normalized stages plus development fields — `next` (the concrete next action),
  `branch` / `active-work`, and `links` (spec / plan / ADRs). An agent resuming a slice reads structured
  data instead of parsing a padded table. Dev fields live in fragments + JSON; the human matrix in
  `STATUS.md` is unchanged (they are additive, not new columns).
- **Two guards.** The CI **drift gate** is adopted now (regenerate, then `git diff --exit-code
  STATUS.md STATUS.json`, the code-as-contract idiom) rather than deferred; alongside it a
  `pnpm run lint:status` fitness function validates schema, unique `(group, order)` slot, and link
  existence. `blocked-by` is an optional field, not required.

Recorded as an ADR (fragment `docs/decisions/pending/status-fragments.md`), the same family as ADR-0104
(parallel doc fragments) / ADR-0105 (worktree coordination).

**Module layout as built** (mirrors `build-decisions.mjs`): pure transforms in
`tooling/doc-fragments/status.mjs`; the impure runner `build-status.mjs`; the one-time
`migrate-status.mjs` (kept as a record); unit tests `status.test.mjs` (golden render, schema, the
width-independence regression, idempotency, migrate round-trip); the guard `tooling/lint-status.mjs`.
