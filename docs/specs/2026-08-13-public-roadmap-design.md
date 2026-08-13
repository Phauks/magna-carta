# Public roadmap — a derived view of the feature ledger — design

**Status:** Proposed (design, built with it) · **Date:** 2026-08-13 · **Owner:** Trevor Goldsmith
**White-paper home:** _Product updates (changelog, release notes & roadmap)_
**Builds on:** [`2026-07-14-docs-sync-routine-design.md`](2026-07-14-docs-sync-routine-design.md) (the `roadmap.d/` feature ledger and the layered pipeline this is the first consumer of), [`2026-08-11-community-surfaces-design.md`](2026-08-11-community-surfaces-design.md) (the public changelog idiom, the six board statuses, and the no-dates rule), [`roadmap.d/README.md`](../../roadmap.d/README.md) (the node schema, which reserved the `audience` key for exactly this)
**Decisions proposed:** `the-public-roadmap-is-derived-and-states-no-date`
**Produces:** two generated documents (`docs/public-roadmap.md`, `docs/now.md`), the assembler and fitness function behind them, the ledger keys they read, and the artifact contract a future page would render. **No page, no route, no worker.**

---

## 1. The problem, stated precisely

The owner's sentence contains two problems that look like one:

> "I think we need to make a roadmap a high priority, I constantly lose track of what is being worked on or doing. I mean this as an actual document that users can see as well."

**The owner cannot tell what is in flight.** This is not a missing file. `ROADMAP.md` is 273 lines, `STATUS.md` tracks 45 slices across five stages, and `roadmap.d/` holds 703 capability nodes. Every fact is already written down. What does not exist is a surface small enough to read in one sitting: the answer to "what is being worked on, and what is waiting on me" is currently assembled by reading three long documents and holding them in your head.

**Users have nothing.** There is no public statement of what is coming. The public changelog says what shipped; nothing says what is next.

**The constraint that shapes everything below.** A hand-maintained public roadmap standing beside the internal one _will_ drift, and drift is precisely the failure being complained about. The measured evidence is already in this repository: the docs-sync design records eleven days and 236 commits of drift under an explicit same-commit rule. Discipline is not a strategy. Both new surfaces are therefore **rendered outputs of the existing ledger**, on the established precedent of `changelog.d/` to `CHANGELOG.md`, `docs/decisions/pending/` to the Decision-Log register, and `status.d/` to `STATUS.md`.

---

## 2. Source of truth, and what is derived

**The ledger is `roadmap.d/`.** It is already the home for exactly the fact a roadmap needs — how complete each capability is — and the docs-sync design already named the public roadmap as one of its future consumers. Nothing new becomes a source of truth here. The white paper keeps the narrative, specs and decisions keep the design, `status.d/` keeps slice stages, and the ledger keeps status plus links.

```
roadmap.d/*.md          the ledger (authored; persistent; one file per product area)
  |
  +-- docs/public-roadmap.md   derived, for users     (this design)
  +-- docs/now.md              derived, for the owner (this design)
  +-- ROADMAP.md               derived, for builders  (the roadmap-build follow-up; not this design)
```

Three renderings, one home. The third is deliberately out of scope: `roadmap-build` — the assembler that turns `ROADMAP.md` from hand-written narrative into a rendered tree — is its own follow-up slice with its own plan, and it touches the single most contended file in the repository. This design builds the parser it will reuse (`tooling/doc-fragments/roadmap.mjs`) and leaves `ROADMAP.md` hand-written, minus one pointer line.

**What is authored, and what is derived, inside a public entry.** This split is the anti-drift mechanism and everything else follows from it:

| Fact                                 | Who writes it             | Why                                                                                    |
| ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| Whether the capability is public     | A human, once, per node   | A judgement about a promise; no machine can make it                                    |
| Its public name and one-line summary | A human, once, per node   | User language is written, not derived — the internal `scope:` line is builder prose    |
| **Which horizon band it sits in**    | **The assembler, always** | **This is the fact that moves, and therefore the fact that must never be typed twice** |

A human writes the durable half and the machine derives the volatile half. Nobody can forget to move a card, because nobody can move a card.

---

## 3. Ledger schema additions

All four keys are **optional and additive**. Every existing node parses unchanged, and a node with none of them is invisible to both new documents.

| Key              | Where       | Meaning                                                                                                    |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `audience`       | node        | `public` opts the node into the public roadmap. Default `internal`. Already reserved by the ledger schema. |
| `public-name`    | node        | The name users see. Defaults to `name`; set it when the internal name is builder vocabulary.               |
| `public-summary` | node        | One sentence of user language. **Required whenever `audience: public`** — enforced, never defaulted.       |
| `awaiting-owner` | node        | One line: the question that is blocking this capability on an owner decision. Presence is the flag.        |
| `public-group`   | area header | `<!-- public-group: ... -->` — the heading users see for that area. Defaults to the file's `# Title`.      |

Two design points worth stating.

**`public-summary` is required rather than defaulted to `scope:`.** Defaulting would be one line of code and would silently publish builder prose — `scope:` lines read "Distinct Person and Organization types with equal data depth" and cite packages. Requiring the sentence costs an author thirty seconds per public node, and it is the only way the public document is guaranteed to be written for the person reading it. The fitness function fails the build on a public node without one.

**`awaiting-owner` carries the question, not a boolean.** A flag that says "blocked on you" without saying what the question is has moved the problem rather than solved it. Existing owner questions are recorded today in prose (`notes:` lines, the roadmap's "Next:" clauses, the open-questions section of half a dozen specs), where nothing can collect them. This key gives them one machine-readable home.

---

## 4. Visibility — what users see, and what they never do

This is the sharpest question in the design and it is a judgement call, so here it is explicitly, with the reasoning.

**Published:** the capability's public name, its one-sentence public summary, its horizon band, and its area heading. Nothing else. That is four fields, and three of them are written by a human specifically for publication.

**Never published, and each for its own reason:**

| Withheld                                         | Why                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slice numbers, phase numbers**                 | Builder vocabulary. Outside this repository "slice 3·2" reads as a schedule with an implied order and an implied date. Also golden rule 13.                 |
| **Spec paths, decision numbers, evidence lines** | They name files that move, renumber, and get superseded; they describe how the thing is built, which is not a user's question.                              |
| **Per-slice stage tracking**                     | Five internal stages (research, spec, plan, built, tested) describe our process, not the product's readiness. "Built but not tested" is not a public state. |
| **Internal statuses verbatim**                   | `partial` and `not-started` are honest internally and misleading publicly — `partial` usually means the backend shipped and the screen has not.             |
| **Anything cut or deferred without a decision**  | See below; `cut` is published deliberately, `deferred` is not published as a promise.                                                                       |
| **Calendar dates, quarters, target windows**     | The whole of section 5.                                                                                                                                     |
| **Internal node ids**                            | Stable forever internally, and free to be renamed publicly; publishing them would freeze a naming decision we have not made.                                |

### 4.1 Dates: the recommended posture, and its cost

**Recommendation: named horizon bands, never a calendar date, never a quarter, and no date field in the schema at all — absent, not nullable.**

The reasoning is the reasoning the search benchmark already uses in this repository: it refuses to print a latency for a path it did not execute, because a plausible invented number is worse than a stated gap. A quarter on a public roadmap is the same object. A roadmap that promises Q1 and misses it has spent credibility it cannot recover by shipping in Q2; a roadmap that never promised a quarter has spent nothing. The community-surfaces design reached this independently and stated the retrofit cost exactly: _"a nullable column gets populated, and then it is a promise."_ Absent, not nullable, is the whole safeguard — there is no field to fill in under pressure.

**The cost, stated honestly.** A prospect evaluating us against a competitor cannot tell whether "In progress" means six weeks or nine months, and some of them will want that number before they sign. We are choosing to lose that conversation rather than win it with a date we do not have. Two things make the trade tolerable: the changelog is dated and public, so shipping cadence is observable from evidence rather than from a promise; and the bands are derived, so "In progress" is at least true on the day it is read, which a quarter is not.

**Not even a generation date**, which was the first draft of this section. Two reasons killed it. It would break the diff gate every day the document was rebuilt, and the gate is the mechanism that makes the bands trustworthy in the first place — a page that says "generated today" and a band that is six months stale is a worse lie than either alone. And a rendered page can stamp its own build time honestly, because it knows when it was built; the document does not. So `buildPublicRoadmapArtifact()` takes `generatedAt` from its caller, and the Markdown carries none.

### 4.2 The relationship to the voting board

The community-surfaces design settled the feature board's status pipeline — **Future, Planned, Building Now, Beta, Completed, Not on the roadmap** — and settled that the roadmap is a filtered view of that board with three columns and no dates. A public roadmap that ignores what users voted for is half a product, so the two are wired at the vocabulary:

**The public roadmap adopts the board's status names as its bands, exactly.** When the board ships, a request card that reads "Building Now" and a roadmap entry that reads "Building Now" mean the same thing, because the roadmap's band came from a mapping every reader can check and the card's status came from an operator choosing the same word. No translation layer, no second vocabulary, and no drift between the two surfaces at the point where drift would be most visible and most damaging.

The board is a separate build (its own worker, its own schema, its own moderation) and this design does not advance it. What it does is refuse to invent a competing set of words — which is the retrofit that would otherwise be waiting, because renaming public status labels after users have learned them is not free.

**The two seams to the board, named and not built:** an accepted request eventually becomes a ledger node (an operator action, not an automatic one — a vote is not a design), and a roadmap entry may later display the vote count of the request that asked for it. Both wait on the board.

### 4.3 Status mapping

| Ledger status                            | Public band            | Reasoning                                                                                                            |
| ---------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `shipped`                                | **Completed**          | It exists and you can use it.                                                                                        |
| `in-build`, `partial`                    | **Building Now**       | `partial` is usually a shipped backend without its screen, which from a user's seat is not yet done.                 |
| `planned`, `designed`                    | **Planned**            | Decided and specified; the work is queued rather than speculative.                                                   |
| `researching`, `not-started`, `deferred` | **Future**             | Intended, not scheduled. `deferred` is parked by a decision, which is a weaker claim than planned but not a refusal. |
| `cut`                                    | **Not on the roadmap** | A promise we are not keeping, published rather than deleted.                                                         |

**`Beta` is unused, deliberately.** No ledger status can produce it today; it belongs to the release-channels work, which owns what "beta" means here. The row is left empty rather than approximated, and the mapping gains it when a node can honestly be in it.

**`cut` is published.** The instinct is to hide a dropped promise, and it is wrong: the ledger's own rule is that a promise that will not be kept flips to `cut` and is kept for the record. The community-surfaces analysis of the reference product's board found the opposite failure in the open — a request marked Completed for something that was never built — and drew the conclusion that a status used to close a conversation rather than describe reality teaches readers to distrust every other status on the page. Publishing a small "Not on the roadmap" section costs one paragraph and buys the credibility of the other four.

### 4.4 Completed entries, and not duplicating the changelog

The changelog says what shipped and when; the roadmap says what is coming. They must not become two accounts of the same thing. So Completed entries render as **names only, with no summary and no date**, under a section that points at the changelog for the detail. They exist for one reason: a reader who saw "Building Now: Trust accounting" last month must be able to tell whether it shipped or was dropped. Deleting it on ship would leave that reader unable to distinguish delivery from abandonment.

---

## 5. How it cannot drift

Three mechanisms, in order of how much they carry.

**1. The band is derived, so the drift has nowhere to live.** A capability that ships flips one word in the ledger — `status: shipped` — in the same commit as the work, which is already the definition-of-done rule for the ledger and is already audited by the weekly docs-sync routine. The next assembly moves it from Building Now to Completed. There is no second place to update and therefore no second place to forget.

**2. A diff gate on the rendered documents.** `pnpm run lint:roadmap` re-derives both documents in memory and fails when either differs from what is committed, naming the first differing line and telling you to run the build. This is the same contract as the committed OpenAPI snapshot and `STATUS.md`. Its effect is that flipping a node without rebuilding fails the gate, and hand-editing a generated document fails the gate — the two ways a derived file rots.

**Why the sibling has no such gate, and this does.** `@magna-carta/product-updates` records that there is deliberately no drift gate on the changelog artifact, and the asymmetry is real rather than an inconsistency: `docs/public-changelog.md` is _authored_ — fragments are folded in once and then curated by hand into thematic roll-ups, so no generator owns its bytes and no gate could hold it. `docs/public-roadmap.md` is _derived_ — rendered whole from persistent fragments on every run, with no hand-curation step at all. Derived files get a gate; authored files cannot have one.

**3. The public-copy rules, enforced at the fragment.** The same lint refuses a `public-summary` that contains a decision number, the word "slice" or "phase" followed by a number, a `docs/` path, a package name, an emoji, or a calendar date or quarter. Each of those is a golden rule (13, 2, 12) or this design's own posture, and the fragment is the right place to enforce them for the reason the changelog lint gives: a fragment can still be edited and a published entry cannot.

The gate runs in `.github/workflows/gate.yml` beside the other fitness functions, and the assembly runs in `.github/workflows/assemble-docs.yml` beside the other assemblers, so a merge to `main` that flips a node re-renders both documents into the auto-merging assembly pull request without anyone doing anything.

---

## 6. The owner's view

**`docs/now.md` — one screen, generated, four sections.**

| Section                      | Source                             | Answers                                                                                |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| **Waiting on you**           | every node with `awaiting-owner`   | "What is blocked on me?" — first, because it is the only section the owner must act on |
| **Being built now**          | every node with `status: in-build` | "What is actually in flight?"                                                          |
| **Next up**                  | `planned` and `designed` nodes     | "What is queued and already decided?"                                                  |
| **Where the program stands** | per-area counts by status          | "How much of the product exists?"                                                      |

**Why not "what just landed".** That is the changelog's fact, and duplicating it here would create a second account of shipped work with no way to keep them agreeing — the exact failure this design exists to prevent. `docs/now.md` links to it instead. One home per fact applies to the owner's convenience too.

**Why a separate document rather than a `ROADMAP.md` section.** Three reasons. `ROADMAP.md` is hand-written narrative today and will be rewritten wholesale by the `roadmap-build` slice, so a generated section inside it would be built twice. It is the most contended file in the repository and every concurrent stream edits it. And the digest must be **fully derived to be trustworthy** — a hand-written "Now" paragraph is the thing that drifted in the first place. `ROADMAP.md` gets one pointer line under its Now heading, which is the cheapest possible edit to a contended file.

**Why it is committed rather than printed by a command.** A committed file is readable from a phone, from the GitHub web interface, and from a fresh session with no toolchain — which is where "I lose track" actually bites. It is deterministic (every section derives from the ledger, nothing from a clock or from git history), so it is diff-gated by the same mechanism as the public document and cannot rot.

---

## 7. Where the public document lives, and the deferred web surface

**Shipping now: `docs/public-roadmap.md`**, the sibling of `docs/public-changelog.md`, in the same directory, assembled by the same class of tool, read by the same package. A rendered Markdown document in the repository is the floor, and it is a real deliverable — it is publishable as-is, reviewable in a pull request, and readable by anyone with the link.

**Deferred to the owner: the page.** A public roadmap page is a **UI surface**, and UI surfaces are the owner's decision. The seam is built and the page is not.

The seam is the artifact contract, exactly as the public changelog does it: `@magna-carta/product-updates` gains `parsePublicRoadmap()` and `buildPublicRoadmapArtifact()`, which turn the rendered document into a validated, versioned artifact — bands, groups, entries — that any renderer reads. Following the sibling's rule, **no artifact is committed**; a consumer builds it at its own build time, so it cannot fall out of step with the document.

**What building the page would take** (so the approval is a real one): a route on `magnacarta.esq/roadmap` served from the changelog's static-assets worker — the same host, no bindings, no per-firm data, so no new deployable and no new blast radius; a rendering of four band columns and their group headings in the design system; and a decision on whether the page carries the changelog's `noindex` posture or is indexed as acquisition content (the changelog is indexed; the board is not). It is a small page. It is still a page, and this stream does not write it.

---

## 8. Considered and rejected

- **Publishing `ROADMAP.md`, filtered.** Already rejected by the community-surfaces design and rejected again here: the internal roadmap is narrative prose in slice and phase vocabulary, and a filter over prose is a regular expression standing between us and our users.
- **Hand-writing the public roadmap and reviewing it monthly.** The failure mode being fixed. Eleven days and 236 commits of measured drift under an explicit same-commit rule is the refutation.
- **Defaulting `public-summary` to the node's `scope:` line.** One line of code, and it publishes builder prose that cites packages. Rejected in section 3.
- **A target-date or confidence field, even nullable.** Rejected in section 4.1, with the reasoning imported from the community-surfaces design: a nullable field gets populated, and then it is a promise.
- **Deriving public entries automatically from status, with no opt-in.** It would publish all 703 nodes, most of which are internal machinery, and it would publish a new promise every time somebody added a node. Publication is a judgement and stays one.
- **Rolling child nodes up into parents automatically.** Tempting (the ledger is a tree, and a parent's status is already a rollup), but a parent's public summary would then describe a capability whose children mean different things to a user. Curation picks the node at the level a user thinks in, which is sometimes the parent and sometimes one child.
- **A committed `public-roadmap.json`.** A second home for the same fact needing a second gate. The sibling package already rejected this for the changelog and the reasoning is unchanged.
- **Building the page in this stream.** It is UI. The seam costs nothing to leave open and the page costs a design review to get wrong.
- **Vote counts on roadmap entries now.** There is no board to count. Named as a seam in 4.2.

---

## 9. Shipped by this design

1. Four optional ledger keys plus the area `public-group` header, documented in `roadmap.d/README.md`.
2. `tooling/doc-fragments/roadmap.mjs` — the ledger parser and both renderers, pure and unit-tested; the parser `roadmap-build` will reuse.
3. `tooling/doc-fragments/build-public-roadmap.mjs` — writes both documents; wired as `vp run public-roadmap-build` and into the per-merge assembly workflow.
4. `tooling/lint-roadmap.mjs` — the fitness function: schema validity, the public-copy rules, and the diff gate; wired as `pnpm run lint:roadmap` into the gate.
5. `docs/public-roadmap.md` and `docs/now.md`, populated from the real state of the program.
6. `packages/product-updates` — the roadmap artifact schema and strict parser, the seam a page would render.
7. `docs/user/features/product-roadmap.md` — the user-facing guide, matching the changelog's.

**Not shipped, deliberately:** the page, the `roadmap-build` rewrite of `ROADMAP.md`, and every board integration.

---

## 10. Open questions for the owner

1. **Which capabilities are public.** This design ships a first curation — the entries a firm evaluating the product would ask about — and the curation is a judgement the owner should overrule freely. Adding or removing one is a one-line edit to a ledger node.
2. **Whether the page is indexed.** The changelog is indexed for acquisition; the community board is permanently `noindex`. A roadmap is acquisition content, which argues for indexed, and it is also the surface most quoted back at you, which argues the other way.
3. **Whether "Not on the roadmap" is published from the start.** Recommended yes, in section 4.3. It is currently empty, so the decision costs nothing today and gets expensive to reverse once the section has been seen.
