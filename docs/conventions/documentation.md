# Documentation conventions

**Status:** Active — this standard applies now (not a stub).

**Scope (single home for):** how Magna Carta is documented — the definition of "done," the two audiences, which artifact each change updates, the cross-reference rule, and how the changelog and roadmap stay current.

**Authoritative context:** the white paper's _User-facing documentation_ area (user-doc strategy) and _Development guidelines_ area. The root [`CLAUDE.md`](../../CLAUDE.md) carries the short golden-rule version; this file is the full standard.

## Documentation is part of "done"

**No feature is complete until it is documented — for both audiences.** Code that works but is undocumented is _unfinished_, not finished. Documentation ships in the **same commit/PR** as the code it describes; a change that needs docs and omits them does not merge.

Every change updates the docs in its lane. Skip a lane only when it genuinely does not apply, and **say so explicitly in the PR** — silence is not "no docs needed."

**Developer documentation (internal):**

- [ ] Relevant [`conventions/`](.) standard and/or the subsystem spec in [`../specs/`](../specs/) updated.
- [ ] Any architectural decision recorded in [`../Decision-Log.md`](../Decision-Log.md) (same commit, stable `ADR-NNNN`).
- [ ] The [white paper](../Magna-Carta-White-Paper.md) updated **if the design changed** (it stays high-level; not every code edit).
- [ ] The code area's local `CLAUDE.md` updated for new conventions or gotchas.

**User documentation (product) — for any user-visible or admin-facing change:**

- [ ] End-user guide added/updated in [`../user/`](../user/) for the feature.
- [ ] In-app contextual help updated.
- [ ] Admin docs updated if firm-owner/admin behavior changed.

**Living trackers — update in the same PR:**

- [ ] [`CHANGELOG.md`](../../CHANGELOG.md) `[Unreleased]` gets a line for any user-facing or notable change.
- [ ] [`ROADMAP.md`](../../ROADMAP.md) reflects new status (moved to _Recently shipped_, next item promoted to _Now_).

## Two audiences

We serve **two readerships** and a feature must satisfy both:

- **Developers** building Magna Carta — see the design/decision/convention artifacts above.
- **Users** running their practice on it — lawyers, staff, admins, and portal users. Write their guides in plain language (what it does, how to do common tasks, edge cases); never internal architecture.

A feature an engineer can use but a user cannot understand is half-built.

**This is not duplication.** The two sets hold _different facts for different readers_ — there is no shared sentence to drift. Developer docs are the artifacts we already maintain (white paper, conventions, specs, ADRs); the user set ([`../user/`](../user/)) is the only _additive_ one, because user-facing help previously had no home and is itself a shipped product feature (the help center). The boundary is hard: **no internal architecture in user docs; no task walkthroughs in developer docs.**

## Cross-reference rule

Section numbers (`§N`) are navigation **inside the white paper only.** Any file pointing _into_ the white paper from outside references it by **document + topic/area name** (titles outlast numbers) or by a stable **`ADR-NNNN`** — never a section number, which shifts on reorganization. Link to a document and a name, not a number or line.

## Fragment workflow (CHANGELOG, ADRs, STATUS)

Parallel worktrees — multiple branches open at once — collide on `CHANGELOG.md`, the ADR register, and `STATUS.md` when both try to edit the same file. The fragment workflow eliminates that conflict.

**Core invariant:** branches add or edit fragment files only; `main` assembles the rendered outputs.

**On a branch, commit a fragment (or both):**

- **Changelog fragment** — `changelog.d/<slug>.md` with YAML frontmatter `category: Added|Changed|Deprecated|Removed|Fixed|Security` and a body line. Example:

  ```markdown
  ---
  category: Added
  ---

  Brief description of the change.
  ```

- **Decision fragment** — `docs/decisions/pending/<slug>.md` with frontmatter `slug`, `status`, `area`, `date`, optional `summary`, then the decision body. Reference it as `ADR-<slug>` until it is assigned a number at merge. Example:

  ```markdown
  ---
  slug: my-decision
  status: Accepted
  area: Architecture
  date: 2026-06-18
  summary: One-line summary.
  ---

  Full decision body.
  ```

- **Status fragment** — `status.d/<slice-slug>.md`, one **persistent** file per slice. Flat frontmatter (stage tokens `research`…`tested`, plus `slice`, `group`, `order`, `branch`, `next`, `link-spec`/`link-plan`, `adrs`, `blocked-by`) and a one-line Notes body. Edit the slice's own fragment as it moves through the pipeline; never edit `STATUS.md` / `STATUS.json`. Format and stage-token grammar: [`status.d/README.md`](../../status.d/README.md).

**On `main`, assembly is automatic:** the [`assemble-docs` workflow](../../.github/workflows/assemble-docs.yml) runs the assemblers on every push to `main` and commits the rendered outputs, so fragments fold the moment their merge lands. The same commands run by hand when needed:

```
vp run decisions-build    # consumes docs/decisions/pending/*.md → docs/decisions/NNNN-<slug>.md; updates the register
vp run changelog-build    # consumes changelog.d/*.md → appends to CHANGELOG.md [Unreleased]
vp run status-build       # renders status.d/* → STATUS.md + STATUS.json (fragments persist — NOT consumed)
```

Changelog and decision fragments are **consumed** (deleted) on assembly; the output (`docs/decisions/NNNN-<slug>.md`, the register in `Decision-Log.md`, the `[Unreleased]` entries in `CHANGELOG.md`) is committed to `main`. ADR numbers are assigned at merge in fragment-processing order — contiguous and stable, never renumbered. **Status fragments are the exception: they persist** (a slice's status keeps changing), so `status-build` re-renders `STATUS.md` + `STATUS.json` from the whole current set every run and never deletes a fragment. Validate the set anytime with `pnpm run lint:status`.

The judgment-bearing residue — coverage-gap auditing, drafting missing fragments, the ROADMAP rollup — is owned by the weekly propose-only **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md)), which also re-runs the assemblers as a backstop on its `docs-sync/<date>` branch — the one sanctioned case of a branch carrying rendered-output edits, safe because at most one docs-sync stream exists at a time and a human merge remains the gate.

## Changelog (Keep a Changelog)

Root [`CHANGELOG.md`](../../CHANGELOG.md), categories Added / Changed / Deprecated / Removed / Fixed / Security. Entries are added via the fragment workflow above (`changelog.d/<slug>.md` fragments assembled by `vp run changelog-build`); the `[Unreleased]` section is a build output — do not edit it by hand on a branch. Release-time version-cutting is still to come (a future Phase-0 pick). The propose-only **docs-maintenance agent** (white paper, _Maintenance agents_; ADR-0058) is realized as the scheduled **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md)), which drafts fragments from merged PRs for approval.

## Roadmap (living)

Root [`ROADMAP.md`](../../ROADMAP.md) is the execution tracker (Now / Next / Recently shipped / Backlog), distinct from the white paper's stable phase strategy. Updated per PR; the scheduled **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md); ADR-0058) rolls shipped items up weekly as a backstop. The roadmap is slated to join the rendered fragment pipeline (`roadmap-build` + `roadmap.json`) — design in [`docs/specs/2026-07-14-docs-sync-routine-design.md`](../specs/2026-07-14-docs-sync-routine-design.md).

## Doc hygiene is enforced, not trusted

Authoring stays **in-commit** with the change (the docs-in-commit rule above). Two backstops catch what slips, split by whether judgment is needed:

- **Deterministic checks are CI (`vp check`), not an agent:** the cross-reference rule (a `§N` reference from _outside_ the white paper), dead/broken links, and an empty-`[Unreleased]`-on-a-user-facing-PR gate are lint rules — cheaper and more reliable than an LLM.
- **Judgment-bearing checks are the propose-only docs-maintenance agent** (ADR-0058): drafting changelog/roadmap entries and flagging coverage gaps (a user-visible change with no `docs/user/` guide, a design change with no ADR). It never authors design narrative or user-guide prose and never auto-merges.

## Per-feature user-guide pattern

Each guide in [`../user/features/`](../user/): what it does (plain language) · how to do the common tasks (step by step) · tips & edge cases · related features.
