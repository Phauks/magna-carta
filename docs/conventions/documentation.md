# Documentation conventions

**Status:** Active — this standard applies now (not a stub).

**Scope (single home for):** how Magna Carta is documented — the definition of "done," the two audiences, which artifact each change updates, the cross-reference rule, and how the changelog and roadmap stay current.

**Authoritative context:** the white paper's _User-facing documentation_ area (user-doc strategy) and _Development guidelines_ area. The root [`CLAUDE.md`](../../CLAUDE.md) carries the short golden-rule version; this file is the full standard.

## Documentation is part of "done"

**No feature is complete until it is documented — for both audiences.** Code that works but is undocumented is _unfinished_, not finished. Documentation ships in the **same commit/PR** as the code it describes; a change that needs docs and omits them does not merge.

Every change updates the docs in its lane. Skip a lane only when it genuinely does not apply, and **say so explicitly in the PR** — silence is not "no docs needed." The [pull request template](../../.github/pull_request_template.md) carries these lanes as a checklist, so the place to say it is already in front of the author.

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

- [ ] A `changelog.d/<slug>.md` fragment for any user-facing or notable change (it becomes the [`CHANGELOG.md`](../../CHANGELOG.md) `[Unreleased]` line when `main` assembles it — never write that file on a branch; see _Fragment workflow_ below).
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

- **Changelog fragment** — `changelog.d/<slug>.md` with YAML frontmatter `category: Added|Changed|Deprecated|Removed|Fixed|Security` and `audience: public|internal`, then a body line. Example:

  ```markdown
  ---
  category: Added
  audience: internal
  ---

  Brief description of the change.
  ```

  **`audience` is required and has no default in either direction.** Two documents assemble from this
  one directory — [`CHANGELOG.md`](../../CHANGELOG.md) for the people building Magna Carta, and
  [`docs/public-changelog.md`](../public-changelog.md) for the people using it — and which of the two
  a fragment feeds is the author's judgement, not something to fall back on. Both defaults would be
  wrong, asymmetrically: assuming `public` publishes an internal research note the first time somebody
  forgets, and assuming `internal` means the public changelog quietly stops being written, which is
  worse because nothing announces it. The rule of thumb: a fragment describing **something a user can
  now do** is `public`; a design, a decision, a research finding, or a tool only this repository uses
  is `internal`. **Design-only work is `internal` by definition** — it has not shipped.

  A `public` fragment carries its customer-facing sentences in a `## Public` block below the developer
  entry — one file, one commit, one review, and no shared sentences to drift:

  ```markdown
  ---
  category: Added
  audience: public
  ---

  The developer entry, mechanism and all.

  ## Public

  **What the reader can now do.** Effect, not mechanism, in their language.
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

**On `main`, assembly is automatic when GitHub Actions runs:** the [`assemble-docs` workflow](../../.github/workflows/assemble-docs.yml) runs the assemblers on every push to `main` and delivers the rendered outputs as an **auto-merging pull request** from the `docs-assembly` branch — a deterministic re-render of fragments reviewed on their own pull requests, formatted by the workflow, merging itself with no status check in the way, so fragments fold minutes after their merge lands while the `main` ruleset stays honored. It is the one workflow that still needs Actions minutes; while the budget is out it does not run, nothing waits on it, and the same commands run by hand when needed:

```
vp run decisions-build    # consumes docs/decisions/pending/*.md → docs/decisions/NNNN-<slug>.md; updates the register
vp run changelog-build    # consumes changelog.d/*.md → CHANGELOG.md [Unreleased] + docs/public-changelog.md
vp run status-build       # renders status.d/* → STATUS.md + STATUS.json (fragments persist — NOT consumed)
vp run register-build     # renders roadmap.d/* → docs/now.md + docs/now.html, the build register (fragments persist); on main only — a branch edits the ledger and never commits the render
```

Changelog and decision fragments are **consumed** (deleted) on assembly; the output (`docs/decisions/NNNN-<slug>.md`, the register in `Decision-Log.md`, the `[Unreleased]` entries in `CHANGELOG.md`) is committed to `main`. ADR numbers are assigned at merge in fragment-processing order — contiguous and stable, never renumbered. **Status fragments are the exception: they persist** (a slice's status keeps changing), so `status-build` re-renders `STATUS.md` + `STATUS.json` from the whole current set every run and never deletes a fragment. Validate the set anytime with `pnpm run lint:status`. **Feature-ledger nodes persist for the same reason** — a capability's completeness keeps moving — so `register-build` re-renders its document from the whole current ledger every run; validate with `pnpm run lint:roadmap`.

**Fragments are validated, not trusted.** A fragment feeds a generated document that has no other store, so a malformed one used to degrade the output silently rather than fail. `pnpm run lint:decisions` checks every decision fragment and numbered decision file — frontmatter fence, known keys, required `slug`/`status`/`area`, lifecycle status, `YYYY-MM-DD` date, and register text that is neither empty nor a Markdown heading — and `vp run decisions-build` runs the same validation over the whole pending set **before** it numbers anything, so a bad fragment is a loud no-op instead of a half-consumed assembly. `pnpm run lint:changelog-fragments` does the same for changelog fragments — fence, known keys, a real `category`, a decided `audience`, a `## Public` block on a public fragment and none on an internal one, no emoji, kebab-case filename — and `vp run changelog-build` re-runs it over the whole set before folding anything, for the same reason: folding deletes the fragment, so a half-consumed assembly is not something an author can re-run their way out of. All three run in the gate's governance dimension (`pnpm gate`, and the pre-push hook's `check:scoped` runs the same repo-wide lints), so an author finds the problem on their own branch rather than after the merge that consumes the fragment. Format details: [`docs/decisions/README.md`](../decisions/README.md), [`changelog.d/README.md`](../../changelog.d/README.md).

The judgment-bearing residue — coverage-gap auditing, drafting missing fragments, the ROADMAP rollup — is owned by the weekly propose-only **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md)), which also re-runs the assemblers as a backstop on its `docs-sync/<date>` branch — the one sanctioned case of a branch carrying rendered-output edits, safe because at most one docs-sync stream exists at a time and a human merge remains the gate.

## Changelog (Keep a Changelog)

Root [`CHANGELOG.md`](../../CHANGELOG.md), categories Added / Changed / Deprecated / Removed / Fixed / Security. Entries are added via the fragment workflow above (`changelog.d/<slug>.md` fragments assembled by `vp run changelog-build`); the `[Unreleased]` section is a build output — do not edit it by hand on a branch. Release-time version-cutting is still to come (a future Phase-0 pick). The propose-only **docs-maintenance agent** (white paper, _Maintenance agents_; ADR-0058) is realized as the scheduled **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md)), which drafts fragments from merged PRs for approval.

**The customer-facing changelog** is [`docs/public-changelog.md`](../public-changelog.md), assembled in the same pass from the `## Public` blocks of `audience: public` fragments. It is a build output too — never hand-edited on a branch — but unlike `CHANGELOG.md` it is **curated on `main`**: a dated section starts as one bullet per published fragment and may be edited into the thematic roll-up a reader actually wants. What is never done there is authoring a change that has no fragment behind it. Entries are grouped by date rather than by version because no release has been cut; the artifact schema in `@magna-carta/product-updates` carries a version field that stays null until one is, so a renderer switches to version grouping with nothing reshaped.

## Roadmap (living)

Root [`ROADMAP.md`](../../ROADMAP.md) is the execution tracker (Now / Next / Recently shipped / Backlog), distinct from the white paper's stable phase strategy. Updated per PR; the scheduled **docs-sync routine** ([`docs/maintenance/README.md`](../maintenance/README.md); ADR-0058) rolls shipped items up weekly as a backstop.

The roadmap's source of truth is becoming the **feature ledger** — [`roadmap.d/`](../../roadmap.d/), one persistent fragment per product area, every promised capability as a node with a status (format: [`roadmap.d/README.md`](../../roadmap.d/README.md)). A PR that ships or advances a feature flips its node in the same commit — a definition-of-done item like the changelog fragment. When the `roadmap-build` assembler lands (design in [`docs/specs/2026-07-14-docs-sync-routine-design.md`](../specs/2026-07-14-docs-sync-routine-design.md)), `ROADMAP.md` becomes its rendered output (tree view + a small hand-written Now header) too.

**Three renderings of that ledger exist today, and none is ever hand-edited.** The first is [`docs/now.md`](../now.md), **the build register** — every node at its real status, the counts across all nine statuses, what is blocked on the owner, what is in build, and what is queued. `pnpm run lint:roadmap` re-derives it on `main` and fails when it has fallen behind the ledger, so a capability that ships moves in the register on the status flip alone; on a branch the same lint fails when the rendered files were touched at all, because the register renders on `main` (the per-merge assembly workflow, else the docs-sync routine) and a branch that rendered it collided with every other branch that did. It never bands statuses together: `partial` (a shipped backend with no screen on it) and `in-build` (being written now) are different facts and stay different columns. **Its "where we have been" is reconstructed, not remembered:** a ledger node holds one status and forgets the last one, so the same build re-parses the ledger at every past first-parent commit that touched a node file and persists the counts in [`docs/register-history.json`](../register-history.json) — appending only the commits that file does not already hold, and recording a commit whose ledger the current parser rejects as an unread hole with its reason rather than estimating it.

The second is [`docs/now.html`](../now.html), **the same register as a self-contained web page** — the form the register is actually read in, published as a private page rather than opened as a file in a repository. It renders from the same `areas` the Markdown renders from, in the same `vp run register-build`, and `pnpm run lint:roadmap` holds it to a fresh render byte for byte exactly as it holds `docs/now.md`. Refreshing it is that one command and nothing else; it is never edited, and a published copy is replaced by re-publishing the generated file, never by editing the page. It carries no "where we have been": the reconstructed series is a table of commits and the page is the where-does-everything-stand-right-now instrument, so the page stays a pure function of the ledger alone. Everything on it that is not derived from a node — the headline, the standing prose, the section ledes, the stylesheet and the filter script — lives in [`tooling/doc-fragments/register-artifact.mjs`](../../tooling/doc-fragments/register-artifact.mjs), which is the one place that editorial voice is written. This existed as hand-authored HTML first, and the hand-authored copy was several merges stale within a fortnight, which is the whole argument for the gate.

The third is [`docs/decisions-open.html`](../decisions-open.html), **the decision desk** — every node carrying an `awaiting-owner` question, gathered as one page with somewhere to write the answer. It exists because those questions were recorded where each piece of work stopped, one line inside one area file, and were reachable only as a list part way down the register: somewhere to read them, not somewhere to answer them. Cards are sorted by whether anything is built behind the question, each carries the node's reach from `surface:`, answers persist in the reader's browser, and the page composes them into one block naming each decision by node id. It has no network of any kind — the property that lets it be read from the repository, from a published copy or offline and be the same page — so answers leave by clipboard, by a prefilled repository issue the browser opens, or as a file. Built by the same `vp run register-build` and held to a fresh render by the same lint, so a question leaves the desk exactly when its node's key does.

**A fourth, customer-facing rendering is written and deliberately not published** — grouped into horizon bands with no dates anywhere, publishing only nodes marked `audience: public` and only the sentence written for that purpose. There are no users yet, so it has no audience; the renderer, the ledger keys, the public-copy lint and the artifact schema are all kept ready for when there are. Design: [`docs/specs/2026-08-13-public-roadmap-design.md`](../specs/2026-08-13-public-roadmap-design.md).

## Doc hygiene is enforced, not trusted

Authoring stays **in-commit** with the change (the docs-in-commit rule above). Two backstops catch what slips, split by whether judgment is needed:

- **Deterministic checks are lint rules, not an agent:** the cross-reference rule (a "spec §N" / "white paper §N" reference from _outside_ the white paper) is one pattern of `pnpm run lint:process-refs`; the fragment validators (`lint:changelog-fragments`, `lint:decisions`, `lint:status`, `lint:roadmap`) check every fragment's frontmatter and that the files a status fragment links exist.
  - **`pnpm run lint:doc-links` — every relative link resolves**, and a `#anchor` into a Markdown file names a heading that exists. This documentation replaces duplication with links (one home per fact), so a rotted link is not a cosmetic defect: it is a fact nobody can reach. External `http(s)` links are deliberately out of scope — a gate must not depend on the network.
  - **`pnpm run lint:changelog-coverage` — a change to first-party source brings a `changelog.d/` fragment.** This is golden rule 5's actual enforcement; before it, a merge with no fragment was caught only by the weekly audit below.
  - **`pnpm run lint:active-work` — a stream note has the shape the registry can read.** `vp run worktrees` warns about a flattened path or a missing frontmatter block, and the root `CLAUDE.md` compensates by telling people to remember to run it; the gate is what makes the rule hold when nobody does. The opposite direction — a `status.d/` fragment pointing at a note that no longer exists — is `lint:status`'s, and stays there.
- **Judgment-bearing checks are the propose-only docs-maintenance agent** (ADR-0058): drafting changelog/roadmap entries and flagging coverage gaps (a user-visible change with no `docs/user/` guide, a design change with no ADR). It never authors design narrative or user-guide prose and never auto-merges.

## Per-feature user-guide pattern

Each guide in [`../user/features/`](../user/): what it does (plain language) · how to do the common tasks (step by step) · tips & edge cases · related features.
